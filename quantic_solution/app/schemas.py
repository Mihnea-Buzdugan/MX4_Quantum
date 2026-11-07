"""Pydantic v2 schemas for the railway planner API.

The request mirrors the JSON structure accepted by the QAOA planner (new version with geometric
conflict detection, circuit export and optional IBM Quantum execution), so any input that works
with the script works here too. Validation happens up front so malformed input is rejected with
a clear 422 before any computation starts.

The same request can also be solved classically (railway_classical.py): send an `algorithm` label
that contains "classic" / "classical" (and not "quantum"), optionally tuned with `classical`.
"""
import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PathId = int | str

# Coordinates are plain finite floats: their range depends on options.coordinate_system
# ("lonlat" -> degrees, checked in SolveRequest; "xy" -> any planar units).
Coord = Annotated[float, Field(allow_inf_nan=False)]
Coordinate = tuple[Coord, Coord]  # [lon, lat] or [x, y]

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
    "options": {"quantum_fraction": 0.8, "qaoa_depth": 2, "shots": 2048, "seed": 2026,
                "max_qubits": 16, "auto_conflicts": True, "min_clearance": 0},
}



# ----------------------------------------------------------------------------- algorithm -> solver / execution
# The UI sends the algorithm it ran ("Quantum Algorithm (Simulated)", "quantum-hardware", "classic", ...).
# A classical label picks the classical solver; a quantum label decides where the final QAOA circuit
# is sampled.
_ALLOWED_EXECUTIONS = {
    "simulator": {"simulator"},
    "ibm": {"ibm", "ibm_fake"},  # ibm_fake = local noisy copy of an IBM device, for testing
}


