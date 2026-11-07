from django.contrib import admin
from .models import User, PlanEdge, PlanNode, RailwayPlan, SimulationBatch

admin.site.register(User)
admin.site.register(RailwayPlan)
admin.site.register(SimulationBatch)
