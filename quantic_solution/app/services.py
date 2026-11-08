"""
Service layer: runs the railway planner without blocking the event loop.

Two solvers share the same request and result format:
  * QAOA      (railway_planner.py)    - default
  * classical (railway_classical.py)  - when the request's algorithm label is "classic"/"classical"
                                        (exact MILP / pipeline / greedy, see SolveRequest.classical)

Both are CPU-bound pure Python/NumPy/SciPy (COBYLA + state-vector simulation, HiGHS MILP), so they
run in a ProcessPoolExecutor. With options.execution = "ibm" the worker also waits for an IBM Quantum
job (up to options.ibm_timeout), so such requests can be long.

The planner script is expected at app/railway_planner.py and must expose:
    solve(data: dict) -> dict
    load_env_file(path=None)
    InputError
plus, for the classical solver, the helpers railway_classical.py imports it for (parse_input,
detect_conflicts, count_components, ...). The classical script is expected at app/railway_classical.py.
"""

import asyncio
import logging
import os
import threading

from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import Any, Callable

from . import railway_classical, railway_planner
from .railway_planner import InputError, load_env_file, solve
from .schemas import SolveRequest


log = logging.getLogger("railway_service")

# Optional .env file (PLANNER_ALLOW_IBM, IBM_QUANTUM_TOKEN, IBM_QUANTUM_INSTANCE ...). Real
# environment variables always win. It is loaded here, before the settings below are read, so
# PLANNER_ALLOW_IBM in the .env file also works for the API process, not only for the workers.
ENV_FILE = os.getenv("PLANNER_ENV_FILE") or None
try:
    load_env_file(ENV_FILE)
except Exception:  # a missing/unreadable file must not stop the API from starting
    log.warning("could not load env file %r", ENV_FILE, exc_info=True)

MAX_WORKERS = int(os.getenv("PLANNER_MAX_WORKERS", "2"))

# Real QPU runs spend the server's IBM credits: off unless explicitly enabled by the operator.
ALLOW_IBM = os.getenv("PLANNER_ALLOW_IBM", "false").strip().lower() in {"1", "true", "yes"}
# A real-hardware request holds one worker (and the HTTP request) while the IBM job queues, so the
# wait is capped. After this many seconds the API answers "pending" with the job id.
MAX_IBM_TIMEOUT = float(os.getenv("PLANNER_MAX_IBM_TIMEOUT", "300"))
# Local noisy simulation costs ~0.4 s per shot, so cap it.
MAX_FAKE_SHOTS = int(os.getenv("PLANNER_MAX_FAKE_SHOTS", "256"))


# -----------------------------------------------------------------------------
# Errors
# -----------------------------------------------------------------------------

class PlannerError(Exception):
    """Unexpected failure inside the solver (HTTP 500)."""


class PlannerInputError(PlannerError):
    """The solver rejected the input (HTTP 422)."""


class PlannerUnavailable(PlannerError):
    """An optional dependency is missing (HTTP 503)."""


class PlannerBackendError(PlannerError):
    """The IBM Quantum execution failed and no fallback was requested (HTTP 502)."""


class PlannerTimeout(PlannerError):
    """The classical MILP hit its time limit without finding any network (HTTP 504)."""


# HTTP status the router should use for each result["status"].
RESULT_HTTP_STATUS = {"ok": 200, "infeasible": 422, "pending": 202,
                      "disconnected": 200, "no_valid_sample": 200}


# -----------------------------------------------------------------------------
# Process pool executor
# -----------------------------------------------------------------------------

_executor: ProcessPoolExecutor | None = None
_lock = threading.Lock()


def _init_worker() -> None:
    """Load IBM credentials from a .env file in every worker (no-op if there is none)."""
    try:
        load_env_file(ENV_FILE)
    except Exception:  # never prevent the worker from starting
        log.warning("could not load env file %r", ENV_FILE, exc_info=True)


def get_executor() -> ProcessPoolExecutor:
    """Return the shared process pool, creating it on the first request."""

    global _executor

    with _lock:
        if _executor is None:
            _executor = ProcessPoolExecutor(
                max_workers=MAX_WORKERS,
                initializer=_init_worker,
            )

        return _executor


def shutdown_executor() -> None:
    """
    Shut down the process pool.

    A new pool will be created automatically when the next request
    calls get_executor().
    """

    global _executor

    with _lock:
        if _executor is not None:
            _executor.shutdown(wait=False, cancel_futures=True)
            _executor = None


async def _run_in_pool(fn: Callable[..., dict[str, Any]], *args: Any) -> dict[str, Any]:
    """
    Run a CPU-bound solver in a worker process and map its failures to PlannerError subclasses.

    No asyncio.wait_for() is used, so there is no application-level timeout.
    """

    loop = asyncio.get_running_loop()

    try:
        return await loop.run_in_executor(get_executor(), fn, *args)

    except InputError as exc:
        raise PlannerInputError(str(exc)) from exc

    except ImportError as exc:
        raise PlannerUnavailable(
            f"Missing optional dependency: {exc}"
        ) from exc

    except BrokenProcessPool as exc:
        shutdown_executor()

        raise PlannerError(
            "Solver worker crashed; please retry."
        ) from exc

    except Exception as exc:
        log.exception("Solver failed")

        raise PlannerError(
            f"Internal solver error: {exc}"
        ) from exc


# -----------------------------------------------------------------------------
# Request mapping
# -----------------------------------------------------------------------------

