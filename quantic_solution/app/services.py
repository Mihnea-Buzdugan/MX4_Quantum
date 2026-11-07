"""
Service layer: runs the QAOA railway planner without blocking the event loop.

The solver is CPU-bound pure Python/NumPy (COBYLA + state-vector simulation), so it runs in a
ProcessPoolExecutor. With options.execution = "ibm" the worker also waits for an IBM Quantum job
(up to options.ibm_timeout), so such requests can be long.

The planner script is expected at app/railway_planner.py and must expose:
    solve(data: dict) -> dict
    load_env_file(path=None)
    InputError
"""

import asyncio
import logging
import os
import threading

from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import Any

from .railway_planner import InputError, load_env_file, solve
from .schemas import SolveRequest


log = logging.getLogger("railway_service")

MAX_WORKERS = int(os.getenv("PLANNER_MAX_WORKERS", "2"))

# Real QPU runs spend the server's IBM credits: off unless explicitly enabled by the operator.
ALLOW_IBM = os.getenv("PLANNER_ALLOW_IBM", "false").strip().lower() in {"1", "true", "yes"}
# Local noisy simulation costs ~0.4 s per shot, so cap it.
MAX_FAKE_SHOTS = int(os.getenv("PLANNER_MAX_FAKE_SHOTS", "256"))
# Optional .env file with IBM_QUANTUM_TOKEN / IBM_QUANTUM_INSTANCE (real env vars always win).
ENV_FILE = os.getenv("PLANNER_ENV_FILE") or None


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


# HTTP status the router should use for each result["status"].
RESULT_HTTP_STATUS = {"ok": 200, "infeasible": 422, "pending": 202}


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


# -----------------------------------------------------------------------------
# Request mapping
# -----------------------------------------------------------------------------

def build_payload(req: SolveRequest) -> dict[str, Any]:
    """
    Convert the validated request into the exact dictionary
    expected by railway_planner.solve().
    """

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

        # the deprecated alias was already folded into auto_conflicts by the schema
        "options": req.options.model_dump(exclude={"auto_conflicts_from_crossings"}),
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
        PlannerError         (500)

    There is no application-level timeout.

    The HTTP request waits until the solver finishes, while the
    CPU-intensive calculation runs in a separate worker process.
    """

    _check_execution_policy(req)

    payload = build_payload(req)

    loop = asyncio.get_running_loop()

    try:
        # Execute the CPU-bound solver in a separate process.
        # No asyncio.wait_for() is used, so there is no timeout.
        result = await loop.run_in_executor(
            get_executor(),
            solve,
            payload,
        )

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