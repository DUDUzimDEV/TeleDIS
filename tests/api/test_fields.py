from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.endpoints import fields
from app.database import SessionLocal
from app.main import app

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


def saved_field(field_id=17):
    timestamp = datetime(2026, 10, 2, tzinfo=timezone.utc).isoformat()
    return {
        "id": field_id,
        "nome": "Talhão 01",
        "cultura": "Cana-de-açúcar",
        "safra": "2026/2027",
        "area_ha": 12.45,
        "geometry": polygon,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def test_create_field_returns_persisted_shape_and_server_area(monkeypatch):
    monkeypatch.setattr(fields.service, "create_field", lambda payload, farm_id: saved_field())

    response = client.post(
        "/api/v1/fields",
        json={
            "nome": "Talhão 01",
            "cultura": "Cana-de-açúcar",
            "safra": "2026/2027",
            "geometry": polygon,
        },
    )

    assert response.status_code == 201
    assert response.json()["id"] == 17
    assert response.json()["area_ha"] == 12.45
    assert response.json()["geometry"] == polygon


def test_list_and_get_field_endpoints(monkeypatch):
    field = saved_field()
    monkeypatch.setattr(fields.service, "list_fields", lambda farm_id: [field])
    monkeypatch.setattr(fields.service, "get_field", lambda field_id, farm_id: field if field_id == 17 else None)

    listed = client.get("/api/v1/fields")
    fetched = client.get("/api/v1/fields/17")
    missing = client.get("/api/v1/fields/999")

    assert listed.status_code == 200
    assert listed.json() == [field]
    assert fetched.status_code == 200
    assert fetched.json() == field
    assert missing.status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {"cultura": "Soja", "safra": "2026/27", "geometry": polygon},
        {"nome": "Talhão", "cultura": "Soja", "safra": "2026/27"},
        {"nome": "Talhão", "cultura": "Soja", "safra": "2026/27", "geometry": {"type": "LineString", "coordinates": []}},
        {
            "nome": "Talhão",
            "cultura": "Soja",
            "safra": "2026/27",
            "geometry": {"type": "Polygon", "coordinates": [[[-50, -21], [-49, -21], [-49, -22]]]},
        },
        {
            "nome": "Talhão",
            "cultura": "Soja",
            "safra": "2026/27",
            "geometry": {"type": "Polygon", "coordinates": [[[-181, -21], [-49, -21], [-49, -22], [-181, -21]]]},
        },
        {"nome": "Talhão", "cultura": "Soja", "safra": "2026/27", "geometry": polygon, "area_ha": 500},
    ],
)
def test_invalid_field_payloads_are_rejected(payload):
    response = client.post("/api/v1/fields", json=payload)

    assert response.status_code == 422


def test_field_round_trip_persists_valid_geometry_and_server_area():
    with SessionLocal() as db:
        try:
            db.execute(text("SELECT postgis_version()"))
        except SQLAlchemyError:
            pytest.skip("PostgreSQL/PostGIS de integração não está disponível.")

    name = f"Teste de integração {uuid4().hex}"
    field_id = None

    try:
        created = client.post(
            "/api/v1/fields",
            json={
                "nome": name,
                "cultura": "Soja",
                "safra": "2026/2027",
                "geometry": polygon,
            },
        )

        assert created.status_code == 201
        created_field = created.json()
        field_id = created_field["id"]
        assert created_field["area_ha"] > 0
        assert created_field["geometry"] == polygon
        assert client.get(f"/api/v1/fields/{field_id}").json() == created_field
        assert any(item["id"] == field_id for item in client.get("/api/v1/fields").json())

        with SessionLocal() as db:
            spatial = db.execute(
                text(
                    """
                    SELECT ST_SRID(geometry) AS srid,
                           ST_IsValid(geometry) AS is_valid,
                           area_ha,
                           ST_Area(geometry::geography) / 10000.0 AS calculated_area
                    FROM fields
                    WHERE id = :field_id
                    """
                ),
                {"field_id": field_id},
            ).one()

        assert spatial.srid == 4326
        assert spatial.is_valid is True
        assert spatial.area_ha == pytest.approx(spatial.calculated_area)

        invalid_geometry = {
            "type": "Polygon",
            "coordinates": [[
                [-50.123, -21.123],
                [-50.122, -21.124],
                [-50.123, -21.124],
                [-50.122, -21.123],
                [-50.123, -21.123],
            ]],
        }
        invalid = client.post(
            "/api/v1/fields",
            json={
                "nome": f"{name} inválido",
                "cultura": "Soja",
                "safra": "2026/2027",
                "geometry": invalid_geometry,
            },
        )
        assert invalid.status_code == 422
    finally:
        if field_id is not None:
            with SessionLocal() as db:
                db.execute(text("DELETE FROM fields WHERE id = :field_id"), {"field_id": field_id})
                db.commit()