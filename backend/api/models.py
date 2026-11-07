from django.conf import settings
from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser, PermissionsMixin
from django.db import models, transaction
from django.contrib.postgres.fields import ArrayField
from django.utils.crypto  import get_random_string
from django.db.models import F

class User(AbstractUser):

    email = models.EmailField(unique=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["first_name", "last_name", "username"]

    def __str__(self):
        return self.email


class SimulationBatch(models.Model):
    """A batch of simulations started from the Batch Simulations page.

    The batch keeps the shared setup and the parameters of every planned run; each run that
    reached the planner is a RailwayPlan with batch = this batch and batch_index = its number.
    """

    class Status(models.TextChoices):
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        STOPPED = "stopped", "Stopped"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="simulation_batches",
    )
    name = models.CharField(max_length=120, blank=True)
    algorithm = models.CharField(max_length=60, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.RUNNING)
    budget = models.FloatField()
    nodes = models.JSONField(default=list, blank=True)       # selected city names
    routes = models.JSONField(default=list, blank=True)      # candidate routes [{id, from, to, cost, value}]
    runs = models.JSONField(default=list, blank=True)        # planned parameters, one object per simulation
    statistics = models.JSONField(null=True, blank=True)     # summary computed by the frontend at the end
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "-created_at"])]

    def __str__(self):
        return f"Batch #{self.pk} ({len(self.runs)} runs) by {self.user}"

    def summary(self, saved=None, valid=None):
        return {
            "id": self.pk,
            "name": self.name,
            "algorithm": self.algorithm,
            "status": self.status,
            "budget": self.budget,
            "nodes": self.nodes if isinstance(self.nodes, list) else [],
            "run_count": len(self.runs) if isinstance(self.runs, list) else 0,
            "saved_runs": saved,
            "valid_runs": valid,
            "statistics": self.statistics,
            "created_at": self.created_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
        }


# planner option name -> name shown in the history (the four QAOA settings + context)
SAVED_PARAMETERS = {
    "qaoa_depth": "p", "p": "p",
    "slack": "slack",
    "maxiter": "iterations", "iterations": "iterations",
    "shots": "shots", "nr_shots": "shots",
    "seed": "seed",
    "execution": "execution",
    "max_qubits": "max_qubits",
}


def parameters_from_request(request_data):
    """The run's settings (p, slack, iterations, shots, seed, ...) from the request options."""
    options = (request_data or {}).get("options") or {}
    return {name: options[key] for key, name in SAVED_PARAMETERS.items() if key in options}


