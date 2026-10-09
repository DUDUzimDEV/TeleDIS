from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.endpoints import roads
from app.database import SessionLocal
from app.main import app

client = TestClient(app)

line = {
    "type": "LineString",
    "coordinates": [
        [-50.123, -21.123],
        [-50.122, -21.123],
        [-50.121, -21.124],
    ],
}


def saved_road(road_id=31):
    timestamp = datetime(2026, 10, 2, tzinfo=timezone.utc).isoformat()
    return {
        "id": road_id,
        "nome": "Estrada Principal",
        "tipo": "PRINCIPAL",
        "descricao": "Principal acesso aos talhões.",
        "geometry": line,
        "comprimento_m": 239.0,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def test_create_road_returns_id_metadata_geometry_and_length(monkeypatch):
    monkeypatch.setattr(roads.service, "create_road", lambda payload, farm_id: saved_road())

    response = client.post(
        "/api/v1/roads",
        json={
            "nome": "Estrada Principal",
            "tipo": "PRINCIPAL",
            "descricao": "Principal acesso aos talhões.",
            "geometry": line,
        },
    )

    assert response.status_code == 201
    assert response.json()["id"] == 31
    assert response.json()["nome"] == "Estrada Principal"
    assert response.json()["tipo"] == "PRINCIPAL"
    assert response.json()["descricao"] == "Principal acesso aos talhões."
    assert response.json()["geometry"] == line
    assert response.json()["comprimento_m"] == 239.0


def test_list_and_get_road_endpoints(monkeypatch):
    road = saved_road()
    monkeypatch.setattr(roads.service, "list_roads", lambda farm_id: [road])
    monkeypatch.setattr(roads.service, "get_road", lambda road_id, farm_id: road if road_id == 31 else None)

    listed = client.get("/api/v1/roads")
    fetched = client.get("/api/v1/roads/31")
    missing = client.get("/api/v1/roads/999")

    assert listed.status_code == 200
    assert listed.json() == [road]
    assert fetched.status_code == 200
    assert fetched.json() == road
    assert missing.status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {"tipo": "PRINCIPAL", "geometry": line},
        {"nome": "Estrada", "geometry": line},
        {"nome": "Estrada", "tipo": "INVALIDA", "geometry": line},
        {"nome": "Estrada", "tipo": "PRINCIPAL"},
        {"nome": "Estrada", "tipo": "PRINCIPAL", "geometry": {"type": "Polygon", "coordinates": []}},
        {"nome": "Estrada", "tipo": "PRINCIPAL", "geometry": {"type": "LineString", "coordinates": [[-50, -21]]}},
        {"nome": "Estrada", "tipo": "PRINCIPAL", "geometry": {"type": "LineString", "coordinates": [[-50, -21], [-50, -21]]}},
        {"nome": "Estrada", "tipo": "PRINCIPAL", "geometry": {"type": "LineString", "coordinates": [[-181, -21], [-50, -21]]}},
        {"nome": "Estrada", "tipo": "PRINCIPAL", "geometry": {"type": "LineString", "coordinates": [[-50, 91], [-50, -21]]}},
        {"nome": "Estrada", "tipo": "PRINCIPAL", "geometry": {"type": "LineString", "coordinates": [[-50, -21, 4], [-49, -21, 4]]}},
    ],
)
def test_invalid_road_payloads_are_rejected(payload):
    response = client.post("/api/v1/roads", json=payload)

    assert response.status_code == 422


def test_road_round_trip_persists_valid_linestring_and_official_length():
    with SessionLocal() as db:
        try:
            db.execute(text("SELECT postgis_version()"))
        except SQLAlchemyError:
            pytest.skip("PostgreSQL/PostGIS de integração não está disponível.")

    name = f"Teste de via {uuid4().hex}"
    road_id = None

    try:
        created = client.post(
            "/api/v1/roads",
            json={
                "nome": name,
                "tipo": "ACESSO",
                "descricao": "Registro de integração.",
                "geometry": line,
            },
        )

        assert created.status_code == 201
        created_road = created.json()
        road_id = created_road["id"]
        assert created_road["geometry"] == line
        assert 100 < created_road["comprimento_m"] < 500
        assert client.get(f"/api/v1/roads/{road_id}").json() == created_road
        assert any(item["id"] == road_id for item in client.get("/api/v1/roads").json())

        with SessionLocal() as db:
            spatial = db.execute(
                text(
                    """
                    SELECT GeometryType(geometry) AS geometry_type,
                           ST_SRID(geometry) AS srid,
                           ST_IsValid(geometry) AS is_valid,
                           ST_NPoints(geometry) AS points_count,
                           ST_Length(geometry::geography) AS length_m,
                           ST_X(ST_StartPoint(geometry)) AS first_longitude,
                           ST_Y(ST_StartPoint(geometry)) AS first_latitude
                    FROM roads
                    WHERE id = :road_id
                    """
                ),
                {"road_id": road_id},
            ).one()

        assert spatial.geometry_type == "LINESTRING"
        assert spatial.srid == 4326
        assert spatial.is_valid is True
        assert spatial.points_count == 3
        assert spatial.length_m == pytest.approx(created_road["comprimento_m"])
        assert spatial.first_longitude == pytest.approx(-50.123)
        assert spatial.first_latitude == pytest.approx(-21.123)
    finally:
        if road_id is not None:
            with SessionLocal() as db:
                db.execute(text("DELETE FROM roads WHERE id = :road_id"), {"road_id": road_id})
                db.commit()