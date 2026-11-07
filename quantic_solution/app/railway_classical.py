#!/usr/bin/env python3
"""
Railway network planner: CLASSICAL solvers for the same problem as railway_planner.py (QAOA).

Same input JSON, same conflict detection (imported from the quantum planner, so both solve exactly
the same problem), same output shape (status, totals, conflicts, graph {nodes, edges}) plus a
"classical" section with solver details and, with --benchmark / --compare, a "benchmark" section.

Methods
  exact     Global optimum of the WHOLE problem as a mixed-integer linear program (HiGHS via SciPy):
              maximise  sum v_e x_e
              s.t.      sum c_e x_e <= B                              (budget)
                        x_a + x_b <= 1          for every conflict    (no intertwined routes)
                        every city connected                          (single-commodity flow:
                        a root sends one unit of flow to every other city, flow only on built routes)
            Ties in value are broken towards lower cost. Proven optimal unless the time limit hits.
  pipeline  The quantum planner's own pipeline with the QAOA stage replaced by an EXACT classical
            solver of the same sub-problem (same candidate routes, at most quantum_fraction of the
            budget, no conflicts: a knapsack with conflicts). Isolates "QAOA vs exact" for stage 2.
  greedy    Simple baseline: cheapest conflict-free connection (Kruskal), then fill the leftover
            budget with the best value-per-cost routes.

Usage
  python railway_classical.py input.json -o classical_result.json                 # exact (default)
  python railway_classical.py input.json --method greedy
  python railway_classical.py input.json --benchmark -o classical_result.json     # all methods
  python railway_classical.py input.json --benchmark --compare result.json        # + quantum result
The quantum planner file must be next to this script (railway_planner.py or alg_quant_2.py) or be
given with --planner PATH (or the RAILWAY_PLANNER_PATH environment variable).
Edge "stage" values: exact -> "classical"; pipeline -> "core" / "connector" / "extra";
greedy -> "connector" / "extra".
Exit code: 0 = ok, 2 = infeasible, 1 = invalid input / internal error.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import logging
import math
import os
import sys
import time
from itertools import combinations
from pathlib import Path

import numpy as np

log = logging.getLogger("railway_classical")
METHODS = ("exact", "pipeline", "greedy")


# --------------------------------------------------------------------------- shared problem code
def load_planner(path=None):
    """Import the quantum planner module so parsing and conflict detection are identical."""
    here = Path(__file__).resolve().parent
    if path or os.environ.get("RAILWAY_PLANNER_PATH"):
        candidates = [Path(path or os.environ["RAILWAY_PLANNER_PATH"])]
    else:
        candidates = [here / "railway_planner.py", here / "alg_quant_2.py", Path.cwd() / "railway_planner.py"]
    for f in candidates:
        if f.is_file():
            spec = importlib.util.spec_from_file_location("railway_planner", f)
            mod = importlib.util.module_from_spec(spec)
            sys.modules["railway_planner"] = mod
            spec.loader.exec_module(mod)
            if hasattr(mod, "detect_conflicts") and hasattr(mod, "parse_input"):
                return mod
    raise SystemExit("Quantum planner not found: put railway_planner.py (or alg_quant_2.py) next to this "
                     "script or pass --planner PATH")


def build_problem(rp, data):
    """Parse the input and detect conflicts exactly like the quantum planner does."""
    budget, nodes, paths, conflicts, opts = rp.parse_input(data)
    conflicts_out = []
    manual = set(conflicts)
    if opts.get("auto_conflicts", True):
        for rec in rp.detect_conflicts(nodes, paths, opts["coordinate_system"], float(opts["min_clearance"])):
            conflicts.add(frozenset(rec["paths"]))
            conflicts_out.append(rec)
    detected = {frozenset(r["paths"]) for r in conflicts_out}
    conflicts_out += [dict(paths=sorted(c, key=str), type="manual") for c in manual - detected]
    return budget, nodes, paths, conflicts, opts, conflicts_out


def validate(rp, nodes, paths, conflicts, budget, edge_ids):
    """Independent check of any network (classical or quantum)."""
    by_id = {p["id"]: p for p in paths}
    unknown = [i for i in edge_ids if i not in by_id]
    ids = [i for i in edge_ids if i in by_id]
    cost = sum(by_id[i]["cost"] for i in ids)
    value = sum(by_id[i]["value"] for i in ids)
    bad = [sorted([a, b], key=str) for a, b in combinations(ids, 2) if frozenset((a, b)) in conflicts]
    connected = rp.count_components(nodes, [by_id[i] for i in ids]) == 1
    return dict(valid=bool(connected and cost <= budget + 1e-9 and not bad and not unknown),
                connected=bool(connected), within_budget=bool(cost <= budget + 1e-9),
                conflicts_violated=bad, unknown_routes=unknown, cost=float(cost), value=float(value))


# --------------------------------------------------------------------------- exact MILP
def solve_exact(nodes, paths, conflicts, budget, time_limit=60.0):
    """Global optimum of the whole problem (budget + conflicts + all cities connected)."""
    from scipy.optimize import milp, LinearConstraint, Bounds
    from scipy.sparse import coo_matrix
    t0 = time.perf_counter()
    names = list(nodes)
    idx = {k: i for i, k in enumerate(names)}
    N, m = len(names), len(paths)
    cost = np.array([p["cost"] for p in paths], float)
    value = np.array([p["value"] for p in paths], float)
    U = np.array([idx[p["u"]] for p in paths]); V = np.array([idx[p["v"]] for p in paths])
    big = max(N - 1, 1)
    nv = 3 * m                                       # x_e, flow u->v, flow v->u
    eps = 1e-6 / (cost.sum() + 1)                    # tie-break: same value -> cheaper
    c = np.zeros(nv); c[:m] = -value + eps * cost
    rows, cols, vals, lo, hi = [], [], [], [], []
    r = 0
    def add(entries, lb, ub):
        nonlocal r
        for col, v in entries:
            rows.append(r); cols.append(col); vals.append(v)
        lo.append(lb); hi.append(ub); r += 1
    add([(e, cost[e]) for e in range(m)], -np.inf, budget)                      # budget
    pid = {p["id"]: e for e, p in enumerate(paths)}
    for pair in conflicts:                                                     # conflicts
        a, b = tuple(pair)
        if a in pid and b in pid:
            add([(pid[a], 1.0), (pid[b], 1.0)], -np.inf, 1.0)
    if N > 1:
        for e in range(m):                                                     # flow only on built routes
            add([(m + e, 1.0), (e, -big)], -np.inf, 0.0)
            add([(2 * m + e, 1.0), (e, -big)], -np.inf, 0.0)
        for k in range(1, N):                                                  # each city consumes 1 unit
            ent = []
            for e in range(m):
                if V[e] == k: ent += [(m + e, 1.0), (2 * m + e, -1.0)]         # u->v flows in, v->u flows out
                if U[e] == k: ent += [(m + e, -1.0), (2 * m + e, 1.0)]
            add(ent, 1.0, 1.0)
    A = coo_matrix((vals, (rows, cols)), shape=(r, nv)).tocsr()
    integrality = np.r_[np.ones(m), np.zeros(2 * m)]
    bounds = Bounds(np.zeros(nv), np.r_[np.ones(m), np.full(2 * m, big)])
    res = milp(c, constraints=LinearConstraint(A, lo, hi), integrality=integrality, bounds=bounds,
               options={"time_limit": float(time_limit), "mip_rel_gap": 0.0, "disp": False})
    secs = time.perf_counter() - t0
    info = dict(solver="HiGHS MILP (scipy.optimize.milp)", variables=nv, binary_variables=m,
                constraints=r, runtime_seconds=round(secs, 3), status_code=int(res.status),
                message=str(res.message))
    if res.x is None:
        info["proven_optimal"] = False
        return None, info
    chosen = [paths[e]["id"] for e in range(m) if res.x[e] > 0.5]
    bound = getattr(res, "mip_dual_bound", None)
    info.update(proven_optimal=res.status == 0,
                upper_bound_value=None if bound is None or not np.isfinite(bound) else round(-float(bound), 6),
                mip_gap=None if getattr(res, "mip_gap", None) is None else float(res.mip_gap))
    return chosen, info


def solve_knapsack_conflicts(items, conflicts, cap, time_limit=30.0):
    """max sum value, sum cost <= cap, no conflicting pair (exact, MILP)."""
    from scipy.optimize import milp, LinearConstraint, Bounds
    if not items:
        return [], 0.0
    m = len(items)
    c = -np.array([it["value"] for it in items], float)
    A = [np.array([it["cost"] for it in items], float)]; lo = [-np.inf]; hi = [cap]
    pos = {it["id"]: k for k, it in enumerate(items)}
    for pair in conflicts:
        a, b = tuple(pair)
        if a in pos and b in pos:
            row = np.zeros(m); row[pos[a]] = row[pos[b]] = 1; A.append(row); lo.append(-np.inf); hi.append(1)
    res = milp(c, constraints=LinearConstraint(np.array(A), lo, hi), integrality=np.ones(m),
               bounds=Bounds(0, 1), options={"time_limit": float(time_limit), "mip_rel_gap": 0.0})
    if res.x is None:
        return [], 0.0
    chosen = [items[k]["id"] for k in range(m) if res.x[k] > 0.5]
    return chosen, float(-res.fun)


# --------------------------------------------------------------------------- pipeline (same as quantum)
def solve_pipeline(rp, data, time_limit=30.0):
    """Run the quantum planner's solve() with its QAOA stage swapped for an exact classical solver
    of the very same sub-problem (same candidates, same budget share, same conflicts)."""
    stage_info = {}

    def classical_stage(paths, conflicts, budget, opts):
        t0 = time.perf_counter()
        bq = float(opts["quantum_fraction"]) * budget
        cand = [p for p in paths if p["cost"] <= bq + 1e-9]
        notes = []
        if opts.get("pipeline_candidates", "same") == "same":    # identical candidate selection
            _, unit = rp.to_integer_units([p["cost"] for p in cand] or [0.0])
            slack = rp.slack_weights(int(math.floor(bq * unit + 1e-9)))
            max_routes = int(opts["max_qubits"]) - len(slack)
            if len(cand) > max_routes:
                cand = sorted(cand, key=lambda p: (-(p["value"] / max(p["cost"], 1e-9)), str(p["id"])))[:max_routes]
                notes.append(f"Core stage limited to the same {max_routes} candidate routes as the quantum stage.")
        chosen, val = solve_knapsack_conflicts(cand, conflicts, bq, time_limit)
        stage_info.update(candidates=len(cand), core_budget=bq, core_value=val, core_routes=chosen,
                          runtime_seconds=round(time.perf_counter() - t0, 4))
        return chosen, dict(solver="exact knapsack with conflicts (MILP)", **stage_info), notes

    original = rp.run_quantum_stage
    rp.run_quantum_stage = classical_stage
    try:
        out = rp.solve(json.loads(json.dumps(data)))
    finally:
        rp.run_quantum_stage = original
    return out, stage_info


# --------------------------------------------------------------------------- greedy baseline
def solve_greedy(rp, nodes, paths, conflicts, budget):
    t0 = time.perf_counter()
    conn, spent, ok = rp.complete_network(nodes, paths, conflicts, [], budget)
    if not ok:
        return None, None, dict(runtime_seconds=round(time.perf_counter() - t0, 4))
    built, extra = list(conn), []
    for p in sorted(paths, key=lambda p: (-(p["value"] / max(p["cost"], 1e-9)), str(p["id"]))):
        if p["id"] in built or p["value"] <= 0 or rp.conflicts_with(p, built, conflicts):
            continue
        if spent + p["cost"] <= budget + 1e-9:
            built.append(p["id"]); extra.append(p["id"]); spent += p["cost"]
    return conn, extra, dict(runtime_seconds=round(time.perf_counter() - t0, 4))


# --------------------------------------------------------------------------- output
def network_result(nodes, paths, budget, conflicts_out, stages, method, details, check):
    """Same top-level shape as the quantum planner's result.json."""
    by_id = {p["id"]: p for p in paths}
    edges = [dict(id=i, **{"from": by_id[i]["u"], "to": by_id[i]["v"]}, cost=by_id[i]["cost"],
                  value=by_id[i]["value"], stage=s) for i, s in stages]
    breakdown = {}
    for i, s in stages:
        breakdown[s] = breakdown.get(s, 0.0) + by_id[i]["cost"]
    return dict(status="ok", connected=check["connected"], total_cost=check["cost"], total_value=check["value"],
                remaining_budget=round(budget - check["cost"], 9), cost_breakdown=breakdown,
                runtime_seconds=details.get("runtime_seconds"), budget=budget, notes=[],
                conflicts=conflicts_out,
                graph=dict(nodes=[dict(name=k, lon=x, lat=y) for k, (x, y) in nodes.items()], edges=edges),
                classical=dict(method=method, **details))