def build_payload(req: SolveRequest) -> dict[str, Any]:
    """
    Convert the validated request into the exact dictionary
    expected by railway_planner.solve() (and railway_classical.classical_solve()).
    """

    options = req.options.model_dump(exclude={"auto_conflicts_from_crossings"})
    # never let one request occupy a worker for longer than the operator allows
    options["ibm_timeout"] = min(options["ibm_timeout"], MAX_IBM_TIMEOUT)

    return {
        "budget": req.budget,

        "nodes": {
            name: [x, y]
            for name, (x, y) in req.nodes_map().items()
        },

        "paths": [
            {
                "id": p.id,
                "from": p.from_,
                "to": p.to,
                "cost": p.cost,
                "value": p.value,
            }
            for p in req.paths
        ],

        "conflict_pairs": [list(pair) for pair in req.conflict_pairs],

        # req.algorithm (UI label) and req.classical are not forwarded: the schema already turned the
        # label into options.execution ("simulator" or "ibm"); the deprecated auto_conflicts alias was
        # folded too
        "options": options,
    }


def _check_execution_policy(req: SolveRequest) -> None:
    """Server-side limits for hardware execution (the request carries no credentials)."""

    opts = req.options

    if opts.execution == "ibm" and not ALLOW_IBM:
        raise PlannerInputError(
            "options.execution='ibm' is disabled on this server "
            "(set PLANNER_ALLOW_IBM=true to enable real IBM Quantum runs)."
        )

    if opts.execution == "ibm_fake":
        shots = opts.ibm_shots or 128  # planner default for the fake backend
        if shots > MAX_FAKE_SHOTS:
            raise PlannerInputError(
                f"options.ibm_shots is limited to {MAX_FAKE_SHOTS} for execution='ibm_fake'."
            )


# -----------------------------------------------------------------------------
# Public API
# -----------------------------------------------------------------------------

async def plan_network(
    req: SolveRequest,
    *,
    include_qubo: bool = False,
) -> dict[str, Any]:
    """
    Run the railway planner and return its result dictionary.

    A classic/classical algorithm label runs the classical solver instead of QAOA (see
    plan_network_classical; include_qubo does not apply to it).

    Possible result statuses (see RESULT_HTTP_STATUS):
        - ok          solved
        - infeasible  the network cannot be connected within the budget / conflicts
        - pending     an IBM job was submitted but is still running; the job id is in
                      result["quantum"]["execution"]["job_id"] - resubmit the same request
                      with options.ibm_job_id set to collect it

    Raises:
        PlannerInputError    (422)
        PlannerUnavailable   (503)
        PlannerBackendError  (502)
        PlannerTimeout       (504)  classical solver only
        PlannerError         (500)

    There is no application-level timeout.

    The HTTP request waits until the solver finishes, while the
    CPU-intensive calculation runs in a separate worker process.
    """

    if req.is_classical:
        return await plan_network_classical(req)

    _check_execution_policy(req)

    payload = build_payload(req)
    opts = req.options
    log.info("planning: algorithm=%r mode=%s execution=%s p=%d slack=%s iterations=%d shots=%d",
             req.algorithm, opts.mode, opts.execution, opts.qaoa_depth, opts.slack, opts.maxiter, opts.shots)

    # Execute the CPU-bound solver in a separate process.
    result = await _run_in_pool(solve, payload)

    # IBM execution failed without fallback (result carries the job info, if any).
    if result.get("status") == "error":
        raise PlannerBackendError(result.get("reason") or "IBM execution failed")

    # Strip the bulky intermediate results unless explicitly requested.
    # The QUBO / Ising formulas and optimiser traces can contain thousands of lines.
    quantum = result.get("quantum")
    if not include_qubo and isinstance(quantum, dict):
        quantum.pop("qubo", None)
        quantum.pop("ising", None)
        if isinstance(quantum.get("angles"), dict):
            quantum["angles"].pop("starts", None)

    return result


def _solve_classical(
    payload: dict[str, Any],
    method: str,
    benchmark: bool,
    time_limit: float,
) -> dict[str, Any]:
    """
    Runs inside a pool worker (module-level so it can be pickled).

    A worker handles one request at a time, and the "pipeline" method restores the planner's
    run_quantum_stage when it finishes, so its temporary patch cannot affect another request.
    """

    return railway_classical.classical_solve(
        payload, railway_planner, method, benchmark, None, time_limit,
    )


async def plan_network_classical(req: SolveRequest) -> dict[str, Any]:
    """
    Solve with the classical solver chosen in req.classical:
        exact     global optimum of the whole problem (MILP)
        pipeline  the QAOA pipeline with an exact solver instead of QAOA
        greedy    cheapest conflict-free connection, then fill the budget

    Result statuses: ok / infeasible (never pending). The MILP stops by itself after
    req.classical.time_limit seconds; if it has no network by then, PlannerTimeout is raised.

    Raises:
        PlannerInputError    (422)
        PlannerUnavailable   (503)  e.g. scipy missing
        PlannerTimeout       (504)
        PlannerError         (500)
    """

    opts = req.classical
    payload = build_payload(req)
    log.info("planning: classical method=%s benchmark=%s time_limit=%s",
             opts.method, opts.benchmark, opts.time_limit)

    result = await _run_in_pool(
        _solve_classical, payload, opts.method, opts.benchmark, opts.time_limit,
    )

    # classical stage names -> the keys SolveResponse uses ("connector" -> "connectors")
    breakdown = result.get("cost_breakdown")
    if breakdown and "connector" in breakdown:
        breakdown["connectors"] = breakdown.pop("connector")

    # HiGHS status 1 = time limit; with no solution found it is reported as "infeasible"
    info = result.get("classical") or {}
    if result.get("status") == "infeasible" and info.get("status_code") == 1:
        raise PlannerTimeout(
            f"The classical solver hit its {opts.time_limit:g}s time limit "
            "without finding a network; raise classical.time_limit or use method='greedy'."
        )

    return result