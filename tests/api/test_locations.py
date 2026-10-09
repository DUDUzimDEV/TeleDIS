from fastapi.testclient import TestClient

from app.api.v1.endpoints import locations
from app.main import app

client = TestClient(app)


def test_list_locations_endpoint_returns_coordinates(monkeypatch):
    saved = [{
        "id": 4,
        "maquina_id": 1,
        "timestamp": "2026-10-01T14:10:00Z",
        "latitude": -23.500467,
        "longitude": -47.4521,
    }]
    monkeypatch.setattr(locations.repository, "list_locations", lambda **kwargs: saved)

    response = client.get("/api/v1/locations")

    assert response.status_code == 200
    assert response.json()["data"] == saved


def test_machine_locations_endpoint_filters_by_machine(monkeypatch):
    calls = []

    def list_locations(machine_id=None, limit=100, farm_id=None):
        calls.append((machine_id, limit, farm_id))
        return []

    monkeypatch.setattr(locations.repository, "list_locations", list_locations)

    response = client.get("/api/v1/locations/1?limit=25")

    assert response.status_code == 200
    assert response.json()["data"]["maquina_id"] == 1
    assert calls == [(1, 25, 1)]