def run_method(rp, method, data, problem, time_limit):
    budget, nodes, paths, conflicts, opts, conflicts_out = problem
    if method == "exact":
        chosen, info = solve_exact(nodes, paths, conflicts, budget, time_limit)
        if chosen is None:
            return None, info
        chk = validate(rp, nodes, paths, conflicts, budget, chosen)
        return network_result(nodes, paths, budget, conflicts_out, [(i, "classical") for i in chosen],
                              "exact", info, chk), info
    if method == "pipeline":
        t0 = time.perf_counter()
        out, stage = solve_pipeline(rp, data, time_limit)
        secs = round(time.perf_counter() - t0, 3)
        if out.get("status") != "ok":
            return None, dict(runtime_seconds=secs, status=out.get("status"), reason=out.get("reason"))
        stages = [(e["id"], {"quantum": "core"}.get(e["stage"], e["stage"])) for e in out["graph"]["edges"]]
        chk = validate(rp, nodes, paths, conflicts, budget, [i for i, _ in stages])
        info = dict(runtime_seconds=secs, core_stage=stage, notes=out.get("notes", []))
        res = network_result(nodes, paths, budget, conflicts_out, stages, "pipeline", info, chk)
        res["notes"] = out.get("notes", [])
        return res, info
    if method == "greedy":
        conn, extra, info = solve_greedy(rp, nodes, paths, conflicts, budget)
        if conn is None:
            return None, info
        stages = [(i, "connector") for i in conn] + [(i, "extra") for i in extra]
        chk = validate(rp, nodes, paths, conflicts, budget, [i for i, _ in stages])
        return network_result(nodes, paths, budget, conflicts_out, stages, "greedy",
                              dict(solver="Kruskal + value-per-cost fill", **info), chk), info
    raise ValueError(method)