def _normalize_label(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", label.lower())


def is_classical_algorithm(label: str | None) -> bool:
    """'classic' / 'Classic Algorithm' / 'classical-exact' -> True. Anything mentioning
    'quantum' is never classical, so 'Quantum + classical completion' stays quantum."""
    if not label:
        return False
    text = _normalize_label(label)
    return "classic" in text and "quantum" not in text


def execution_for_algorithm(label: str | None) -> Literal["simulator", "ibm"] | None:
    """'Quantum Algorithm (Real Hardware)' / 'quantum-hardware' -> 'ibm';
    '... (Simulated)' / 'quantum-simulated' -> 'simulator'; classical or anything else -> None."""
    if not label or is_classical_algorithm(label):
        return None
    text = _normalize_label(label)
    if "hardware" in text or "ibm" in text:
        return "ibm"
    if "simulat" in text:
        return "simulator"
    return None

# ----------------------------------------------------------------------------- request
class NodeIn(BaseModel):
    """List-style node: {"name": "Iasi", "lon": 27.6, "lat": 47.17} (lon/lat double as x/y for "xy")."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    lon: Coord
    lat: Coord


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

    # ---- optimisation
    quantum_fraction: float = Field(0.8, ge=0, le=1)
    qaoa_depth: int = Field(2, ge=1, le=6)
    shots: int = Field(2048, ge=1, le=100_000)
    seed: int = 2026
    max_qubits: int = Field(16, ge=2, le=20)
    restarts: int = Field(6, ge=1, le=30)
    maxiter: int = Field(300, ge=1, le=3000)
    use_leftover_for_value: bool = True

    # ---- geometric conflict detection (on by default, like the script)
    auto_conflicts: bool = True
    coordinate_system: Literal["lonlat", "xy"] = "lonlat"
    min_clearance: float = Field(0.0, ge=0, allow_inf_nan=False, description="km (lonlat) or xy units")
    auto_conflicts_from_crossings: bool | None = Field(
        None, description="Deprecated alias of auto_conflicts.")

    # ---- reporting
    embedding: bool = False
    include_circuit: bool = Field(False, description="Script default is true; off here to keep responses small.")
    circuit_formats: list[Literal["qasm3", "qasm2", "qasm3_parameterized"]] = Field(
        default_factory=lambda: ["qasm3"])

    # ---- where the final circuit is sampled (credentials are server-side env vars, never in the request)
    execution: Literal["simulator", "ibm", "ibm_fake"] = "simulator"
    ibm_backend: str = Field("", max_length=64)
    ibm_shots: int | None = Field(None, ge=1, le=100_000)
    ibm_layout: Literal["best", "auto", "compact"] = "best"
    ibm_optimization_level: int = Field(3, ge=0, le=3)
    ibm_dynamical_decoupling: bool = True
    ibm_twirling: bool = False
    ibm_timeout: float = Field(3600, gt=0, le=86_400, allow_inf_nan=False)
    ibm_job_id: str = Field("", max_length=128, description="Collect an already submitted IBM job.")
    ibm_fallback: bool = False

    @model_validator(mode="after")
    def _legacy_alias(self) -> "Options":
        if (self.auto_conflicts_from_crossings is not None
                and "auto_conflicts" not in self.model_fields_set):
            self.auto_conflicts = self.auto_conflicts_from_crossings
        return self


class ClassicalOptions(BaseModel):
    """Settings for the classical solver (railway_classical.py). Only used when the algorithm is classical.

    exact     global optimum of the whole problem (MILP): budget + conflicts + all cities connected
    pipeline  the QAOA pipeline with the QAOA stage replaced by an exact solver of the same sub-problem
    greedy    cheapest conflict-free connection, then fill the budget by value per cost
    """

    model_config = ConfigDict(extra="forbid")

    method: Literal["exact", "pipeline", "greedy"] = "exact"
    benchmark: bool = Field(False, description="Run all classical methods and add a `benchmark` comparison.")
    time_limit: float = Field(60.0, gt=0, le=600, allow_inf_nan=False,
                              description="MILP time limit in seconds.")


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"example": _EXAMPLE_REQUEST})

    budget: float = Field(ge=0, allow_inf_nan=False)
    nodes: dict[str, Coordinate] | list[NodeIn]
    paths: list[PathIn] = Field(max_length=500)
    conflict_pairs: list[tuple[PathId, PathId]] = Field(
        default_factory=list, description="Optional extra, non-geometric conflicts.")
    options: Options = Field(default_factory=Options)
    algorithm: str | None = Field(
        default=None, max_length=100,
        description="Algorithm label from the UI. A classic/classical label runs the classical solver "
                    "(see `classical`). A hardware label runs the final QAOA circuit on IBM hardware "
                    "(options.execution='ibm'); a simulated label runs it on the simulator.")
    classical: ClassicalOptions = Field(
        default_factory=ClassicalOptions,
        description="Classical solver settings; ignored unless the algorithm is classical.")

    # -- helpers used by the service layer
    @property
    def is_classical(self) -> bool:
        return is_classical_algorithm(self.algorithm)

    def nodes_map(self) -> dict[str, tuple[float, float]]:
        if isinstance(self.nodes, dict):
            return {name: (x, y) for name, (x, y) in self.nodes.items()}
        return {n.name: (n.lon, n.lat) for n in self.nodes}

    @model_validator(mode="after")
    def _apply_algorithm(self) -> "SolveRequest":
        if self.is_classical:
            return self  # classical solver: options.execution (IBM / simulator) does not apply
        mode = execution_for_algorithm(self.algorithm)
        if mode is None:
            return self  # unknown/absent label: options.execution decides
        if "execution" in self.options.model_fields_set:
            if self.options.execution not in _ALLOWED_EXECUTIONS[mode]:
                raise ValueError(
                    f"algorithm {self.algorithm!r} implies execution {mode!r}, "
                    f"but options.execution is {self.options.execution!r}")
        else:
            self.options.execution = mode
        return self

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

        if self.options.coordinate_system == "lonlat":
            for name, (lon, lat) in self.nodes_map().items():
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    raise ValueError(f"node {name!r}: lon/lat out of range "
                                     "(use options.coordinate_system='xy' for planar coordinates)")

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

        # manual conflicts
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
    # quantum/connector/extra: QAOA planner. classical: method "exact". core/connector/extra: method "pipeline"
    # (core = the stage that QAOA would solve). connector/extra: method "greedy".
    stage: Literal["quantum", "classical", "core", "connector", "extra"]


class GraphOut(BaseModel):
    nodes: list[NodeOut]
    edges: list[EdgeOut]


class CostBreakdown(BaseModel):
    """Cost per stage; only the stages of the solver that ran are set.
    QAOA: quantum + connectors + extra. Classical: classical (exact) or core + connectors + extra."""

    quantum: float | None = None
    classical: float | None = None
    core: float | None = None
    connectors: float | None = None
    extra: float | None = None


class ConflictOut(BaseModel):
    """A conflict pair: detected geometrically (crossing/touching/overlap/too_close) or manual."""

    model_config = ConfigDict(extra="allow")  # also carries distance_km / distance for too_close

    paths: list[PathId]
    type: Literal["crossing", "touching", "overlap", "too_close", "manual"]
    at: list[float] | None = None


class QuantumStats(BaseModel):
    """Diagnostics of the QAOA stage. Unknown keys are passed through untouched."""

    model_config = ConfigDict(extra="allow")

    skipped: bool | None = None
    reason: str | None = None
    sampler: str | None = None
    qubits: int | None = None
    route_qubits: int | None = None
    slack_qubits: int | None = None
    layers: int | None = None
    quantum_budget: float | None = None
    expected_energy: float | None = None
    p_feasible_uniform: float | None = None
    p_feasible_qaoa: float | None = None
    feasible_sample_rate: float | None = None
    best_sampled_value: float | None = None
    exact_optimum_value: float | None = None
    variables: dict[str, PathId] | None = None
    penalties: dict[str, Any] | None = None   # lam, mu, slack weights, lam ladder
    angles: dict[str, Any] | None = None      # gammas, betas (+ "starts" only with ?include_qubo=true)
    qubo: dict[str, Any] | None = None        # only with ?include_qubo=true
    ising: dict[str, Any] | None = None       # only with ?include_qubo=true
    circuit: dict[str, Any] | None = None     # only with options.include_circuit=true
    execution: dict[str, Any] | None = None   # IBM / fake-backend runs (also set when pending)
    embedding: dict[str, Any] | None = None   # only with options.embedding=true


class ClassicalStats(BaseModel):
    """Diagnostics of the classical solver. Unknown keys are passed through untouched."""

    model_config = ConfigDict(extra="allow")

    method: Literal["exact", "pipeline", "greedy"] | None = None
    solver: str | None = None
    runtime_seconds: float | None = None
    # exact (MILP)
    proven_optimal: bool | None = None
    upper_bound_value: float | None = None
    mip_gap: float | None = None
    variables: int | None = None
    binary_variables: int | None = None
    constraints: int | None = None
    status_code: int | None = None
    message: str | None = None
    # pipeline
    core_stage: dict[str, Any] | None = None
    notes: list[str] | None = None


class SolveResponse(BaseModel):
    """status == "ok" (200), "infeasible" (422) or "pending" (202, IBM job still running)."""

    status: Literal["ok", "infeasible", "pending"]
    connected: bool
    budget: float
    conflicts: list[ConflictOut] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)

    # infeasible / pending
    reason: str | None = None
    minimum_connection_cost: float | None = None

    # ok only
    total_cost: float | None = None
    total_value: float | None = None
    remaining_budget: float | None = None
    runtime_seconds: float | None = None
    cost_breakdown: CostBreakdown | None = None
    graph: GraphOut | None = None

    # ok, or pending (then only quantum.execution with the job id)
    quantum: QuantumStats | None = None

    # classical solver only (algorithm "classic")
    classical: ClassicalStats | None = None
    benchmark: dict[str, Any] | None = None   # only with classical.benchmark=true


class ErrorResponse(BaseModel):
    detail: str