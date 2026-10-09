from fastapi import HTTPException, Request, status
from fastapi.testclient import TestClient

from app.api.v1.endpoints import routes
from app.core.security import create_access_token, decode_token, get_farm_context
from app.main import app

client = TestClient(app)

successful_route = {
    "found": True,
    "distance_m": 100.0,
    "total_cost": 100.0,
    "nodes": [1],
    "segments": [1],
    "affected_segments": [],
    "blocked_segments": [],
    "problems": [],
    "origin": {"latitude": -21.0, "longitude": -50.0},
    "destination": {"latitude": -21.001, "longitude": -50.001},
    "route": {
        "type": "Feature",
        "properties": {"distance_m": 100.0},
        "geometry": {
            "type": "LineString",
            "coordinates": [[-50.0, -21.0], [-50.001, -21.001]],
        },
    },
}


def test_calculate_route_endpoint_returns_geojson_route(monkeypatch):
    monkeypatch.setattr(routes.route_service, "calculate", lambda origin, destination, farm_id: successful_route)

    response = client.post(
        "/api/v1/routes/calculate",
        json={
            "origin": {"latitude": -21.0, "longitude": -50.0},
            "destination": {"latitude": -21.001, "longitude": -50.001},
        },
    )

    assert response.status_code == 200
    assert response.json()["route"]["geometry"]["type"] == "LineString"
    assert response.json()["route"]["geometry"]["coordinates"][0] == [-50.0, -21.0]


def test_calculate_route_rejects_invalid_coordinates():
    response = client.post(
        "/api/v1/routes/calculate",
        json={
            "origin": {"latitude": 91, "longitude": -50},
            "destination": {"latitude": -21, "longitude": -50},
        },
    )

    assert response.status_code == 422


def test_calculate_route_returns_controlled_not_found_error(monkeypatch):
    def no_route(*args):
        raise routes.RouteNotFound

    monkeypatch.setattr(routes.route_service, "calculate", no_route)

    response = client.post(
        "/api/v1/routes/calculate",
        json={
            "origin": {"latitude": -21.0, "longitude": -50.0},
            "destination": {"latitude": -21.001, "longitude": -50.001},
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Não existe rota disponível entre origem e destino."


def test_machine_to_structure_endpoint_returns_controlled_route(monkeypatch):
    monkeypatch.setattr(
        routes.route_service,
        "calculate_machine_to_structure",
        lambda machine_id, structure_id, farm_id: successful_route,
    )

    response = client.post("/api/v1/routes/machine/1/to-structure/2")

    assert response.status_code == 200
    assert response.json()["segments"] == [1]


def test_network_rebuild_requires_existing_bearer_authentication(monkeypatch):
    calls = []
    def authenticated_context(request: Request):
        authorization = request.headers.get("authorization", "")
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
        decode_token(authorization.removeprefix("Bearer "))
        return {"farm_id": 1, "permissions": {"roads.update"}, "role": "OWNER",
                "user": {"id": 1}, "assigned_machine_id": None}

    monkeypatch.setitem(app.dependency_overrides, get_farm_context, authenticated_context)
    monkeypatch.setattr(
        routes.network_service,
        "rebuild",
        lambda farm_id: calls.append(farm_id) or {"nodes_created": 3, "segments_created": 2},
    )
    monkeypatch.setattr(routes, "record_audit", lambda *args, **kwargs: None)

    unauthorized = client.post("/api/v1/routes/network/rebuild")
    token = create_access_token("admin")
    authorized = client.post(
        "/api/v1/routes/network/rebuild",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert unauthorized.status_code == 401
    assert authorized.status_code == 200
    assert authorized.json() == {"nodes_created": 3, "segments_created": 2}
    assert len(calls) == 1


def test_network_list_endpoints_return_repository_data(monkeypatch):
    node = {"id": 1, "geometry": {"type": "Point", "coordinates": [-50, -21]}, "created_at": "2026-10-09T00:00:00Z"}
    segment = {
        "id": 1,
        "road_id": 1,
        "from_node_id": 1,
        "to_node_id": 2,
        "geometry": {"type": "LineString", "coordinates": [[-50, -21], [-50.001, -21]]},
        "length_m": 100.0,
        "base_cost": 100.0,
        "cost": 100.0,
        "is_blocked": False,
        "problems": [],
        "created_at": "2026-10-09T00:00:00Z",
        "updated_at": "2026-10-09T00:00:00Z",
    }
    monkeypatch.setattr(routes.network_service, "list_nodes", lambda farm_id: [node])
    monkeypatch.setattr(routes.network_service, "list_segments", lambda farm_id: [segment])

    nodes = client.get("/api/v1/routes/nodes")
    segments = client.get("/api/v1/routes/segments")

    assert nodes.status_code == 200
    assert nodes.json()[0]["geometry"]["type"] == "Point"
    assert segments.status_code == 200
    assert segments.json()[0]["base_cost"] == 100.0