def benchmark_row(name, check, runtime, optimum, extra=None):
    gap = None
    if optimum and check:
        gap = round(100 * (optimum - check["value"]) / optimum, 3) if optimum > 0 else 0.0
    row = dict(method=name, valid=check["valid"] if check else False,
               value=check["value"] if check else None, cost=check["cost"] if check else None,
               gap_to_optimum_pct=gap, runtime_seconds=runtime)
    if check and not check["valid"]:
        row["problems"] = {k: check[k] for k in ("connected", "within_budget", "conflicts_violated", "unknown_routes")}
    if extra:
        row.update(extra)
    return row


def compare_quantum(rp, problem, quantum, optimum):
    budget, nodes, paths, conflicts, opts, _ = problem
    if quantum.get("status") != "ok":
        return dict(method="quantum (QAOA)", valid=False, status=quantum.get("status"), reason=quantum.get("reason"))
    ids = [e["id"] for e in quantum["graph"]["edges"]]
    chk = validate(rp, nodes, paths, conflicts, budget, ids)
    q_nodes = {n_["name"] for n_ in quantum["graph"].get("nodes", [])}
    mismatch = []
    if quantum.get("budget") is not None and abs(float(quantum["budget"]) - budget) > 1e-9:
        mismatch.append(f"budget {quantum['budget']} vs {budget}")
    if q_nodes and q_nodes != set(nodes):
        mismatch.append("different cities")
    q = quantum.get("quantum", {})
    extra = dict(sampler=q.get("sampler"), qubits=q.get("qubits"), layers=q.get("layers"),
                 quantum_stage_value=q.get("best_sampled_value"),
                 quantum_stage_exact_optimum=q.get("exact_optimum_value"),
                 p_feasible_qaoa=q.get("p_feasible_qaoa"), p_feasible_uniform=q.get("p_feasible_uniform"),
                 timing=q.get("timing"))
    if q.get("execution"):
        ex = q["execution"]
        extra["hardware"] = {k: ex.get(k) for k in ("backend", "shots", "isa_two_qubit_gates", "estimated_success",
                                                     "quantum_seconds", "job_id")}
    if mismatch:
        extra["warning"] = "quantum result was made from a DIFFERENT input (" + ", ".join(mismatch) + "); not comparable"
    return benchmark_row("quantum (QAOA)", chk, quantum.get("runtime_seconds"), optimum, extra)


