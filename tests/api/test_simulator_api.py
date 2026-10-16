from fastapi.testclient import TestClient

from app.api.v1.endpoints import simulator
from app.core.security import get_farm_context
from app.main import app

client = TestClient(app)


def test_simulator_context_uses_selected_farm_and_existing_resolver(monkeypatch):
    calls = []
    monkeypatch.setattr(
        simulator.simulator_context_resolver,
        "resolve",
        lambda machine_id, farm_id: calls.append((machine_id, farm_id)) or {
            "machine": {"id": machine_id, "farm_id": farm_id},
            "simulator_state": "WAITING_OPERATION",
        },
    )

    response = client.get("/api/v1/simulator/machines/4/context")

    assert response.status_code == 200
    assert response.json()["data"]["simulator_state"] == "WAITING_OPERATION"
    assert calls == [(4, 1)]


def test_simulator_context_rejects_operator_request_for_other_machine(monkeypatch):
    context = {
        "farm_id": 3,
        "role": "OPERATOR",
        "assigned_machine_id": 17,
        "permissions": {"machines.view"},
    }
    calls = []
    monkeypatch.setitem(app.dependency_overrides, get_farm_context, lambda: context)
    monkeypatch.setattr(
        simulator.simulator_context_resolver,
        "resolve",
        lambda *args: calls.append(args),
    )

    response = client.get("/api/v1/simulator/machines/18/context")

    assert response.status_code == 404
    assert calls == []


def test_simulator_location_validation_uses_authenticated_farm(monkeypatch):
    calls = []
    monkeypatch.setattr(
        simulator.simulated_location_validator,
        "validate",
        lambda machine_id, farm_id, latitude, longitude: calls.append(
            (machine_id, farm_id, latitude, longitude)
        ) or {"valid": True, "location_scope": "INSIDE_OPERATIONAL_AREA"},
    )

    response = client.post(
        "/api/v1/simulator/machines/4/validate-location",
        json={"latitude": -23.5, "longitude": -47.4, "farm_id": 999},
    )

    assert response.status_code == 200
    assert response.json()["data"]["valid"] is True
    assert calls == [(4, 1, -23.5, -47.4)]


def test_simulator_location_validation_rejects_out_of_range_coordinates():
    response = client.post(
        "/api/v1/simulator/machines/4/validate-location",
        json={"latitude": 91, "longitude": -47.4},
    )

    assert response.status_code == 422
