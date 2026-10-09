from fastapi.testclient import TestClient

from app.api.v1.endpoints import farms
from app.core.security import get_farm_context
from app.main import app
from app.services.spatial_validation_service import spatial_validation_service

client = TestClient(app)

polygon = {
    "type": "Polygon",
    "coordinates": [[
        [-50.123, -21.123],
        [-50.122, -21.123],
        [-50.122, -21.124],
        [-50.123, -21.124],
        [-50.123, -21.123],
    ]],
}


def test_get_operational_area_uses_active_farm(monkeypatch):
    monkeypatch.setattr(
        spatial_validation_service,
        "get_area",
        lambda farm_id: {"farm_id": farm_id, "configured": False},
    )

    response = client.get("/api/v1/farms/1/operational-area")
    wrong_farm = client.get("/api/v1/farms/2/operational-area")

    assert response.status_code == 200
    assert response.json()["data"]["farm_id"] == 1
    assert wrong_farm.status_code == 404


def test_preview_operational_area_returns_conflict_summary(monkeypatch):
    monkeypatch.setattr(
        spatial_validation_service,
        "preview_area",
        lambda farm_id, geometry, proximity_radius_m: {
            "farm_id": farm_id,
            "valid_for_existing_resources": False,
            "conflicts": [{"resource_type": "field", "id": 7, "name": "Talhão 7"}],
        },
    )

    response = client.post(
        "/api/v1/farms/1/operational-area/preview",
        json={"geometry": polygon, "proximity_radius_m": 250},
    )

    assert response.status_code == 200
    assert response.json()["data"]["valid_for_existing_resources"] is False
    assert response.json()["data"]["conflicts"][0]["resource_type"] == "field"


def test_save_operational_area_persists_geometry_and_radius(monkeypatch):
    monkeypatch.setattr(
        spatial_validation_service,
        "save_area",
        lambda farm_id, geometry, proximity_radius_m: {
            "farm_id": farm_id,
            "configured": True,
            "geometry": geometry,
            "proximity_radius_m": proximity_radius_m,
        },
    )

    response = client.put(
        "/api/v1/farms/1/operational-area",
        json={"geometry": polygon, "proximity_radius_m": 250},
    )

    assert response.status_code == 200
    assert response.json()["data"]["geometry"] == polygon
    assert response.json()["data"]["proximity_radius_m"] == 250


def test_validate_resource_requires_active_farm_and_returns_scope(monkeypatch):
    monkeypatch.setattr(
        spatial_validation_service,
        "validate_resource",
        lambda db, farm_id, resource_type, geometry: {
            "valid": True,
            "location_scope": "WITHIN_PROXIMITY_ZONE",
            "message": "Via dentro da zona de proximidade.",
        },
    )

    response = client.post(
        "/api/v1/farms/1/operational-area/validate-resource",
        json={
            "resource_type": "road",
            "geometry": {
                "type": "LineString",
                "coordinates": [[-50.123, -21.123], [-50.122, -21.123]],
            },
        },
    )
    wrong_farm = client.post(
        "/api/v1/farms/2/operational-area/validate-resource",
        json={
            "resource_type": "road",
            "geometry": {
                "type": "LineString",
                "coordinates": [[-50.123, -21.123], [-50.122, -21.123]],
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["data"]["location_scope"] == "WITHIN_PROXIMITY_ZONE"
    assert wrong_farm.status_code == 404


def test_validate_resource_enforces_resource_creation_permission(monkeypatch):
    monkeypatch.setitem(
        app.dependency_overrides,
        get_farm_context,
        lambda: {"farm_id": 1, "permissions": {"farm.view"}},
    )

    response = client.post(
        "/api/v1/farms/1/operational-area/validate-resource",
        json={
            "resource_type": "road",
            "geometry": {
                "type": "LineString",
                "coordinates": [[-50.123, -21.123], [-50.122, -21.123]],
            },
        },
    )

    assert response.status_code == 403


def test_operational_area_write_rejects_invalid_payload():
    response = client.put(
        "/api/v1/farms/1/operational-area",
        json={"geometry": {"type": "Polygon", "coordinates": []}, "proximity_radius_m": 250},
    )

    assert response.status_code == 422
