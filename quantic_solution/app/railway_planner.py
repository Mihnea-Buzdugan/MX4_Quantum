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
  "conflict_pairs": [[0, 1], [3, 4]],            # optional: path ids that may never both be built
  "options": {                                   # all optional
    "quantum_fraction": 0.8, "qaoa_depth": 2, "shots": 2048, "seed": 2026,
    "max_qubits": 16, "restarts": 6, "maxiter": 300,
    "use_leftover_for_value": true,
    "auto_conflicts_from_crossings": false,      # treat geometrically crossing paths as conflicts
    "embedding": false                           # report a compact heavy-hex qubit layout
  }
}

Output (stdout, JSON): status, connected, total_cost, total_value, budget,
graph {nodes, edges (with stage = quantum | connector | extra)}, quantum stats incl. the QUBO.
Exit code: 0 = ok, 2 = infeasible, 1 = invalid input / internal error.
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
    auto_conflicts_from_crossings=False, embedding=False,
)


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
    opts.update(data.get("options", {}) or {})
    if not 0 <= float(opts["quantum_fraction"]) <= 1:
        raise InputError("quantum_fraction must be between 0 and 1")
    return budget, nodes, paths, conflicts, opts


def crossing_conflicts(nodes, paths):
    """Pairs of paths whose straight segments properly cross (no shared endpoint)."""
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    out = set()
    for p, q in combinations(paths, 2):
        if len({p["u"], p["v"], q["u"], q["v"]}) < 4:
            continue
        A, B, C, D = nodes[p["u"]], nodes[p["v"]], nodes[q["u"]], nodes[q["v"]]
        if orient(A, B, C) * orient(A, B, D) < 0 and orient(C, D, A) * orient(C, D, B) < 0:
            out.add(frozenset((p["id"], q["id"])))
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
                qc.rz(2 * gamma * h[i] / scale, i)
        for i in range(n):
            for j in range(i + 1, n):
                if not np.isclose(J[i, j], 0):
                    qc.rzz(2 * gamma * J[i, j] / scale, i, j)
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
    for trial in [0.25, 0.5, 1, 2, 3, 5, 8, 13, 21, lam_safe]:
        q = build_qubo(costs_int, values, conf_idx, bq_int, slack, trial, mu)
        E = qubo_energies(q, Y)
        if feasible_state[np.isclose(E, E.min())].all():
            lam = float(trial)
            break
    qubo = build_qubo(costs_int, values, conf_idx, bq_int, slack, lam, mu)
    E = qubo_energies(qubo, Y)
    ising = qubo_to_ising(qubo)
    scale = max(1.0, float(np.max(np.abs(ising["h"]))), float(np.max(np.abs(ising["J"]))))

    p_depth = int(opts["qaoa_depth"])
    def objective(angles):
        return float(qaoa_probabilities(angles, E, n, scale) @ E)
    starts = []
    for dt in (0.02, 0.05, 0.1):
        k = np.arange(1, p_depth + 1) / (p_depth + 1)
        x = np.empty(2 * p_depth); x[0::2] = 4 * dt * k; x[1::2] = 12 * dt * (1 - k); starts.append(x)
    for _ in range(max(0, int(opts["restarts"]) - 3)):
        x = np.empty(2 * p_depth); x[0::2] = rng.uniform(0, .3, p_depth)
        x[1::2] = rng.uniform(0, np.pi / 2, p_depth); starts.append(x)
    best = min((minimize(objective, s, method="COBYLA",
                         options={"maxiter": int(opts["maxiter"]), "rhobeg": .1}) for s in starts),
               key=lambda r: r.fun)
    angles = np.asarray(best.x, float)
    probs = qaoa_probabilities(angles, E, n, scale)
    counts, sampler = sample_counts(ising, angles, probs, int(opts["shots"]), int(opts["seed"]))

    shots = sum(counts.values())
    feas_samples = [(c, k) for k, c in counts.items() if feasible_state[k]]
    chosen = []
    if feas_samples:
        _, k_best = max(feas_samples, key=lambda t: (value_state[t[1]], t[0]))
        chosen = [cand[i]["id"] for i in range(nr) if Y[k_best, i]]
    opt_val = float(value_state[feasible_state].max())
    names = [f"x{i}" for i in range(nr)] + [f"s{k}" for k in range(ns)]
    stats = dict(
        sampler=sampler, qubits=n, route_qubits=nr, slack_qubits=ns, depth=p_depth,
        quantum_budget=bq, cost_unit_scale=unit, lam=lam, mu=mu, angles=angles.tolist(),
        expected_energy=float(probs @ E),
        p_feasible_uniform=float(feasible_state.mean()),
        p_feasible_qaoa=float(probs[feasible_state].sum()),
        feasible_sample_rate=sum(c for c, _ in feas_samples) / shots if shots else 0.0,
        best_sampled_value=float(sum(p["value"] for p in cand if p["id"] in chosen)),
        exact_optimum_value=opt_val,
        variables={**{f"x{i}": p["id"] for i, p in enumerate(cand)},
                   **{f"s{k}": f"slack weight {w}" for k, w in enumerate(slack)}},
        qubo=dict(variables=names, offset=float(qubo["offset"]),
                  linear={names[i]: float(c) for i, c in enumerate(qubo["linear"]) if c != 0},
                  quadratic={f"{names[i]}*{names[j]}": float(qubo["quadratic"][i, j])
                             for i in range(n) for j in range(i + 1, n) if qubo["quadratic"][i, j] != 0}),
    )
    if opts.get("embedding"):
        stats["embedding"] = compact_embedding(ising, angles, int(opts["seed"]))
    return chosen, stats, notes


