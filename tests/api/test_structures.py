from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.endpoints import structures
from app.database import SessionLocal
from app.main import app

client = TestClient(app)

point = {"type": "Point", "coordinates": [-50.123456, -21.123456]}


def saved_structure(structure_id=23):
    timestamp = datetime(2026, 10, 2, tzinfo=timezone.utc).isoformat()
    return {
        "id": structure_id,
        "nome": "Oficina Central",
        "tipo": "OFICINA",
        "descricao": "Manutenção das máquinas.",
        "geometry": point,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def test_create_structure_returns_id_type_and_point(monkeypatch):
    monkeypatch.setattr(structures.service, "create_structure", lambda payload, farm_id: saved_structure())

    response = client.post(
        "/api/v1/structures",
        json={
            "nome": "Oficina Central",
            "tipo": "OFICINA",
            "descricao": "Manutenção das máquinas.",
            "geometry": point,
        },
    )

    assert response.status_code == 201
    assert response.json()["id"] == 23
    assert response.json()["tipo"] == "OFICINA"
    assert response.json()["geometry"] == point


def test_list_and_get_structure_endpoints(monkeypatch):
    structure = saved_structure()
    monkeypatch.setattr(structures.service, "list_structures", lambda farm_id: [structure])
    monkeypatch.setattr(
        structures.service,
        "get_structure",
        lambda structure_id, farm_id: structure if structure_id == 23 else None,
    )

    listed = client.get("/api/v1/structures")
    fetched = client.get("/api/v1/structures/23")
    missing = client.get("/api/v1/structures/999")

    assert listed.status_code == 200
    assert listed.json() == [structure]
    assert fetched.status_code == 200
    assert fetched.json() == structure
    assert missing.status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {"tipo": "OFICINA", "geometry": point},
        {"nome": "Oficina", "geometry": point},
        {"nome": "Oficina", "tipo": "INVALIDO", "geometry": point},
        {"nome": "Oficina", "tipo": "OFICINA"},
        {"nome": "Oficina", "tipo": "OFICINA", "geometry": {"type": "LineString", "coordinates": []}},
        {"nome": "Oficina", "tipo": "OFICINA", "geometry": {"type": "Point", "coordinates": [-181, -21]}},
        {"nome": "Oficina", "tipo": "OFICINA", "geometry": {"type": "Point", "coordinates": [-50, 91]}},
        {"nome": "Oficina", "tipo": "OFICINA", "geometry": {"type": "Point", "coordinates": [-50, -21, 10]}},
    ],
)
def test_invalid_structure_payloads_are_rejected(payload):
    response = client.post("/api/v1/structures", json=payload)

    assert response.status_code == 422


def test_structure_round_trip_persists_point_with_correct_coordinates():
    with SessionLocal() as db:
        try:
            db.execute(text("SELECT postgis_version()"))
        except SQLAlchemyError:
            pytest.skip("PostgreSQL/PostGIS de integração não está disponível.")

    name = f"Teste de estrutura {uuid4().hex}"
    structure_id = None

    try:
        created = client.post(
            "/api/v1/structures",
            json={
                "nome": name,
                "tipo": "APOIO",
                "descricao": "Registro de integração.",
                "geometry": point,
            },
        )

        assert created.status_code == 201
        created_structure = created.json()
        structure_id = created_structure["id"]
        assert created_structure["geometry"] == point
        assert client.get(f"/api/v1/structures/{structure_id}").json() == created_structure
        assert any(
            item["id"] == structure_id
            for item in client.get("/api/v1/structures").json()
        )

        with SessionLocal() as db:
            spatial = db.execute(
                text(
                    """
                    SELECT ST_SRID(geometry) AS srid,
                           ST_GeometryType(geometry) AS geometry_type,
                           ST_IsValid(geometry) AS is_valid,
                           ST_X(geometry) AS longitude,
                           ST_Y(geometry) AS latitude
                    FROM structures
                    WHERE id = :structure_id
                    """
                ),
                {"structure_id": structure_id},
            ).one()

        assert spatial.srid == 4326
        assert spatial.geometry_type == "ST_Point"
        assert spatial.is_valid is True
        assert spatial.longitude == pytest.approx(-50.123456)
        assert spatial.latitude == pytest.approx(-21.123456)
    finally:
        if structure_id is not None:
            with SessionLocal() as db:
                db.execute(
                    text("DELETE FROM structures WHERE id = :structure_id"),
                    {"structure_id": structure_id},
                )
                db.commit()