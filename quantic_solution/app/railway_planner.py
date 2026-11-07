#!/usr/bin/env python3
"""
Railway network planner: QAOA stage + classical completion to a connected network.

Pipeline
  1. Feasibility check: the candidate paths must be able to connect every node, and a
     conflict-free spanning network must fit in the budget.
  2. Quantum stage (QAOA): choose routes that maximise value, spending AT MOST
     quantum_fraction * budget (default 80 %), never building both routes of a conflict pair.
     QUBO:  E(x,s) = -sum v_i x_i + lam*(sum c_i x_i + sum w_k s_k - B_q)^2 + mu*sum_{(i,j) in P} x_i x_j
     Slack bits s_k (bounded-binary weights w_k) make the budget a true "<=" constraint.
  3. Classical stage: with the remaining budget, connect ALL nodes into one network
     (cheapest-first spanning-forest completion, conflict-aware). If that is impossible with the
     quantum selection, quantum routes are dropped (lowest value per cost first) until it is.
  4. Optional: spend any leftover budget on extra high-value, conflict-free routes.

Input (JSON file path as argument, or JSON on stdin):
{
  "budget": 16,
  "nodes": {"Iasi": [27.6, 47.17], "Brasov": [25.61, 45.65], ...},     # name -> [lon, lat]
           # or [{"name": "Iasi", "lon": 27.6, "lat": 47.17}, ...]
  "paths": [{"id": 0, "from": "Iasi", "to": "Brasov", "cost": 2, "value": 4}, ...],
           # "id" defaults to the list index, "value" defaults to 1
  "conflict_pairs": [[0, 1]],                    # optional, rarely needed: extra NON-geometric conflicts
  "options": {                                   # all optional
    "quantum_fraction": 0.8, "qaoa_depth": 2, "shots": 2048, "seed": 2026,
    "max_qubits": 16, "restarts": 6, "maxiter": 300,
    "use_leftover_for_value": true,
    "auto_conflicts": true,                      # detect conflict pairs from the node coordinates
    "coordinate_system": "lonlat",               # "lonlat" (degrees) or "xy" (planar units)
    "min_clearance": 0,                          # also conflict if closer than this (km, or xy units)
    "embedding": false,                          # report a compact heavy-hex qubit layout
    "include_circuit": true,                     # return the QAOA circuit
    "circuit_formats": ["qasm3"]                 # any of "qasm3", "qasm2", "qasm3_parameterized"
  }
}

Conflict detection (auto_conflicts): every path is the straight segment between its two cities.
Two paths conflict ("intertwined") when their segments
  crossing   cross at a point that is not a shared city,
  touching   meet where one path's end city lies inside the other path,
  overlap    run along the same line for a positive length (also when they share a city),
  too_close  pass closer than min_clearance without sharing a city (only if min_clearance > 0).
Paths that only meet at a shared city are NOT in conflict (that is a normal junction).

Output (JSON, compact: small objects on one line; --format pretty|min to change):
  status, connected, total_cost, total_value, remaining_budget, cost_breakdown, budget,
  conflicts  [{paths, type, at}] detected (and manual) conflict pairs,
  graph      {nodes, edges (stage = quantum | connector | extra)},
  quantum    QAOA statistics and intermediate results:
    variables  x_i -> route id, s_k -> slack weight (qubit i holds variable i)
    penalties  lam, mu, slack weights, lam_ladder {lam: energy minimum feasible?}
    qubo       offset, linear, quadratic, formula (compact / expanded / LaTeX), energy_range
    ising      constant, scale, h, J, formula (plain / LaTeX); y_i = (1 - Z_i)/2
    angles     gammas, betas (layer 1 first) and every optimiser start
    circuit    size statistics and OpenQASM with the optimised angles
    execution  (IBM runs only) backend, job_id, physical qubits, compiled depth / two-qubit gates,
               estimated success, layout method, status, quantum_seconds

Running on IBM Quantum hardware (options.execution = "ibm"):
  * credentials never go in the input JSON. Put them in a .env file next to this script (or in the
    current folder, or pass --env-file PATH), or set them as environment variables (Kubernetes Secret):
      IBM_QUANTUM_TOKEN=<IBM Cloud API key>   IBM_QUANTUM_INSTANCE=<instance CRN>
    (optional IBM_QUANTUM_CHANNEL, default "ibm_quantum_platform"); real environment variables win
    over the .env file. Needs pip qiskit-ibm-runtime.
  * the angles are trained on the exact local simulator; only the final circuit runs on the QPU
    (one job, ibm_shots shots), and its samples choose the quantum routes
  * the job id is printed to stderr right after submission; if the wait exceeds ibm_timeout the
    status is "pending" (exit 3): rerun with the same input plus options.ibm_job_id to collect it
  * execution = "ibm_fake" runs the same path on a local noisy copy of a device (e.g. FakeTorino)
    without credentials, for testing
Exit code: 0 = ok, 2 = infeasible, 3 = IBM job still pending, 1 = invalid input / internal error.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from fractions import Fraction
from itertools import combinations

import numpy as np
from scipy.optimize import minimize

log = logging.getLogger("railway_planner")

DEFAULT_OPTIONS = dict(
    quantum_fraction=0.8, qaoa_depth=2, shots=2048, seed=2026, max_qubits=16,
    restarts=6, maxiter=300, use_leftover_for_value=True,
    auto_conflicts=True, coordinate_system="lonlat", min_clearance=0.0,
    embedding=False, include_circuit=True, circuit_formats=["qasm3"],
    # ---- where the final circuit is sampled
    execution="simulator",            # "simulator" | "ibm" (real QPU) | "ibm_fake" (local noisy copy)
    ibm_backend="",                   # e.g. "ibm_torino"; empty = least busy device that fits
    ibm_shots=None,                   # default: same as "shots"
    ibm_layout="best",                # "best" | "auto" | "compact"  (best = highest estimated success)
    ibm_optimization_level=3,
    ibm_dynamical_decoupling=True,
    ibm_twirling=False,
    ibm_timeout=3600,                 # seconds to wait for the job result
    ibm_job_id="",                    # fetch an already submitted job instead of submitting a new one
    ibm_fallback=False,               # on IBM failure/timeout: use (clearly labelled) simulator samples
)
CIRCUIT_FORMATS = {"qasm3", "qasm2", "qasm3_parameterized"}
EXECUTIONS = {"simulator", "ibm", "ibm_fake"}


class InputError(ValueError):
    pass


# --------------------------------------------------------------------------- input
def parse_input(data: dict):
    if not isinstance(data, dict):
        raise InputError("Input must be a JSON object")
    try:
        budget = float(data["budget"])
    except (KeyError, TypeError, ValueError):
        raise InputError("'budget' must be a number") from None
    if budget < 0:
        raise InputError("'budget' must be non-negative")

    raw_nodes = data.get("nodes")
    nodes = {}
    if isinstance(raw_nodes, dict):
        for name, xy in raw_nodes.items():
            if not (isinstance(xy, (list, tuple)) and len(xy) == 2):
                raise InputError(f"Node {name!r}: coordinates must be [lon, lat]")
            nodes[str(name)] = (float(xy[0]), float(xy[1]))
    elif isinstance(raw_nodes, list):
        for n in raw_nodes:
            try:
                name = str(n["name"])
                x = n.get("lon", n.get("x")); y = n.get("lat", n.get("y"))
                xy = (float(x), float(y))
            except (KeyError, TypeError, ValueError):
                raise InputError(f"Bad node entry {n!r}: need name and lon/lat (or x/y)") from None
            if name in nodes:
                raise InputError(f"Duplicate node {name!r}")
            nodes[name] = xy
    else:
        raise InputError("'nodes' must be an object {name: [lon, lat]} or a list")
    if not nodes:
        raise InputError("No nodes given")

    raw_paths = data.get("paths")
    if not isinstance(raw_paths, list):
        raise InputError("'paths' must be a list")
    paths, seen = [], set()
    for k, p in enumerate(raw_paths):
        try:
            pid = p.get("id", k)
            u, v = str(p["from"]), str(p["to"])
            cost = float(p["cost"]); value = float(p.get("value", 1))
        except (KeyError, TypeError, ValueError, AttributeError):
            raise InputError(f"Bad path entry #{k}: need from, to, cost (value optional)") from None
        if u not in nodes or v not in nodes:
            raise InputError(f"Path {pid!r} uses an unknown node")
        if u == v:
            raise InputError(f"Path {pid!r} is a self-loop")
        if cost < 0:
            raise InputError(f"Path {pid!r} has negative cost")
        if pid in seen:
            raise InputError(f"Duplicate path id {pid!r}")
        seen.add(pid)
        paths.append(dict(id=pid, u=u, v=v, cost=cost, value=value))

    conflicts = set()
    for pair in data.get("conflict_pairs", []) or []:
        if not (isinstance(pair, (list, tuple)) and len(pair) == 2):
            raise InputError(f"Conflict pair {pair!r} must have two path ids")
        a, b = pair
        if a not in seen or b not in seen or a == b:
            raise InputError(f"Conflict pair {pair!r} references unknown or identical paths")
        conflicts.add(frozenset((a, b)))

    opts = dict(DEFAULT_OPTIONS)
    user_opts = dict(data.get("options", {}) or {})
    if "auto_conflicts_from_crossings" in user_opts:          # old option name
        user_opts.setdefault("auto_conflicts", user_opts.pop("auto_conflicts_from_crossings"))
    opts.update(user_opts)
    if not 0 <= float(opts["quantum_fraction"]) <= 1:
        raise InputError("quantum_fraction must be between 0 and 1")
    if opts["coordinate_system"] not in ("lonlat", "xy"):
        raise InputError("coordinate_system must be 'lonlat' or 'xy'")
    if float(opts["min_clearance"]) < 0:
        raise InputError("min_clearance must be non-negative")
    if not set(opts["circuit_formats"]) <= CIRCUIT_FORMATS:
        raise InputError(f"circuit_formats must be a subset of {sorted(CIRCUIT_FORMATS)}")
    if opts["execution"] not in EXECUTIONS:
        raise InputError(f"execution must be one of {sorted(EXECUTIONS)}")
    if opts["ibm_layout"] not in ("best", "auto", "compact"):
        raise InputError("ibm_layout must be 'best', 'auto' or 'compact'")
    if any(k in user_opts for k in ("token", "api_key", "ibm_token", "crn", "instance")):
        raise InputError("Do not put IBM credentials in the input; set the IBM_QUANTUM_TOKEN and "
                         "IBM_QUANTUM_INSTANCE environment variables instead")
    return budget, nodes, paths, conflicts, opts


# --------------------------------------------------------------------------- geometric conflicts
EARTH_RADIUS_KM = 6371.0


def detect_conflicts(nodes, paths, system="lonlat", clearance=0.0):
    """Conflict pairs found from the geometry of the straight path segments.

    lon/lat is mapped to km with an equirectangular projection around the mean latitude. That map
    is affine, so crossing/touching/overlap results are identical to testing in lon/lat directly;
    distances (min_clearance) are accurate to well under 1 % at country scale.
    Runs in O(m^2) for m paths, vectorised one row at a time (a few thousand paths is fine).
    Returns [{"paths": [id_a, id_b], "type": ..., "at": [lon, lat] | "distance_km": d}, ...]."""
    m = len(paths)
    if m < 2:
        return []
    names = list(nodes)
    idx = {k: i for i, k in enumerate(names)}
    P = np.array([nodes[k] for k in names], float)
    if system == "lonlat":
        kx = np.cos(np.deg2rad(P[:, 1].mean())) * np.deg2rad(1) * EARTH_RADIUS_KM   # km per degree lon
        ky = np.deg2rad(1) * EARTH_RADIUS_KM                                         # km per degree lat
    else:
        kx = ky = 1.0
    XY = P * np.array([kx, ky])
    back = lambda pt: [round(float(pt[0] / kx), 6), round(float(pt[1] / ky), 6)]
    dist_key = "distance_km" if system == "lonlat" else "distance"

    ui = np.array([idx[p["u"]] for p in paths]); vi = np.array([idx[p["v"]] for p in paths])
    A, B = XY[ui], XY[vi]
    D = B - A
    L = np.hypot(D[:, 0], D[:, 1])
    eps = 1e-9 * max(float(np.ptp(XY, axis=0).max()), 1e-12)        # length tolerance
    cross = lambda u, w: u[..., 0] * w[..., 1] - u[..., 1] * w[..., 0]
    sgn = lambda o: np.where(np.abs(o) <= eps, 0, np.sign(o))

    def point_seg_dist(p, a, b):
        ab = b - a
        t = np.clip(np.einsum("ij,ij->i", p - a, ab) / np.maximum(np.einsum("ij,ij->i", ab, ab), 1e-300), 0, 1)
        return np.hypot(*(p - (a + t[:, None] * ab)).T)

    out = []
    for i in range(m - 1):
        j = np.arange(i + 1, m)
        a, b, d, Li = A[i], B[i], D[i], L[i]
        c, e, f, Lj = A[j], B[j], D[j], L[j]
        shared = (ui[j] == ui[i]) | (ui[j] == vi[i]) | (vi[j] == ui[i]) | (vi[j] == vi[i])
        # signed distances: c, e from line ab and a, b from line ce
        o1, o2 = cross(d, c - a) / Li, cross(d, e - a) / Li
        o3, o4 = cross(f, a - c) / Lj, cross(f, b - c) / Lj
        s1, s2, s3, s4 = sgn(o1), sgn(o2), sgn(o3), sgn(o4)
        # positions along the other segment (length units)
        tc, te = (c - a) @ d / Li, (e - a) @ d / Li
        ta, tb = np.einsum("ij,ij->i", a - c, f) / Lj, np.einsum("ij,ij->i", b - c, f) / Lj
        collinear = (s1 == 0) & (s2 == 0)
        lo, hi = np.maximum(0, np.minimum(tc, te)), np.minimum(Li, np.maximum(tc, te))
        overlap = collinear & (hi - lo > eps)
        crossing = (s1 * s2 < 0) & (s3 * s4 < 0)
        inside = lambda s, t, Ls: (s == 0) & (t > eps) & (t < Ls - eps)
        touching = (inside(s1, tc, Li) | inside(s2, te, Li) | inside(s3, ta, Lj) | inside(s4, tb, Lj)) \
            & ~collinear & ~shared & ~crossing
        flagged = overlap | crossing | touching
        if clearance > 0:
            dist = np.minimum.reduce([point_seg_dist(c, np.broadcast_to(a, c.shape), np.broadcast_to(b, c.shape)),
                                      point_seg_dist(e, np.broadcast_to(a, c.shape), np.broadcast_to(b, c.shape)),
                                      point_seg_dist(np.broadcast_to(a, c.shape), c, e),
                                      point_seg_dist(np.broadcast_to(b, c.shape), c, e)])
            close = ~shared & ~flagged & (dist < clearance)
        else:
            close = np.zeros(len(j), bool)
        for k in np.flatnonzero(flagged | close):
            pair = [paths[i]["id"], paths[j[k]]["id"]]
            if overlap[k]:
                rec = dict(paths=pair, type="overlap", at=back(a + d / Li * (lo[k] + hi[k]) / 2))
            elif crossing[k] or touching[k]:
                t = o1[k] / (o1[k] - o2[k])                       # where line ce meets line ab
                rec = dict(paths=pair, type="crossing" if crossing[k] else "touching",
                           at=back(c[k] + t * f[k]))
            else:
                rec = {"paths": pair, "type": "too_close", dist_key: round(float(dist[k]), 3)}
            out.append(rec)
    return out


# --------------------------------------------------------------------------- graph helpers
class DSU:
    def __init__(self, items):
        self.parent = {i: i for i in items}

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        self.parent[ra] = rb
        return True


def count_components(nodes, edges):
    d = DSU(nodes)
    for e in edges:
        d.union(e["u"], e["v"])
    return len({d.find(n) for n in nodes})


def conflicts_with(path, built_ids, conflicts):
    return any(frozenset((path["id"], b)) in conflicts for b in built_ids)


def complete_network(nodes, paths, conflicts, base_ids, budget):
    """Cheapest-first completion so every node is connected (Kruskal on the contracted graph).

    Returns (connector_ids, spent, connected)."""
    by_id = {p["id"]: p for p in paths}
    built = list(base_ids)
    spent = sum(by_id[i]["cost"] for i in built)
    dsu = DSU(nodes)
    for i in built:
        dsu.union(by_id[i]["u"], by_id[i]["v"])
    added = []
    for p in sorted(paths, key=lambda p: (p["cost"], -p["value"], str(p["id"]))):
        if p["id"] in built or dsu.find(p["u"]) == dsu.find(p["v"]):
            continue
        if conflicts_with(p, built, conflicts) or spent + p["cost"] > budget + 1e-9:
            continue
        dsu.union(p["u"], p["v"]); built.append(p["id"]); added.append(p["id"]); spent += p["cost"]
    connected = len({dsu.find(n) for n in nodes}) == 1
    return added, spent, connected


# --------------------------------------------------------------------------- QUBO
def to_integer_units(values, max_den=100):
    """Scale costs so they are integers (needed for the slack encoding)."""
    fr = [Fraction(v).limit_denominator(max_den) for v in values]
    if any(abs(float(f) - v) > 1e-9 for f, v in zip(fr, values)):
        raise InputError("Costs need at most 2 decimal places")
    scale = math.lcm(*[f.denominator for f in fr]) if fr else 1
    return [int(f * scale) for f in fr], scale


def slack_weights(bound):
    """Bounded binary 1,2,4,...,remainder: represents every integer 0..bound."""
    w, k = [], 1
    while sum(w) + k <= bound:
        w.append(k); k *= 2
    if sum(w) < bound:
        w.append(bound - sum(w))
    return w


def all_bitstrings(n):
    k = np.arange(2 ** n, dtype=np.int64)
    return ((k[:, None] >> np.arange(n)) & 1).astype(np.int8)   # row k: bit i = qubit i


def build_qubo(costs_int, values, conflict_idx, bq_int, slack_w, lam, mu):
    a = np.array(list(costs_int) + list(slack_w), float)
    v = np.array(list(values) + [0.0] * len(slack_w), float)
    linear = -v + lam * (a ** 2 - 2 * bq_int * a)
    quadratic = np.triu(2 * lam * np.outer(a, a), 1)
    for i, j in conflict_idx:
        quadratic[i, j] += mu
    return dict(offset=lam * bq_int ** 2, linear=linear, quadratic=quadratic)


def qubo_energies(q, Y):
    Yf = Y.astype(float)
    return q["offset"] + Yf @ q["linear"] + np.einsum("ki,ij,kj->k", Yf, q["quadratic"], Yf)


def qubo_to_ising(q):
    a, b = q["linear"], q["quadratic"]
    h = -a / 2 - (b.sum(axis=0) + b.sum(axis=1)) / 4
    return dict(constant=float(q["offset"] + a.sum() / 2 + b.sum() / 4), h=h, J=b / 4)


# --------------------------------------------------------------------------- QAOA
def qaoa_probabilities(angles, energies, n, scale):
    """Exact QAOA state (numpy). Equivalent to the Qiskit circuit up to a global phase."""
    psi = np.full(2 ** n, 2 ** (-n / 2), dtype=complex)
    for layer in range(len(angles) // 2):
        gamma, beta = angles[2 * layer], angles[2 * layer + 1]
        psi *= np.exp(-1j * gamma * energies / scale)
        c, s = np.cos(beta), -1j * np.sin(beta)          # RX(2 beta) = cos b I - i sin b X
        t = psi.reshape((2,) * n)
        for ax in range(n):
            t0 = np.take(t, 0, axis=ax); t1 = np.take(t, 1, axis=ax)
            t = np.stack([c * t0 + s * t1, s * t0 + c * t1], axis=ax)
        psi = t.reshape(-1)
    p = np.abs(psi) ** 2
    return p / p.sum()


def qaoa_circuit(ising, angles, measure=True):
    from qiskit import QuantumCircuit
    h, J = ising["h"], ising["J"]
    n = len(h)
    scale = max(1.0, float(np.max(np.abs(h))), float(np.max(np.abs(J))))
    qc = QuantumCircuit(n)
    qc.h(range(n))
    for layer in range(len(angles) // 2):
        gamma, beta = angles[2 * layer], angles[2 * layer + 1]
        for i in range(n):
            if not np.isclose(h[i], 0):
                qc.rz(2 * gamma * float(h[i]) / scale, i)
        for i in range(n):
            for j in range(i + 1, n):
                if not np.isclose(J[i, j], 0):
                    qc.rzz(2 * gamma * float(J[i, j]) / scale, i, j)
        for i in range(n):
            qc.rx(2 * beta, i)
    if measure:
        qc.measure_all()
    return qc


def sample_counts(ising, angles, probs, shots, seed):
    """Finite-shot samples: Aer on the real circuit if available, else from exact probabilities."""
    n = len(ising["h"])
    try:
        from qiskit import transpile
        from qiskit_aer import AerSimulator
        sim = AerSimulator(max_parallel_threads=1)
        qc = transpile(qaoa_circuit(ising, angles), sim)
        raw = sim.run(qc, shots=shots, seed_simulator=seed).result().get_counts()
        counts = {}
        for key, c in raw.items():
            k = int(key.replace(" ", ""), 2)                      # rightmost bit = qubit 0
            counts[k] = counts.get(k, 0) + c
        return counts, "qiskit-aer"
    except ImportError:
        rng = np.random.default_rng(seed)
        draws = rng.multinomial(shots, probs)
        return {int(k): int(c) for k, c in enumerate(draws) if c}, "numpy-exact-probabilities"


def run_quantum_stage(paths, conflicts, budget, opts):
    rng = np.random.default_rng(opts["seed"])
    bq = float(opts["quantum_fraction"]) * budget
    cand = [p for p in paths if p["cost"] <= bq + 1e-9]
    costs_all, unit = to_integer_units([p["cost"] for p in cand] or [0.0])
    bq_int = int(math.floor(bq * unit + 1e-9))
    slack = slack_weights(bq_int)
    max_routes = int(opts["max_qubits"]) - len(slack)
    notes = []
    if max_routes < 1:
        raise InputError("max_qubits too small for the slack encoding of this budget")
    if len(cand) > max_routes:
        # keep the best value-per-cost routes for the quantum stage; the rest stay available classically
        cand = sorted(cand, key=lambda p: (-(p["value"] / max(p["cost"], 1e-9)), str(p["id"])))[:max_routes]
        notes.append(f"Quantum stage limited to {max_routes} routes (max_qubits={opts['max_qubits']}); "
                     "others remain available to the classical stage.")
    if not cand:
        return [], dict(skipped=True, reason="No route fits in the quantum budget"), notes
    costs_int = [int(round(p["cost"] * unit)) for p in cand]
    values = [p["value"] for p in cand]
    pos = {p["id"]: k for k, p in enumerate(cand)}
    conf_idx = sorted(tuple(sorted((pos[a], pos[b]))) for a, b in map(tuple, conflicts)
                      if a in pos and b in pos)
    nr, ns = len(cand), len(slack)
    n = nr + ns
    Y = all_bitstrings(n)
    X = Y[:, :nr].astype(float)
    cost_of_state = X @ np.array(costs_int, float)
    conflict_state = np.zeros(len(Y), bool)
    for i, j in conf_idx:
        conflict_state |= (Y[:, i] == 1) & (Y[:, j] == 1)
    feasible_state = (cost_of_state <= bq_int) & ~conflict_state
    value_state = X @ np.array(values, float)

    # penalty weights: mu > max value; lam from a ladder ending at a value that is provably safe
    mu = float(max(values) + 1)
    lam_safe = float(sum(values) + 1)
    lam = lam_safe
    ladder = []
    for trial in [0.25, 0.5, 1, 2, 3, 5, 8, 13, 21, lam_safe]:
        q = build_qubo(costs_int, values, conf_idx, bq_int, slack, trial, mu)
        E = qubo_energies(q, Y)
        ok = bool(feasible_state[np.isclose(E, E.min())].all())
        ladder.append(dict(lam=float(trial), energy_minimum_feasible=ok))
        if ok:
            lam = float(trial)
            break
    qubo = build_qubo(costs_int, values, conf_idx, bq_int, slack, lam, mu)
    E = qubo_energies(qubo, Y)
    ising = qubo_to_ising(qubo)
    scale = max(1.0, float(np.max(np.abs(ising["h"]))), float(np.max(np.abs(ising["J"]))))

    p_depth = int(opts["qaoa_depth"])
    def objective(angles):
        return float(qaoa_probabilities(angles, E, n, scale) @ E)
    starts, kinds = [], []
    for dt in (0.02, 0.05, 0.1):
        k = np.arange(1, p_depth + 1) / (p_depth + 1)
        x = np.empty(2 * p_depth); x[0::2] = 4 * dt * k; x[1::2] = 12 * dt * (1 - k); starts.append(x)
        kinds.append(f"ramp dt={dt}")
    for _ in range(max(0, int(opts["restarts"]) - 3)):
        x = np.empty(2 * p_depth); x[0::2] = rng.uniform(0, .3, p_depth)
        x[1::2] = rng.uniform(0, np.pi / 2, p_depth); starts.append(x)
        kinds.append("random")
    runs = [minimize(objective, s, method="COBYLA",
                     options={"maxiter": int(opts["maxiter"]), "rhobeg": .1}) for s in starts]
    best_idx = int(np.argmin([r.fun for r in runs]))
    angles = np.asarray(runs[best_idx].x, float)
    probs = qaoa_probabilities(angles, E, n, scale)
    execution = None
    if opts["execution"] == "simulator":
        counts, sampler = sample_counts(ising, angles, probs, int(opts["shots"]), int(opts["seed"]))
    else:
        counts, sampler, execution = run_on_ibm(ising, angles, probs, opts)
        if counts is None:            # pending / failed without fallback: stop the quantum stage here
            raise HardwareNotReady(execution)
        if execution.get("fallback_used"):
            notes.append("IBM execution failed or timed out; samples come from the local SIMULATOR "
                         "(see quantum.execution.error).")

    shots = sum(counts.values())
    feas_samples = [(c, k) for k, c in counts.items() if feasible_state[k]]
    chosen = []
    if feas_samples:
        _, k_best = max(feas_samples, key=lambda t: (value_state[t[1]], t[0]))
        chosen = [cand[i]["id"] for i in range(nr) if Y[k_best, i]]
    opt_val = float(value_state[feasible_state].max())
    names = [f"x{i}" for i in range(nr)] + [f"s{k}" for k in range(ns)]
    stats = dict(
        sampler=sampler, qubits=n, route_qubits=nr, slack_qubits=ns, layers=p_depth, quantum_budget=bq,
        expected_energy=float(probs @ E),
        p_feasible_uniform=float(feasible_state.mean()),
        p_feasible_qaoa=float(probs[feasible_state].sum()),
        feasible_sample_rate=sum(c for c, _ in feas_samples) / shots if shots else 0.0,
        best_sampled_value=float(sum(p["value"] for p in cand if p["id"] in chosen)),
        exact_optimum_value=opt_val,
        variables={**{f"x{i}": p["id"] for i, p in enumerate(cand)},
                   **{f"s{k}": f"slack {w}" for k, w in enumerate(slack)}},
    )
    if execution is not None:
        stats["execution"] = execution
    stats.update(intermediate_results(
        cand, costs_int, values, slack, unit, bq_int, conf_idx, names, qubo, ising, scale,
        lam, mu, ladder, angles, starts, kinds, runs, best_idx, E, opts))
    if opts.get("embedding"):
        stats["embedding"] = compact_embedding(ising, angles, int(opts["seed"]))
    return chosen, stats, notes


# --------------------------------------------------------------------------- intermediate results
def _num(c):
    return f"{float(c):.10g}"


def _poly(terms, latex=False):
    """Sum of (coefficient, symbol) terms as text, e.g. '3 x0 - 2 x1 + x2'. Zero terms are skipped."""
    parts = []
    for c, sym in terms:
        if np.isclose(c, 0):
            continue
        mag = abs(float(c))
        coef = "" if np.isclose(mag, 1) else _num(mag)
        body = f"{coef}{'' if latex or not coef else ' '}{sym}"
        parts.append(("- " if c < 0 else "+ ") + body)
    if not parts:
        return "0"
    txt = " ".join(parts)
    return txt[2:] if txt.startswith("+ ") else "-" + txt[2:]


def _with_constant(const, poly):
    """'const + poly' with the sign of the first term written out, e.g. '288 - 92 x0 + ...'."""
    if poly == "0":
        return _num(const)
    return f"{_num(const)} - {poly[1:]}" if poly.startswith("-") else f"{_num(const)} + {poly}"


def _tex(name):            # 'x10' -> 'x_{10}'
    return f"{name[0]}_{{{name[1:]}}}"


def intermediate_results(cand, costs_int, values, slack, unit, bq_int, conf_idx, names, qubo, ising,
                         scale, lam, mu, ladder, angles, starts, kinds, runs, best_idx, E, opts):
    """Everything between the input and the chosen routes: penalties, QUBO, Ising, angles, circuit."""
    n, nr = len(names), len(cand)
    lin, quad = qubo["linear"], qubo["quadratic"]
    h, J, const = ising["h"], ising["J"], ising["constant"]
    pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]
    xs, ss = names[:nr], names[nr:]

    # ---- penalties: lam = smallest ladder value whose energy minima are all feasible; mu = max value + 1
    penalties = dict(
        lam=lam, mu=mu, slack_weights=list(slack), quantum_budget_units=bq_int, cost_unit_scale=unit,
        lam_ladder={_num(r["lam"]): r["energy_minimum_feasible"] for r in ladder},
    )

    # ---- QUBO
    value_txt = _poly([(v, x) for v, x in zip(values, xs)])
    budget_txt = _poly([(c, x) for c, x in zip(costs_int, xs)] + [(w, s) for w, s in zip(slack, ss)])
    conf_txt = " + ".join(f"{names[i]}*{names[j]}" for i, j in conf_idx) or "0"
    value_tex = _poly([(v, _tex(x)) for v, x in zip(values, xs)], latex=True)
    budget_tex = _poly([(c, _tex(x)) for c, x in zip(costs_int, xs)] +
                       [(w, _tex(s)) for w, s in zip(slack, ss)], latex=True)
    conf_tex = " + ".join(f"{_tex(names[i])}{_tex(names[j])}" for i, j in conf_idx) or "0"
    expanded = _poly([(lin[i], names[i]) for i in range(n)] +
                     [(quad[i, j], f"{names[i]}*{names[j]}") for i, j in pairs])
    qubo_out = dict(
        offset=float(qubo["offset"]),
        linear={names[i]: float(lin[i]) for i in range(n) if lin[i] != 0},
        quadratic={f"{names[i]}*{names[j]}": float(quad[i, j]) for i, j in pairs if quad[i, j] != 0},
        formula=(f"E = -({value_txt}) + {_num(lam)}*({budget_txt} - {bq_int})^2"
                 f" + {_num(mu)}*({conf_txt})"),
        formula_expanded="E = " + _with_constant(qubo["offset"], expanded),
        formula_latex=(r"E(x,s) = -\left(" + value_tex + r"\right) + " + _num(lam) + r"\left(" +
                       budget_tex + f" - {bq_int}" + r"\right)^2 + " + _num(mu) + r"\left(" +
                       conf_tex + r"\right)"),
        energy_range=[float(E.min()), float(E.max())],
    )

    # ---- Ising (Z|0> = +|0>, y_i = (1 - Z_i)/2; the circuit applies exp(-i*gamma*(H - constant)/scale))
    hj = _poly([(h[i], f"Z{i}") for i in range(n)] + [(J[i, j], f"Z{i}*Z{j}") for i, j in pairs])
    hj_tex = _poly([(h[i], f"Z_{{{i}}}") for i in range(n)] +
                   [(J[i, j], f"Z_{{{i}}}Z_{{{j}}}") for i, j in pairs], latex=True)
    ising_out = dict(
        constant=float(const), scale=float(scale),
        h={f"Z{i}": float(h[i]) for i in range(n) if not np.isclose(h[i], 0)},
        J={f"Z{i}*Z{j}": float(J[i, j]) for i, j in pairs if not np.isclose(J[i, j], 0)},
        formula="H = " + _with_constant(const, hj),
        formula_latex="H = " + _with_constant(const, hj_tex),
    )

    # ---- angles (layer 1 acts first; RZ(2*gamma*h/scale), RZZ(2*gamma*J/scale), RX(2*beta))
    p = len(angles) // 2
    r6 = lambda v: [round(float(a), 6) for a in v]
    angles_out = dict(
        gammas=[float(a) for a in angles[0::2]], betas=[float(a) for a in angles[1::2]],
        optimizer=dict(method="COBYLA", rhobeg=0.1, maxiter=int(opts["maxiter"])),
        starts=[dict(kind=kinds[k], selected=(k == best_idx),
                     energy=round(float(runs[k].fun), 6), evaluations=int(runs[k].nfev),
                     start_gammas=r6(starts[k][0::2]), start_betas=r6(starts[k][1::2]),
                     final_gammas=r6(runs[k].x[0::2]), final_betas=r6(runs[k].x[1::2]))
                for k in range(len(starts))],
    )

    # ---- circuit
    circuit_out = None
    if opts.get("include_circuit", True):
        try:
            from qiskit import qasm2, qasm3
            from qiskit.circuit import Parameter
            bound = qaoa_circuit(ising, angles, measure=True)
            circuit_out = dict(
                num_qubits=bound.num_qubits, depth=int(bound.depth()),
                two_qubit_gates=int(sum(i.operation.num_qubits == 2 for i in bound.data
                                        if i.operation.name != "barrier")),
                gate_counts={k: int(v) for k, v in bound.count_ops().items()},
                bit_order=f"rightmost measured bit = q[0] = {names[0]}; q[i] holds variable i",
            )
            formats = list(opts.get("circuit_formats") or ["qasm3"])
            if "qasm3" in formats:
                circuit_out["qasm3"] = qasm3.dumps(bound)
            if "qasm2" in formats:   # rzz written as cx-rz-cx so strict qelib1.inc parsers accept it
                circuit_out["qasm2"] = qasm2.dumps(bound.decompose(gates_to_decompose=["rzz"]))
            if "qasm3_parameterized" in formats:
                symbols = [Parameter(f"{'gamma' if k % 2 == 0 else 'beta'}_{k // 2 + 1}") for k in range(2 * p)]
                circuit_out["qasm3_parameterized"] = qasm3.dumps(qaoa_circuit(ising, symbols, measure=True))
        except Exception as exc:   # qiskit missing or export failed: keep the rest of the output
            circuit_out = dict(error=f"circuit export unavailable: {exc}")
    return dict(penalties=penalties, qubo=qubo_out, ising=ising_out, angles=angles_out,
                circuit=circuit_out)


# --------------------------------------------------------------------------- IBM Quantum hardware
class HardwareNotReady(Exception):
    """The IBM job is still queued/running (status 'pending') or failed without fallback."""
    def __init__(self, info):
        super().__init__(info.get("error", "IBM execution did not return a result"))
        self.info = info


def _secret_safe(exc, secrets):
    msg = f"{type(exc).__name__}: {exc}"
    for s in secrets:
        if s:
            msg = msg.replace(s, "***")
    return msg[:500]


ENV_PLACEHOLDERS = ("paste-your", "your-api-key", "your-crn", "<", "xxx")


def load_env_file(path=None):
    """Load KEY=VALUE lines from a .env file into os.environ (no extra package needed).

    Search order: the given path, ./.env (current folder), .env next to this script.
    Variables that are already set (e.g. from a Kubernetes Secret) are NOT overwritten.
    Returns the file that was loaded, or None. Values are never printed."""
    import os
    from pathlib import Path
    candidates = [Path(path)] if path else [Path.cwd() / ".env", Path(__file__).resolve().parent / ".env"]
    for f in candidates:
        if not f.is_file():
            continue
        for raw in f.read_text(encoding="utf-8-sig").splitlines():      # utf-8-sig: Notepad BOM
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip().removeprefix("export ").strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                value = value[1:-1]
            elif " #" in value:                                         # inline comment
                value = value.split(" #", 1)[0].rstrip()
            if key and value and key not in os.environ:
                os.environ[key] = value
        return f
    if path:
        raise InputError(f"env file not found: {path}")
    return None


def ibm_service():
    """Credentials come only from the environment (e.g. a Kubernetes Secret) or a .env file next to
    the script (see load_env_file), never from the input JSON.

    IBM_QUANTUM_TOKEN     IBM Cloud API key           (QISKIT_IBM_TOKEN also accepted)
    IBM_QUANTUM_INSTANCE  instance CRN                (QISKIT_IBM_INSTANCE also accepted)
    IBM_QUANTUM_CHANNEL   optional, default "ibm_quantum_platform"."""
    import os
    token = os.environ.get("IBM_QUANTUM_TOKEN") or os.environ.get("QISKIT_IBM_TOKEN")
    instance = os.environ.get("IBM_QUANTUM_INSTANCE") or os.environ.get("QISKIT_IBM_INSTANCE")
    channel = os.environ.get("IBM_QUANTUM_CHANNEL", "ibm_quantum_platform")
    hint = " (put it in the .env file next to the script, or set the environment variable)"
    if not token:
        raise RuntimeError("IBM_QUANTUM_TOKEN is not set" + hint)
    if not instance:
        raise RuntimeError("IBM_QUANTUM_INSTANCE (the CRN) is not set" + hint)
    if any(p in token.lower() for p in ENV_PLACEHOLDERS) or any(p in instance.lower() for p in ENV_PLACEHOLDERS):
        raise RuntimeError("the .env file still contains the placeholder text - paste your real API key and CRN")
    if not instance.startswith("crn:"):
        raise RuntimeError("IBM_QUANTUM_INSTANCE must be the instance CRN (it starts with 'crn:v1:')")
    from qiskit_ibm_runtime import QiskitRuntimeService
    try:
        return QiskitRuntimeService(channel=channel, token=token, instance=instance), (token, instance)
    except Exception as exc:
        raise RuntimeError("could not connect to IBM Quantum - check the API key, the CRN and that the pod "
                           "can reach quantum.cloud.ibm.com / iam.cloud.ibm.com over HTTPS ("
                           + _secret_safe(exc, (token, instance)) + ")") from None


def estimated_success(isa, target):
    """Product of (1 - error) over all gates and measurements, from the backend calibration."""
    p = 1.0
    for inst in isa.data:
        name = inst.operation.name
        if name in ("barrier", "delay") or name not in target.operation_names:
            continue
        props = target[name].get(tuple(isa.find_bit(q).index for q in inst.qubits))
        if props is not None and props.error:
            p *= 1 - props.error
    return p


def healthy_edges(backend, max_error=0.1):
    """Coupling edges whose two-qubit gate and both qubits' readout / single-qubit errors are
    below max_error, so the compact patch avoids broken or very noisy qubits."""
    t = backend.target
    def err(op, qargs):
        if op not in t.operation_names:
            return 0.0
        props = t[op].get(qargs)
        return props.error if props is not None and props.error is not None else 0.0
    bad = {q for q in range(backend.num_qubits)
           if max(err("measure", (q,)), err("sx", (q,)), err("x", (q,))) >= max_error}
    twoq = [g for g in ("cz", "ecr", "cx") if g in t.operation_names]
    edges = set()
    for a, b in backend.coupling_map.get_edges():
        if a in bad or b in bad:
            continue
        if all(err(g, (a, b)) < max_error for g in twoq if (a, b) in (t[g] or {})):
            edges.add((min(a, b), max(a, b)))
    return sorted(edges)


def _two_qubit(circ):
    return int(sum(i.operation.num_qubits == 2 for i in circ.data if i.operation.name != "barrier"))


def compact_patch(edges, n, pairs, seed, iters=3000, n_starts=4):
    """Connected set of n physical qubits minimising extra hops between interacting variables
    (simulated annealing). edges: coupling-map edges; pairs: interacting variable pairs."""
    import networkx as nx
    G = nx.Graph(); G.add_edges_from(edges)
    hop = dict(nx.all_pairs_shortest_path_length(G))
    spread = lambda lay: sum(hop[lay[i]][lay[j]] - 1 for i, j in pairs)
    rng = np.random.default_rng(seed)
    best = None
    for start in rng.choice(sorted(G.nodes), min(n_starts, G.number_of_nodes()), replace=False):
        lay = list(nx.bfs_tree(G, int(start)))[:n]
        if len(lay) < n:
            continue
        c = spread(lay); T = 5.0; cur_best = (c, lay[:])
        for _ in range(iters):
            T *= 0.999; new = lay[:]
            if rng.random() < .5:
                i, j = rng.choice(n, 2, replace=False); new[i], new[j] = new[j], new[i]
            else:
                used = set(lay); cand = [q for u in lay for q in G[u] if q not in used]
                if not cand:
                    continue
                new[rng.integers(n)] = cand[rng.integers(len(cand))]
            if not nx.is_connected(G.subgraph(new)):
                continue
            nc = spread(new)
            if nc < c or rng.random() < np.exp(-(nc - c) / max(T, 1e-9)):
                lay, c = new, nc
                if c < cur_best[0]:
                    cur_best = (c, lay[:])
        if best is None or cur_best[0] < best[0]:
            best = cur_best
    return sorted(int(q) for q in best[1]), int(best[0])


def compile_for_backend(bound, ising, backend, opts):
    """Transpile the bound circuit to the device ISA. 'auto' = Qiskit's preset pass manager (a few
    seeds); 'compact' = route inside the tightest qubit patch; 'best' = all, keep the highest
    estimated success probability."""
    from qiskit import transpile
    from qiskit.transpiler import generate_preset_pass_manager
    level, seed, mode = int(opts["ibm_optimization_level"]), int(opts["seed"]), opts["ibm_layout"]
    target = backend.target
    cands = []
    if mode in ("auto", "best"):
        for s in range(3):
            isa = generate_preset_pass_manager(optimization_level=level, backend=backend,
                                               seed_transpiler=seed + s).run(bound)
            cands.append(("auto", isa))
    if mode in ("compact", "best") and backend.coupling_map is not None:
        try:
            n = bound.num_qubits
            pairs = [(i, j) for i in range(n) for j in range(i + 1, n) if not np.isclose(ising["J"][i, j], 0)]
            patch, _ = compact_patch(healthy_edges(backend), n, pairs, seed, iters=1500, n_starts=3)
            basis = [g for g in backend.operation_names if g in {"id", "rz", "sx", "x", "cx", "ecr", "cz"}]
            local = transpile(bound, coupling_map=backend.coupling_map.reduce(patch), basis_gates=basis,
                              optimization_level=level, seed_transpiler=seed)
            layout = [patch[local.layout.initial_layout[q]] for q in bound.qubits]
            isa = generate_preset_pass_manager(optimization_level=level, backend=backend,
                                               seed_transpiler=seed, initial_layout=layout).run(bound)
            cands.append(("compact", isa))
        except Exception as exc:      # e.g. networkx missing: keep the preset-pass-manager result
            log.warning("compact layout skipped: %s", exc)
            if not cands:
                raise
    scored = [(estimated_success(isa, target), kind, isa) for kind, isa in cands]
    esp, kind, isa = max(scored, key=lambda t: t[0])
    layout = [isa.layout.initial_layout[q] for q in bound.qubits] if isa.layout else list(range(bound.num_qubits))
    info = dict(layout_method=kind, physical_qubits=[int(q) for q in layout], isa_depth=int(isa.depth()),
                isa_two_qubit_gates=_two_qubit(isa), estimated_success=float(esp),
                candidates={f"{k}#{i}": dict(two_qubit_gates=_two_qubit(c), estimated_success=float(e))
                            for i, (e, k, c) in enumerate(scored)})
    return isa, info


def _counts_from_result(pub_result, n):
    reg = pub_result.data.meas                       # measure_all() names the register "meas"
    if reg.num_bits != n:
        raise RuntimeError(f"job measured {reg.num_bits} bits, expected {n}: different input/circuit?")
    counts = {}
    for key, c in reg.get_counts().items():
        k = int(key.replace(" ", ""), 2)             # rightmost bit = qubit 0 = variable 0
        counts[k] = counts.get(k, 0) + int(c)
    return counts


def run_on_ibm(ising, angles, probs, opts):
    """Run the bound QAOA circuit on an IBM backend (or a local noisy fake) and return its counts.

    Returns (counts, sampler_label, execution_info). counts is None when the job is still pending
    or failed and ibm_fallback is false."""
    from datetime import datetime, timezone
    n = len(ising["h"])
    real = opts["execution"] == "ibm"
    shots = int(opts["ibm_shots"] or (opts["shots"] if real else 128))   # fake mode: ~0.4 s per shot
    info = dict(mode=opts["execution"], shots=shots, status="starting")
    secrets = ()
    try:
        from qiskit_ibm_runtime import SamplerV2
        bound = qaoa_circuit(ising, angles, measure=True)
        if real:
            service, secrets = ibm_service()
            if opts["ibm_job_id"]:                                    # recover an existing job
                job = service.job(opts["ibm_job_id"])
                info.update(backend=job.backend().name, job_id=job.job_id(), recovered=True)
            else:
                if opts["ibm_backend"]:
                    backend = service.backend(opts["ibm_backend"])
                    if backend.num_qubits < n or not backend.status().operational:
                        raise RuntimeError(f"{backend.name} is not operational or has fewer than {n} qubits")
                else:
                    backend = service.least_busy(min_num_qubits=n, operational=True, simulator=False)
                info["backend"] = backend.name
        else:
            from qiskit_ibm_runtime import fake_provider
            name = opts["ibm_backend"] or "FakeTorino"
            if not name.startswith("Fake") or not hasattr(fake_provider, name):
                raise RuntimeError(f"unknown fake backend {name!r} (e.g. FakeTorino, FakeFez, FakeBrisbane)")
            backend = getattr(fake_provider, name)()
            info["backend"] = f"{name} (local noisy simulation, not a real QPU)"

        if not info.get("recovered"):
            isa, compile_info = compile_for_backend(bound, ising, backend, opts)
            info.update(compile_info)
            sampler = SamplerV2(mode=backend)
            sampler.options.default_shots = shots
            if real:
                sampler.options.dynamical_decoupling.enable = bool(opts["ibm_dynamical_decoupling"])
                sampler.options.twirling.enable_gates = bool(opts["ibm_twirling"])
            info.update(dynamical_decoupling=bool(opts["ibm_dynamical_decoupling"]) and real,
                        twirling=bool(opts["ibm_twirling"]) and real)
            job = sampler.run([isa], shots=shots)
            info.update(job_id=job.job_id(), submitted_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"))
            # printed immediately (stderr) so the id survives a pod restart; recover with ibm_job_id
            print(f"IBM job submitted: backend={info['backend']} job_id={info['job_id']}", file=sys.stderr, flush=True)

        info["status"] = "waiting"
        try:
            result = job.result(timeout=float(opts["ibm_timeout"]))
        except TypeError:                                             # local-mode jobs take no timeout
            result = job.result()
        counts = _counts_from_result(result[0], n)
        info["status"] = "done"
        try:
            usage = job.metrics().get("usage", {})
            if usage:
                info["quantum_seconds"] = usage.get("quantum_seconds", usage.get("seconds"))
        except Exception:
            pass
        label = "ibm-qpu" if real else "ibm-fake-noisy-simulator"
        return counts, label, info
    except Exception as exc:
        timed_out = "timeout" in type(exc).__name__.lower() or "timed out" in str(exc).lower()
        info.update(status="pending" if timed_out and info.get("job_id") else "failed",
                    error=_secret_safe(exc, secrets))
        if timed_out and info.get("job_id"):
            info["error"] += f" | the job keeps running on IBM: rerun with options.ibm_job_id = {info['job_id']!r}"
        if not opts["ibm_fallback"]:
            return None, None, info
        info["fallback_used"] = True
        counts, label = sample_counts(ising, angles, probs, int(opts["shots"]), int(opts["seed"]))
        return counts, f"{label} (FALLBACK, not hardware)", info


# --------------------------------------------------------------------------- optional embedding
def compact_embedding(ising, angles, seed, iters=3000):
    """Pick the tightest connected patch on a 57-qubit heavy-hex map and route inside it."""
    from qiskit import transpile
    from qiskit.transpiler import CouplingMap
    n = len(ising["h"])
    cmap = CouplingMap.from_heavy_hex(5)
    pairs = [(i, j) for i in range(n) for j in range(i + 1, n) if not np.isclose(ising["J"][i, j], 0)]
    import networkx as nx
    hop = dict(nx.all_pairs_shortest_path_length(nx.Graph(list(cmap.get_edges()))))
    spread = lambda lay: sum(hop[lay[i]][lay[j]] - 1 for i, j in pairs)
    patch, _ = compact_patch(cmap.get_edges(), n, pairs, seed, iters=iters, n_starts=4)
    qc = qaoa_circuit(ising, angles)
    isa = transpile(qc, coupling_map=cmap.reduce(patch), basis_gates=["id", "rz", "sx", "x", "cx"],
                    optimization_level=3, seed_transpiler=seed)
    layout = [patch[isa.layout.initial_layout[q]] for q in qc.qubits]
    return dict(device="heavy-hex 57 qubits (synthetic)", physical_qubits=patch,
                layout={f"q{i}": layout[i] for i in range(n)}, spread_extra_hops=int(spread(layout)),
                depth=isa.depth(), two_qubit_gates=sum(i.operation.num_qubits == 2 for i in isa.data))


# --------------------------------------------------------------------------- main solver
def solve(data: dict) -> dict:
    budget, nodes, paths, conflicts, opts = parse_input(data)
    by_id = {p["id"]: p for p in paths}
    notes = []
    manual = set(conflicts)
    conflicts_out = []
    if opts.get("auto_conflicts", True):
        for rec in detect_conflicts(nodes, paths, opts["coordinate_system"], float(opts["min_clearance"])):
            conflicts.add(frozenset(rec["paths"]))
            conflicts_out.append(rec)
    detected = {frozenset(r["paths"]) for r in conflicts_out}
    conflicts_out += [dict(paths=sorted(c, key=str), type="manual") for c in manual - detected]
    log.info("%d conflict pair(s): %s", len(conflicts_out), [r["paths"] for r in conflicts_out])

    def result(status, **kw):
        big = {k: kw.pop(k) for k in ("graph", "quantum") if k in kw}      # long sections go last
        return dict(status=status, **kw, budget=budget, notes=notes, conflicts=conflicts_out, **big)

    # 1. Can all nodes be connected at all?
    if count_components(nodes, paths) > 1:
        return result("infeasible", connected=False,
                      reason="The candidate paths cannot connect all nodes (graph is disconnected).")
    base_conn, base_cost, base_ok = complete_network(nodes, paths, conflicts, [], math.inf)
    if not base_ok:
        return result("infeasible", connected=False,
                      reason="No conflict-free spanning network found (greedy search).")
    if base_cost > budget + 1e-9:
        return result("infeasible", connected=False, minimum_connection_cost=base_cost,
                      reason=f"Connecting all nodes needs at least {base_cost:g}, budget is {budget:g}.")

    log.info("Feasible: connecting all nodes costs at least %g of %g", base_cost, budget)

    # 2. Quantum stage
    try:
        q_ids, q_stats, q_notes = run_quantum_stage(paths, conflicts, budget, opts)
    except HardwareNotReady as exc:
        status = "pending" if exc.info.get("status") == "pending" else "error"
        return result(status, connected=False, reason=f"IBM execution: {exc.info.get('error')}",
                      quantum=dict(execution=exc.info))
    log.info("Quantum stage chose routes %s", q_ids)
    notes += q_notes
    q_ids = list(q_ids)

    # 3. Classical completion; drop quantum routes if needed until everything connects
    dropped = []
    while True:
        conn_ids, spent, ok = complete_network(nodes, paths, conflicts, q_ids, budget)
        if ok:
            break
        if not q_ids:   # cannot happen after the feasibility check, but stay safe
            return result("infeasible", connected=False, reason="Could not connect all nodes.")
        worst = min(q_ids, key=lambda i: (by_id[i]["value"] / max(by_id[i]["cost"], 1e-9), str(i)))
        q_ids.remove(worst); dropped.append(worst)
    log.info("Connectors %s, spent %g", conn_ids, spent)
    if dropped:
        notes.append(f"Dropped quantum route(s) {dropped} so the whole network fits the budget.")

    # 4. Optional: spend leftover budget on extra value
    built = q_ids + conn_ids
    extra_ids = []
    if opts.get("use_leftover_for_value", True):
        for p in sorted(paths, key=lambda p: (-(p["value"] / max(p["cost"], 1e-9)), str(p["id"]))):
            if p["id"] in built or p["value"] <= 0 or conflicts_with(p, built, conflicts):
                continue
            if spent + p["cost"] <= budget + 1e-9:
                built.append(p["id"]); extra_ids.append(p["id"]); spent += p["cost"]

    stage = {**{i: "quantum" for i in q_ids}, **{i: "connector" for i in conn_ids},
             **{i: "extra" for i in extra_ids}}
    edges = [dict(id=i, **{"from": by_id[i]["u"], "to": by_id[i]["v"]}, cost=by_id[i]["cost"],
                  value=by_id[i]["value"], stage=stage[i]) for i in built]
    used_edges = [by_id[i] for i in built]
    connected = count_components(nodes, used_edges) == 1
    assert connected and spent <= budget + 1e-9
    assert not any(frozenset((a, b)) in conflicts for a, b in combinations(built, 2))
    return result(
        "ok", connected=connected,
        total_cost=round(spent, 9), total_value=float(sum(by_id[i]["value"] for i in built)),
        remaining_budget=round(budget - spent, 9),
        cost_breakdown=dict(quantum=sum(by_id[i]["cost"] for i in q_ids),
                            connectors=sum(by_id[i]["cost"] for i in conn_ids),
                            extra=sum(by_id[i]["cost"] for i in extra_ids)),
        graph=dict(nodes=[dict(name=k, lon=x, lat=y) for k, (x, y) in nodes.items()], edges=edges),
        quantum=q_stats,
    )


def to_json(obj, fmt="compact"):
    """compact: objects/arrays holding only scalars or flat arrays/objects go on one line, so each
    edge, conflict, optimiser start, coefficient table ... is a single line. pretty: indent=2.
    min: a single line."""
    if fmt == "pretty":
        return json.dumps(obj, indent=2, ensure_ascii=False)
    if fmt == "min":
        return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    one = lambda o: json.dumps(o, ensure_ascii=False)
    is_box = lambda o: isinstance(o, (dict, list))
    kids = lambda o: o.values() if isinstance(o, dict) else o
    flat = lambda o: not any(is_box(c) for c in kids(o))

    def render(o, ind):
        if not is_box(o) or not o or flat(o) or (isinstance(o, dict) and all(not is_box(c) or flat(c)
                                                                            for c in o.values())):
            return one(o)
        pad, inner = " " * ind, " " * (ind + 2)
        if isinstance(o, dict):
            body = ",\n".join(f"{inner}{one(k)}: {render(v, ind + 2)}" for k, v in o.items())
            return "{\n" + body + "\n" + pad + "}"
        return "[\n" + ",\n".join(inner + render(v, ind + 2) for v in o) + "\n" + pad + "]"
    return render(obj, 0)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("input", nargs="?", help="input JSON file (default: stdin)")
    ap.add_argument("-o", "--output", help="output JSON file (default: stdout)")
    ap.add_argument("-f", "--format", choices=["compact", "pretty", "min"], default="compact",
                    help="output layout (default compact: one line per edge/conflict/record)")
    ap.add_argument("--env-file", help="file with IBM_QUANTUM_TOKEN / IBM_QUANTUM_INSTANCE "
                                       "(default: .env in the current folder or next to this script)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr, format="%(levelname)s %(message)s")
    log.setLevel(logging.INFO if args.verbose else logging.WARNING)   # only our own progress lines
    try:
        env_file = load_env_file(args.env_file)
        if env_file:
            log.info("loaded settings from %s", env_file)
        data = json.load(open(args.input, encoding="utf-8")) if args.input else json.load(sys.stdin)
        out = solve(data)
        code = {"ok": 0, "infeasible": 2, "pending": 3}.get(out["status"], 1)
    except (InputError, json.JSONDecodeError) as exc:
        out, code = dict(status="error", error=str(exc)), 1
    except Exception as exc:   # report, never crash silently inside the pod
        log.exception("internal error")
        out, code = dict(status="error", error=f"internal error: {exc}"), 1
    text = to_json(out, args.format)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    else:
        print(text)
    return code


if __name__ == "__main__":
    sys.exit(main())