class RailwayPlan(models.Model):
    """One saved planner run (the whole FastAPI response), owned by a user."""

    class Status(models.TextChoices):
        OK = "ok", "OK"
        INFEASIBLE = "infeasible", "Infeasible"
        PENDING = "pending", "Pending (IBM job running)"
        DISCONNECTED = "disconnected", "No connected sample"
        NO_VALID_SAMPLE = "no_valid_sample", "No valid sample"
        ERROR = "error", "Error"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="railway_plans",
    )
    algorithm = models.CharField(max_length=60, blank=True)
    batch = models.ForeignKey(
        SimulationBatch,
        on_delete=models.CASCADE,
        related_name="plans",
        null=True,
        blank=True,
    )
    batch_index = models.PositiveIntegerField(null=True, blank=True)  # 1-based simulation number
    status = models.CharField(max_length=20, choices=Status.choices)
    connected = models.BooleanField(default=False)
    reason = models.TextField(blank=True)

    budget = models.FloatField()
    total_cost = models.FloatField(null=True, blank=True)
    total_value = models.FloatField(null=True, blank=True)
    remaining_budget = models.FloatField(null=True, blank=True)
    minimum_connection_cost = models.FloatField(null=True, blank=True)

    # cost_breakdown
    quantum_cost = models.FloatField(null=True, blank=True)
    connector_cost = models.FloatField(null=True, blank=True)
    extra_cost = models.FloatField(null=True, blank=True)

    # Free-form diagnostics
    conflict_pairs = models.JSONField(default=list, blank=True)
    notes = models.JSONField(default=list, blank=True)
    quantum_stats = models.JSONField(null=True, blank=True)

    # what was asked: the four QAOA settings etc., and the full request (nodes, paths, options)
    parameters = models.JSONField(default=dict, blank=True)
    request = models.JSONField(null=True, blank=True)
    runtime_seconds = models.FloatField(null=True, blank=True)  # planner time (server side)
    http_status = models.PositiveSmallIntegerField(null=True, blank=True)

    execution_ms = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "-created_at"])]

    def __str__(self):
        return f"Plan #{self.pk} ({self.status}) by {self.user}"

    @property
    def is_valid(self):
        return (
            self.status == self.Status.OK
            and bool(self.connected)
            and self.total_cost is not None
            and self.budget is not None
            and self.total_cost <= self.budget + 1e-9
        )

    def fallback_summary(self):
        """Minimal row when summary() fails for a damaged run (logged by the view)."""
        return {
            "id": self.pk,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "algorithm": self.algorithm or "",
            "status": self.status or "error",
            "connected": False,
            "valid": False,
            "reason": "This saved run could not be read completely.",
            "budget": self.budget,
            "total_cost": None,
            "total_value": None,
            "execution_ms": None,
            "runtime_seconds": None,
            "parameters": {},
            "batch_id": None,
            "batch_index": None,
            "node_count": 0,
            "route_count": 0,
        }

    def summary(self):
        """One row of the run history.

        Written defensively: runs saved before migration 0004 have no parameters / request,
        and a damaged JSON value must not break the whole list.
        """
        parameters = self.parameters if isinstance(self.parameters, dict) else {}
        request = self.request if isinstance(self.request, dict) else {}
        nodes = request.get("nodes")
        paths = request.get("paths")
        return {
            "id": self.pk,
            "created_at": self.created_at.isoformat(),
            "algorithm": self.algorithm,
            "status": self.status,
            "connected": self.connected,
            "valid": self.is_valid,
            "reason": self.reason or None,
            "budget": self.budget,
            "total_cost": self.total_cost,
            "total_value": self.total_value,
            "execution_ms": self.execution_ms,
            "runtime_seconds": self.runtime_seconds,
            "parameters": parameters,
            "batch_id": self.batch_id,
            "batch_index": self.batch_index,
            "node_count": len(nodes) if isinstance(nodes, (dict, list)) else 0,
            "route_count": len(paths) if isinstance(paths, list) else 0,
        }

    @classmethod
    @transaction.atomic
    def from_response(cls, user, data, algorithm="", execution_ms=None, request_data=None,
                      batch=None, batch_index=None, http_status=None):
        """Create a plan, its nodes and its edges from the planner's JSON response.

        Error results (no planner response) are saved too: data = {"status": "error", "reason": ...}.
        """
        breakdown = data.get("cost_breakdown") or {}
        plan = cls.objects.create(
            user=user,
            algorithm=algorithm,
            batch=batch,
            batch_index=batch_index,
            parameters=parameters_from_request(request_data),
            request=request_data,
            runtime_seconds=data.get("runtime_seconds"),
            http_status=http_status,
            status=data["status"],
            connected=bool(data.get("connected", False)),
            reason=data.get("reason") or "",
            budget=data["budget"],
            total_cost=data.get("total_cost"),
            total_value=data.get("total_value"),
            remaining_budget=data.get("remaining_budget"),
            minimum_connection_cost=data.get("minimum_connection_cost"),
            quantum_cost=breakdown.get("quantum"),
            connector_cost=breakdown.get("connectors"),
            extra_cost=breakdown.get("extra"),
            conflict_pairs=data.get("conflicts") or data.get("conflict_pairs") or [],
            notes=data.get("notes") or [],
            quantum_stats=data.get("quantum"),
            execution_ms=execution_ms,
        )

        graph = data.get("graph") or {}  # infeasible responses have no graph

        nodes = PlanNode.objects.bulk_create([
            PlanNode(plan=plan, name=n["name"], lon=n["lon"], lat=n["lat"])
            for n in graph.get("nodes", [])
        ])
        nodes_by_name = {node.name: node for node in nodes}

        PlanEdge.objects.bulk_create([
            PlanEdge(
                plan=plan,
                route_id=e["id"],
                from_node=nodes_by_name[e["from"]],
                to_node=nodes_by_name[e["to"]],
                cost=e["cost"],
                value=e["value"],
                stage=e["stage"],
            )
            for e in graph.get("edges", [])
        ])
        return plan

    def to_response(self):
        """Rebuild the same JSON shape the planner returned, so the map can be redrawn.

        Uses .all() so prefetch_related("nodes", "edges__from_node", "edges__to_node") avoids
        extra queries when many plans are loaded (a batch).
        """
        nodes = list(self.nodes.all())
        edges = list(self.edges.all())
        return {
            "id": self.pk,
            "plan_id": self.pk,
            "algorithm": self.algorithm,
            "created_at": self.created_at.isoformat(),
            "execution_ms": self.execution_ms,
            "runtime_seconds": self.runtime_seconds,
            "http_status": self.http_status,
            "parameters": self.parameters if isinstance(self.parameters, dict) else {},
            "request": self.request if isinstance(self.request, dict) else None,
            "batch_id": self.batch_id,
            "batch_index": self.batch_index,
            "valid": self.is_valid,
            "status": self.status,
            "connected": self.connected,
            "reason": self.reason or None,
            "budget": self.budget,
            "total_cost": self.total_cost,
            "total_value": self.total_value,
            "remaining_budget": self.remaining_budget,
            "minimum_connection_cost": self.minimum_connection_cost,
            "conflict_pairs": self.conflict_pairs if isinstance(self.conflict_pairs, list) else [],
            "conflicts": self.conflict_pairs if isinstance(self.conflict_pairs, list) else [],
            "notes": self.notes if isinstance(self.notes, list) else [],
            "cost_breakdown": {
                "quantum": self.quantum_cost,
                "connectors": self.connector_cost,
                "extra": self.extra_cost,
            },
            "graph": {
                "nodes": [{"name": n.name, "lon": n.lon, "lat": n.lat} for n in nodes],
                "edges": [
                    {
                        "id": e.route_id,
                        "from": e.from_node.name,
                        "to": e.to_node.name,
                        "cost": e.cost,
                        "value": e.value,
                        "stage": e.stage,
                    }
                    for e in edges
                ],
            },
            "quantum": self.quantum_stats if isinstance(self.quantum_stats, dict) else None,
        }


class PlanNode(models.Model):
    """A city in the returned network."""

    plan = models.ForeignKey(RailwayPlan, on_delete=models.CASCADE, related_name="nodes")
    name = models.CharField(max_length=120)
    lon = models.FloatField()
    lat = models.FloatField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["plan", "name"], name="unique_node_per_plan"),
        ]

    def __str__(self):
        return self.name


class PlanEdge(models.Model):
    """A route used in the returned network."""

    class Stage(models.TextChoices):
        QUANTUM = "quantum", "Quantum"
        CONNECTOR = "connector", "Connector"
        EXTRA = "extra", "Extra"

    plan = models.ForeignKey(RailwayPlan, on_delete=models.CASCADE, related_name="edges")
    route_id = models.CharField(max_length=100)
    from_node = models.ForeignKey(PlanNode, on_delete=models.CASCADE, related_name="outgoing_edges")
    to_node = models.ForeignKey(PlanNode, on_delete=models.CASCADE, related_name="incoming_edges")
    cost = models.FloatField()
    value = models.FloatField()
    stage = models.CharField(max_length=20, choices=Stage.choices)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["plan", "route_id"], name="unique_route_per_plan"),
        ]

    def __str__(self):
        return f"{self.from_node} → {self.to_node} ({self.stage})"