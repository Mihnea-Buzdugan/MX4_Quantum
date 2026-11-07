"""Pydantic v2 schemas for the railway planner API.

The request mirrors the JSON structure accepted by the QAOA planner, so any
input that works with the script works here too. Validation happens up front
so malformed input is rejected with a clear 422 before any computation starts.
"""
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PathId = int | str

Lon = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
Lat = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Coordinate = tuple[Lon, Lat]  # [lon, lat]

_EXAMPLE_REQUEST = {
    "budget": 24,
    "nodes": {
        "Iași": [27.6, 47.16667],
        "București": [26.10626, 44.43225],
        "Cluj-Napoca": [23.6, 46.76667],
        "Timișoara": [21.22571, 45.75372],
        "Brașov": [25.60613, 45.64861],
        "Sibiu": [24.15, 45.8],
        "Craiova": [23.8, 44.31667],
        "Constanța": [28.63432, 44.18073],
    },
    "paths": [
        {"id": 0, "from": "Iași", "to": "Brașov", "cost": 2, "value": 4},
        {"id": 1, "from": "Iași", "to": "Cluj-Napoca", "cost": 3, "value": 6},
        {"id": 2, "from": "Cluj-Napoca", "to": "Brașov", "cost": 2, "value": 5},
        {"id": 3, "from": "Timișoara", "to": "Cluj-Napoca", "cost": 4, "value": 7},
        {"id": 4, "from": "Timișoara", "to": "Sibiu", "cost": 3, "value": 6},
        {"id": 5, "from": "Sibiu", "to": "Brașov", "cost": 2, "value": 4},
        {"id": 6, "from": "Brașov", "to": "București", "cost": 4, "value": 9},
        {"id": 7, "from": "Sibiu", "to": "Craiova", "cost": 2, "value": 4},
        {"id": 8, "from": "București", "to": "Constanța", "cost": 4, "value": 7},
        {"id": 9, "from": "Craiova", "to": "București", "cost": 2, "value": 5},
        {"id": 10, "from": "Cluj-Napoca", "to": "Sibiu", "cost": 2, "value": 4},
        {"id": 11, "from": "Iași", "to": "Constanța", "cost": 6, "value": 11},
    ],
    "conflict_pairs": [[0, 1], [3, 4], [6, 9]],
    "options": {"quantum_fraction": 0.8, "qaoa_depth": 2, "shots": 2048, "seed": 2026, "max_qubits": 16},
}


# ----------------------------------------------------------------------------- request
class NodeIn(BaseModel):
    """List-style node: {"name": "Iasi", "lon": 27.6, "lat": 47.17}."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    lon: Lon
    lat: Lat


class PathIn(BaseModel):
    """A candidate route between two nodes."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: PathId | None = Field(default=None, description="Defaults to the index in the list.")
    from_: str = Field(alias="from")
    to: str
    cost: float = Field(ge=0, allow_inf_nan=False)
    value: float = Field(default=1.0, allow_inf_nan=False)

    @field_validator("cost")
    @classmethod
    def _max_two_decimals(cls, v: float) -> float:
        # The QUBO slack encoding needs integer cost units (see to_integer_units in the solver).
        if abs(round(v * 100) - v * 100) > 1e-6:
            raise ValueError("cost must have at most 2 decimal places")
        return v