# --------------------------------------------------------------------------- optional embedding
def compact_embedding(ising, angles, seed, iters=3000):
    """Pick the tightest connected patch on a 57-qubit heavy-hex map and route inside it."""
    import networkx as nx
    from qiskit import transpile
    from qiskit.transpiler import CouplingMap
    n = len(ising["h"])
    cmap = CouplingMap.from_heavy_hex(5)
    G = nx.Graph(); G.add_edges_from(cmap.get_edges())
    hop = dict(nx.all_pairs_shortest_path_length(G))
    pairs = [(i, j) for i in range(n) for j in range(i + 1, n) if not np.isclose(ising["J"][i, j], 0)]
    spread = lambda lay: sum(hop[lay[i]][lay[j]] - 1 for i, j in pairs)
    rng = np.random.default_rng(seed)
    best = None
    for start in rng.choice(cmap.size(), 4, replace=False):
        lay = list(nx.bfs_tree(G, int(start)))[:n]; c = spread(lay); T = 5.0
        cur_best = (c, lay[:])
        for _ in range(iters):
            T *= 0.999; new = lay[:]
            if rng.random() < .5:
                i, j = rng.choice(n, 2, replace=False); new[i], new[j] = new[j], new[i]
            else:
                used = set(lay); cand = [q for u in lay for q in G[u] if q not in used]
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
    patch = sorted(int(q) for q in best[1])
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
    if opts.get("auto_conflicts_from_crossings"):
        extra = crossing_conflicts(nodes, paths) - conflicts
        conflicts |= extra
        if extra:
            notes.append(f"Added {len(extra)} conflict pair(s) from crossing paths.")
    conflicts_out = [sorted(c, key=str) for c in conflicts]

    def result(status, **kw):
        return dict(status=status, budget=budget, conflict_pairs=conflicts_out, notes=notes, **kw)

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

    # 2. Quantum stage
    q_ids, q_stats, q_notes = run_quantum_stage(paths, conflicts, budget, opts)
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


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("input", nargs="?", help="input JSON file (default: stdin)")
    ap.add_argument("-o", "--output", help="output JSON file (default: stdout)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING,
                        stream=sys.stderr, format="%(levelname)s %(message)s")
    try:
        data = json.load(open(args.input, encoding="utf-8")) if args.input else json.load(sys.stdin)
        out = solve(data)
        code = 0 if out["status"] == "ok" else 2
    except (InputError, json.JSONDecodeError) as exc:
        out, code = dict(status="error", error=str(exc)), 1
    except Exception as exc:   # report, never crash silently inside the pod
        log.exception("internal error")
        out, code = dict(status="error", error=f"internal error: {exc}"), 1
    text = json.dumps(out, indent=2, ensure_ascii=False)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    else:
        print(text)
    return code


if __name__ == "__main__":
    sys.exit(main())