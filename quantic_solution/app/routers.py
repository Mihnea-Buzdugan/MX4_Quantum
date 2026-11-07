"""HTTP endpoints for the railway planner."""
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response, status

from .schemas import ErrorResponse, Options, SolveRequest, SolveResponse
from .services import (
    PlannerError,
    PlannerInputError,
    PlannerUnavailable,
    plan_network,
)

router = APIRouter(prefix="/railway", tags=["railway"])


@router.post(
    "/plan",
    response_model=SolveResponse,
    response_model_exclude_none=True,  # drop fields that don't apply (e.g. graph when infeasible)
    summary="Plan a connected railway network (QAOA + classical completion)",
    responses={
        422: {
            "model": SolveResponse,
            "description": "Invalid input, or the problem is infeasible (body has status='infeasible' and a reason).",
        },
        500: {"model": ErrorResponse, "description": "Unexpected solver failure."},
        503: {"model": ErrorResponse, "description": "Optional dependency missing (e.g. qiskit for embedding)."},
        504: {"model": ErrorResponse, "description": "Solver timed out."},
    },
)
async def plan(
    body: SolveRequest,
    response: Response,
    include_qubo: bool = Query(False, description="Include the full QUBO in quantum stats (large)."),
) -> Any:
    try:
        result = await plan_network(body, include_qubo=include_qubo)
    except PlannerInputError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except PlannerTimeout as exc:
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc))
    except PlannerUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except PlannerError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    if result["status"] == "infeasible":
        response.status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    return result


@router.get("/options/defaults", response_model=Options, summary="Default solver options")
async def default_options() -> Options:
    return Options()