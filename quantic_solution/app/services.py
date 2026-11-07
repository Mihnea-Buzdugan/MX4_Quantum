"""
Service layer: runs the QAOA railway planner without blocking the event loop.

The solver is CPU-bound pure Python/NumPy (COBYLA + state-vector simulation),
so it runs in a ProcessPoolExecutor.

The planner script is expected at app/railway_planner.py and must expose:
    solve(data: dict) -> dict
    InputError
"""

import asyncio
import logging
import os
import threading

from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import Any

from .railway_planner import InputError, solve
from .schemas import SolveRequest


log = logging.getLogger("railway_service")

MAX_WORKERS = int(os.getenv("PLANNER_MAX_WORKERS", "2"))


# -----------------------------------------------------------------------------
# Errors
# -----------------------------------------------------------------------------

class PlannerError(Exception):
    """Unexpected failure inside the solver (HTTP 500)."""


class PlannerInputError(PlannerError):
    """The solver rejected the input (HTTP 422)."""


class PlannerUnavailable(PlannerError):
    """An optional dependency is missing (HTTP 503)."""


# -----------------------------------------------------------------------------
# Process pool executor
# -----------------------------------------------------------------------------

_executor: ProcessPoolExecutor | None = None
_lock = threading.Lock()


def get_executor() -> ProcessPoolExecutor:
    """
    Return the shared process pool.

    Create it on the first request.
    """

    global _executor

    with _lock:
        if _executor is None:
            _executor = ProcessPoolExecutor(
                max_workers=MAX_WORKERS
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
            _executor.shutdown(
                wait=False,
                cancel_futures=True
            )

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
            name: [lon, lat]
            for name, (lon, lat) in req.nodes_map().items()
        },

        "paths": [
            {
                "id": p.id,
                "from": p.from_,
                "to": p.to,
                "cost": p.cost,
                "value": p.value
            }
            for p in req.paths
        ],

        "conflict_pairs": [
            list(pair)
            for pair in req.conflict_pairs
        ],

        "options": req.options.model_dump(),
    }


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

    Possible result statuses:
        - ok
        - infeasible

    Raises:
        PlannerInputError
        PlannerUnavailable
        PlannerError

    There is no application-level timeout.

    The HTTP request waits until the solver finishes, while the
    CPU-intensive calculation runs in a separate worker process.
    """

    payload = build_payload(req)

    loop = asyncio.get_running_loop()

    try:
        # Execute the CPU-bound solver in a separate process.
        # No asyncio.wait_for() is used, so there is no timeout.
        result = await loop.run_in_executor(
            get_executor(),
            solve,
            payload
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

    # Remove the QUBO from the response unless explicitly requested.
    # The QUBO can contain thousands of lines.
    if (
        not include_qubo
        and isinstance(result.get("quantum"), dict)
    ):
        result["quantum"].pop("qubo", None)

    return result