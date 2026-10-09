from fastapi.testclient import TestClient

from app.api.v1.endpoints import locations, maquinas, telemetria
from app.core.security import get_farm_context
from app.main import app


client = TestClient(app)


def _operator_context():
    return {
        "user": {"id": 9, "username": "operator"},
        "farm_id": 3,
        "farm": {"id": 3, "name": "Farm"},
        "role": "OPERATOR",
        "permissions": {
            "machines.view",
            "telemetry.view",
            "telemetry.history",
        },
        "membership": None,
        "assigned_machine_id": 17,
    }


def test_operator_machine_list_is_limited_to_assigned_machine(monkeypatch):
    calls = []
    monkeypatch.setitem(app.dependency_overrides, get_farm_context, _operator_context)
    monkeypatch.setattr(
        maquinas.repository,
        "list_all",
        lambda farm_id, machine_id=None: calls.append((farm_id, machine_id)) or [],
    )

    response = client.get("/api/v1/machines")

    assert response.status_code == 200
    assert calls == [(3, 17)]


def test_operator_cannot_read_another_machines_location_or_telemetry(monkeypatch):
    calls = []
    monkeypatch.setitem(app.dependency_overrides, get_farm_context, _operator_context)
    monkeypatch.setattr(
        locations.repository,
        "list_locations",
        lambda **kwargs: calls.append(("location", kwargs)) or [],
    )
    monkeypatch.setattr(
        telemetria.repository,
        "list_recent",
        lambda machine_id=None, **kwargs: calls.append(("telemetry", {"machine_id": machine_id, **kwargs})) or [],
    )

    locations_response = client.get("/api/v1/locations/18")
    telemetry_response = client.get("/api/v1/telemetry/18")
    assigned_location_response = client.get("/api/v1/locations/17")
    assigned_telemetry_response = client.get("/api/v1/telemetry/17")

    assert locations_response.status_code == 404
    assert telemetry_response.status_code == 404
    assert assigned_location_response.status_code == 200
    assert assigned_telemetry_response.status_code == 200
    assert calls == [
        ("location", {"machine_id": 17, "limit": 100, "farm_id": 3}),
        ("telemetry", {"machine_id": 17, "farm_id": 3}),
    ]


def test_unassigned_operator_receives_no_machines_or_telemetry(monkeypatch):
    calls = []
    context = _operator_context()
    context["assigned_machine_id"] = None
    monkeypatch.setitem(app.dependency_overrides, get_farm_context, lambda: context)
    monkeypatch.setattr(
        maquinas.repository,
        "list_all",
        lambda *args, **kwargs: calls.append("machines") or [],
    )
    monkeypatch.setattr(
        telemetria.repository,
        "list_recent",
        lambda *args, **kwargs: calls.append("telemetry") or [],
    )

    machine_response = client.get("/api/v1/machines")
    telemetry_response = client.get("/api/v1/telemetry")

    assert machine_response.status_code == 200
    assert machine_response.json()["data"] == []
    assert telemetry_response.status_code == 200
    assert telemetry_response.json()["data"] == []
    assert calls == []