class Options(BaseModel):
    """Solver options. Upper bounds protect the server: QAOA state-vector simulation is O(2^qubits)."""

    model_config = ConfigDict(extra="forbid")

    quantum_fraction: float = Field(0.8, ge=0, le=1)
    qaoa_depth: int = Field(2, ge=1, le=6)
    shots: int = Field(2048, ge=1, le=100_000)
    seed: int = 2026
    max_qubits: int = Field(16, ge=2, le=20)
    restarts: int = Field(6, ge=1, le=30)
    maxiter: int = Field(300, ge=1, le=3000)
    use_leftover_for_value: bool = True
    auto_conflicts_from_crossings: bool = False
    embedding: bool = False


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"example": _EXAMPLE_REQUEST})

    budget: float = Field(ge=0, allow_inf_nan=False)
    nodes: dict[str, Coordinate] | list[NodeIn]
    paths: list[PathIn] = Field(max_length=500)
    conflict_pairs: list[tuple[PathId, PathId]] = Field(default_factory=list)
    options: Options = Field(default_factory=Options)

    # -- helpers used by the service layer
    def nodes_map(self) -> dict[str, tuple[float, float]]:
        if isinstance(self.nodes, dict):
            return {name: (lon, lat) for name, (lon, lat) in self.nodes.items()}
        return {n.name: (n.lon, n.lat) for n in self.nodes}

    @model_validator(mode="after")
    def _check_consistency(self) -> "SolveRequest":
        # nodes
        if isinstance(self.nodes, list):
            names = [n.name for n in self.nodes]
            if len(set(names)) != len(names):
                raise ValueError("duplicate node names")
        else:
            names = list(self.nodes)
        if not names:
            raise ValueError("at least one node is required")
        if len(names) > 200:
            raise ValueError("at most 200 nodes are allowed")
        known = set(names)

        # paths (assign default ids, then check them)
        seen: set[PathId] = set()
        for k, p in enumerate(self.paths):
            if p.id is None:
                p.id = k
            if p.id in seen:
                raise ValueError(f"duplicate path id {p.id!r}")
            seen.add(p.id)
            if p.from_ not in known or p.to not in known:
                raise ValueError(f"path {p.id!r} uses an unknown node")
            if p.from_ == p.to:
                raise ValueError(f"path {p.id!r} is a self-loop")

        # conflicts
        for a, b in self.conflict_pairs:
            if a not in seen or b not in seen or a == b:
                raise ValueError(f"conflict pair [{a!r}, {b!r}] references unknown or identical paths")
        return self


# ----------------------------------------------------------------------------- response
class NodeOut(BaseModel):
    name: str
    lon: float
    lat: float


class EdgeOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: PathId
    from_: str = Field(alias="from")
    to: str
    cost: float
    value: float
    stage: Literal["quantum", "connector", "extra"]


class GraphOut(BaseModel):
    nodes: list[NodeOut]
    edges: list[EdgeOut]


class CostBreakdown(BaseModel):
    quantum: float
    connectors: float
    extra: float


class QuantumStats(BaseModel):
    """Diagnostics of the QAOA stage. Unknown keys are passed through untouched."""

    model_config = ConfigDict(extra="allow")

    skipped: bool | None = None
    reason: str | None = None
    sampler: str | None = None
    qubits: int | None = None
    route_qubits: int | None = None
    slack_qubits: int | None = None
    depth: int | None = None
    quantum_budget: float | None = None
    cost_unit_scale: int | None = None
    lam: float | None = None
    mu: float | None = None
    angles: list[float] | None = None
    expected_energy: float | None = None
    p_feasible_uniform: float | None = None
    p_feasible_qaoa: float | None = None
    feasible_sample_rate: float | None = None
    best_sampled_value: float | None = None
    exact_optimum_value: float | None = None
    variables: dict[str, PathId] | None = None
    qubo: dict[str, Any] | None = None       # only with ?include_qubo=true
    embedding: dict[str, Any] | None = None  # only with options.embedding=true


class SolveResponse(BaseModel):
    """Returned for both outcomes: status == "ok" (200) or "infeasible" (422)."""

    status: Literal["ok", "infeasible"]
    connected: bool
    budget: float
    conflict_pairs: list[list[PathId]]
    notes: list[str] = Field(default_factory=list)

    # infeasible only
    reason: str | None = None
    minimum_connection_cost: float | None = None

    # ok only
    total_cost: float | None = None
    total_value: float | None = None
    remaining_budget: float | None = None
    cost_breakdown: CostBreakdown | None = None
    graph: GraphOut | None = None
    quantum: QuantumStats | None = None


class ErrorResponse(BaseModel):
    detail: str