# --------------------------------------------------------------------------- main
def classical_solve(data, rp, method="exact", benchmark=False, quantum=None, time_limit=60.0):
    problem = build_problem(rp, data)
    budget, nodes, paths, conflicts, opts, conflicts_out = problem
    if rp.count_components(nodes, paths) > 1:
        return dict(status="infeasible", connected=False, budget=budget, conflicts=conflicts_out,
                    reason="The candidate paths cannot connect all nodes (graph is disconnected).")
    methods = METHODS if (benchmark or quantum is not None) else (method,)
    if method not in methods:
        methods = (method,) + tuple(methods)
    results, infos = {}, {}
    for mth in methods:
        log.info("running %s", mth)
        results[mth], infos[mth] = run_method(rp, mth, data, problem, time_limit)
    primary = results.get(method)
    if primary is None:
        return dict(status="infeasible", connected=False, budget=budget, conflicts=conflicts_out,
                    reason=f"{method}: no connected conflict-free network within the budget "
                           f"({infos[method].get('message', infos[method].get('reason', ''))})",
                    classical=dict(method=method, **infos[method]))
    if len(methods) > 1:
        ex = results.get("exact")
        opt_value = ex["total_value"] if ex else None
        proven = bool(ex and ex["classical"].get("proven_optimal"))
        rows = []
        for mth in methods:
            r = results[mth]
            chk = validate(rp, nodes, paths, conflicts, budget, [e["id"] for e in r["graph"]["edges"]]) if r else None
            extra = {}
            if mth == "pipeline" and r:
                extra = dict(core_stage_value=r["classical"]["core_stage"].get("core_value"))
            if mth == "exact" and r:
                extra = dict(proven_optimal=r["classical"].get("proven_optimal"))
            rows.append(benchmark_row(mth, chk, infos[mth].get("runtime_seconds"), opt_value, extra))
        if quantum is not None:
            rows.append(compare_quantum(rp, problem, quantum, opt_value))
        primary["benchmark"] = dict(
            optimum=dict(value=opt_value, cost=ex["total_cost"] if ex else None, proven_optimal=proven),
            methods=rows,
            note=("gap_to_optimum_pct = how far below the proven best total value; runtime_seconds is wall time "
                  "(quantum: training on the exact simulator + sampling; on IBM it includes the queue)."))
    return primary


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("input", nargs="?", help="input JSON file (default: stdin)")
    ap.add_argument("-o", "--output", help="output JSON file (default: stdout)")
    ap.add_argument("-m", "--method", choices=METHODS, default="exact")
    ap.add_argument("--benchmark", action="store_true", help="run all classical methods and add a comparison")
    ap.add_argument("--compare", help="quantum result.json for the same input, added to the benchmark")
    ap.add_argument("--time-limit", type=float, default=60.0, help="MILP time limit in seconds (default 60)")
    ap.add_argument("--planner", help="path to the quantum planner .py (default: next to this script)")
    ap.add_argument("-f", "--format", choices=["compact", "pretty", "min"], default="compact")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr, format="%(levelname)s %(message)s")
    log.setLevel(logging.INFO if args.verbose else logging.WARNING)
    rp = load_planner(args.planner)
    try:
        data = json.load(open(args.input, encoding="utf-8")) if args.input else json.load(sys.stdin)
        quantum = json.load(open(args.compare, encoding="utf-8")) if args.compare else None
        out = classical_solve(data, rp, args.method, args.benchmark, quantum, args.time_limit)
        code = {"ok": 0, "infeasible": 2}.get(out["status"], 1)
    except (rp.InputError, json.JSONDecodeError, OSError) as exc:
        out, code = dict(status="error", error=str(exc)), 1
    except Exception as exc:
        log.exception("internal error")
        out, code = dict(status="error", error=f"internal error: {exc}"), 1
    text = rp.to_json(out, args.format)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    else:
        print(text)
    return code


if __name__ == "__main__":
    sys.exit(main())