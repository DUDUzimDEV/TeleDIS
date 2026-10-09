import pytest

from app.api.v1.endpoints import (
    fields, farms, maquinas, operations, road_problems, roads, routes, structures, teams, users,
)
from app.core.security import get_farm_context
from app.main import app


OWNER_PERMISSIONS = {
    "farm.view", "farm.create", "farm.update", "farm.delete",
    "users.view", "users.create", "users.update", "users.delete", "users.permissions",
    "machines.view", "machines.create", "machines.update", "machines.delete",
    "telemetry.view", "telemetry.history",
    "fields.view", "fields.create", "fields.update", "fields.delete",
    "structures.view", "structures.create", "structures.update", "structures.delete",
    "roads.view", "roads.create", "roads.update", "roads.delete",
    "routes.view", "routes.create", "routes.execute",
    "road_problems.view", "road_problems.create", "road_problems.update", "road_problems.resolve",
    "alerts.view", "alerts.manage", "maintenance.view", "maintenance.create", "maintenance.update",
    "reports.view", "reports.export", "audit.view", "settings.view", "settings.update",
    "teams.view", "teams.manage", "operations.view", "operations.create",
    "operations.update", "operations.assign", "operations.execute", "operations.history",
}


@pytest.fixture(autouse=True)
def owner_farm_context(monkeypatch, request):
    if request.node.get_closest_marker("real_database"):
        yield
        return

    for endpoint in (fields, farms, maquinas, operations, road_problems, roads, routes, structures, teams, users):
        if hasattr(endpoint, "record_audit"):
            monkeypatch.setattr(endpoint, "record_audit", lambda *args, **kwargs: None)

    def test_context():
        return {
            "user": {
                "id": 1,
                "username": "test-owner",
                "email": "owner@example.invalid",
                "full_name": "Test Owner",
            },
            "farm_id": 1,
            "farm": {
                "id": 1,
                "name": "Test Farm",
                "code": "TEST-FARM",
                "municipality": None,
                "state": None,
                "status": "active",
            },
            "role": "OWNER",
            "permissions": OWNER_PERMISSIONS,
            "membership": None,
            "assigned_machine_id": None,
        }

    monkeypatch.setitem(app.dependency_overrides, get_farm_context, test_context)
    yield
    app.dependency_overrides.pop(get_farm_context, None)
