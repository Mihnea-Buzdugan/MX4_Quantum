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


class RailwayPlan(models.Model):
    """One saved planner run (the whole FastAPI response), owned by a user."""

    class Status(models.TextChoices):
        OK = "ok", "OK"
        INFEASIBLE = "infeasible", "Infeasible"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="railway_plans",
    )
    algorithm = models.CharField(max_length=60, blank=True)
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

    execution_ms = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "-created_at"])]

    def __str__(self):
        return f"Plan #{self.pk} ({self.status}) by {self.user}"

    @classmethod
    @transaction.atomic
    def from_response(cls, user, data, algorithm="", execution_ms=None):
        """Create a plan, its nodes and its edges from the planner's JSON response."""
        breakdown = data.get("cost_breakdown") or {}
        plan = cls.objects.create(
            user=user,
            algorithm=algorithm,
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
            conflict_pairs=data.get("conflict_pairs") or [],
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
        """Rebuild the same JSON shape the planner returned, so the map can be redrawn."""
        nodes = list(self.nodes.all())
        edges = list(self.edges.select_related("from_node", "to_node"))
        return {
            "id": self.pk,
            "algorithm": self.algorithm,
            "created_at": self.created_at.isoformat(),
            "execution_ms": self.execution_ms,
            "status": self.status,
            "connected": self.connected,
            "reason": self.reason or None,
            "budget": self.budget,
            "total_cost": self.total_cost,
            "total_value": self.total_value,
            "remaining_budget": self.remaining_budget,
            "minimum_connection_cost": self.minimum_connection_cost,
            "conflict_pairs": self.conflict_pairs,
            "notes": self.notes,
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
            "quantum": self.quantum_stats,
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