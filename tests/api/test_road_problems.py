from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.endpoints import road_problems
from app.database import SessionLocal
from app.main import app

client = TestClient(app)

point = {"type": "Point", "coordinates": [-47.448835, -23.502096]}


def saved_problem(problem_id=41, road_id=3):
    timestamp = datetime(2026, 10, 2, tzinfo=timezone.utc).isoformat()
    return {
        "id": problem_id,
        "road_id": road_id,
        "road_nome": "Estrada Principal",
        "tipo": "BURACO",
        "gravidade": "ALTA",
        "status": "ABERTO",
        "descricao": "Trecho com deformação no solo.",
        "geometry": point,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def test_create_problem_returns_related_road_point_and_open_status(monkeypatch):
    monkeypatch.setattr(road_problems.service, "create_problem", lambda payload, farm_id: saved_problem())

    response = client.post(
        "/api/v1/road-problems",
        json={
            "road_id": 3,
            "tipo": "BURACO",
            "gravidade": "ALTA",
            "descricao": "Trecho com deformação no solo.",
            "geometry": point,
        },
    )

    assert response.status_code == 201
    assert response.json()["id"] == 41
    assert response.json()["road_id"] == 3
    assert response.json()["road_nome"] == "Estrada Principal"
    assert response.json()["tipo"] == "BURACO"
    assert response.json()["gravidade"] == "ALTA"
    assert response.json()["status"] == "ABERTO"
    assert response.json()["geometry"] == point


def test_list_and_get_road_problem_endpoints(monkeypatch):
    problem = saved_problem()
    monkeypatch.setattr(road_problems.service, "list_problems", lambda farm_id: [problem])
    monkeypatch.setattr(
        road_problems.service,
        "get_problem",
        lambda problem_id, farm_id: problem if problem_id == 41 else None,
    )

    listed = client.get("/api/v1/road-problems")
    fetched = client.get("/api/v1/road-problems/41")
    missing = client.get("/api/v1/road-problems/999")

    assert listed.status_code == 200
    assert listed.json() == [problem]
    assert fetched.status_code == 200
    assert fetched.json() == problem
    assert missing.status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {"tipo": "BURACO", "gravidade": "ALTA", "geometry": point},
        {"road_id": 3, "gravidade": "ALTA", "geometry": point},
        {"road_id": 3, "tipo": "INVALIDO", "gravidade": "ALTA", "geometry": point},
        {"road_id": 3, "tipo": "BURACO", "gravidade": "EXTREMA", "geometry": point},
        {"road_id": 3, "tipo": "BURACO", "gravidade": "ALTA"},
        {"road_id": 3, "tipo": "BURACO", "gravidade": "ALTA", "geometry": {"type": "Polygon", "coordinates": []}},
        {"road_id": 3, "tipo": "BURACO", "gravidade": "ALTA", "geometry": {"type": "Point", "coordinates": [-181, -21]}},
        {"road_id": 3, "tipo": "BURACO", "gravidade": "ALTA", "geometry": {"type": "Point", "coordinates": [-47, 91]}},
        {"road_id": 0, "tipo": "BURACO", "gravidade": "ALTA", "geometry": point},
        {"road_id": 3, "tipo": "BURACO", "gravidade": "ALTA", "geometry": point, "status": "INVENTADO"},
    ],
)
def test_invalid_problem_payloads_are_rejected(payload):
    response = client.post("/api/v1/road-problems", json=payload)

    assert response.status_code == 422


def test_road_problem_round_trip_persists_valid_point_and_road_relation():
    with SessionLocal() as db:
        try:
            db.execute(text("SELECT postgis_version()"))
            road = db.execute(
                text(
                    """
                    SELECT id,
                           ST_AsGeoJSON(ST_LineInterpolatePoint(geometry, 0.5)) AS midpoint
                    FROM roads
                    ORDER BY ST_Length(geometry::geography)
                    LIMIT 1
                    """
                )
            ).one_or_none()
        except SQLAlchemyError:
            pytest.skip("PostgreSQL/PostGIS de integração não está disponível.")
    if road is None:
        pytest.skip("Cadastre ao menos uma estrada para testar a relação do problema.")

    import json

    road_id = road.id
    road_point = {"type": "Point", "coordinates": json.loads(road.midpoint)["coordinates"]}
    description = f"Problema de integração {uuid4().hex}"
    problem_id = None

    try:
        created = client.post(
            "/api/v1/road-problems",
            json={
                "road_id": road_id,
                "tipo": "BURACO",
                "gravidade": "MEDIA",
                "descricao": description,
                "geometry": road_point,
            },
        )

        assert created.status_code == 201
        created_problem = created.json()
        problem_id = created_problem["id"]
        assert created_problem["status"] == "ABERTO"
        assert created_problem["geometry"]["type"] == "Point"
        assert created_problem["geometry"]["coordinates"] == pytest.approx(road_point["coordinates"], abs=1e-8)
        assert client.get(f"/api/v1/road-problems/{problem_id}").json() == created_problem
        assert any(
            item["id"] == problem_id
            for item in client.get("/api/v1/road-problems").json()
        )

        with SessionLocal() as db:
            spatial = db.execute(
                text(
                    """
                    SELECT problems.road_id,
                           GeometryType(problems.geometry) AS geometry_type,
                           ST_SRID(problems.geometry) AS srid,
                           ST_IsValid(problems.geometry) AS is_valid,
                           ST_X(problems.geometry) AS longitude,
                              ST_Y(problems.geometry) AS latitude,
                              ST_Distance(problems.geometry::geography, roads.geometry::geography) AS distance_m
                    FROM road_problems AS problems
                          JOIN roads ON roads.id = problems.road_id
                    WHERE problems.id = :problem_id
                    """
                ),
                {"problem_id": problem_id},
            ).one()

        assert spatial.road_id == road_id
        assert spatial.geometry_type == "POINT"
        assert spatial.srid == 4326
        assert spatial.is_valid is True
        assert spatial.longitude == pytest.approx(road_point["coordinates"][0])
        assert spatial.latitude == pytest.approx(road_point["coordinates"][1])
        assert spatial.distance_m <= 0.01

        invalid_road = client.post(
            "/api/v1/road-problems",
            json={
                "road_id": 999999999,
                "tipo": "BURACO",
                "gravidade": "BAIXA",
                "geometry": point,
            },
        )
        assert invalid_road.status_code == 404

        far_point = {"type": "Point", "coordinates": [0, 0]}
        far_response = client.post(
            "/api/v1/road-problems",
            json={
                "road_id": road_id,
                "tipo": "BURACO",
                "gravidade": "BAIXA",
                "geometry": far_point,
            },
        )
        assert far_response.status_code == 422
        assert "30 m" in far_response.json()["detail"]
    finally:
        if problem_id is not None:
            with SessionLocal() as db:
                db.execute(
                    text("DELETE FROM road_problems WHERE id = :problem_id"),
                    {"problem_id": problem_id},
                )
                db.commit()


def test_problem_point_snapped_from_nearby_click_is_accepted_and_on_road():
    with SessionLocal() as db:
        try:
            road = db.execute(
                text(
                    """
                    SELECT id,
                           ST_AsGeoJSON(
                               ST_Transform(
                                   ST_Translate(ST_Transform(ST_LineInterpolatePoint(geometry, 0.5), 3857), 0, 10),
                                   4326
                               )
                           ) AS clicked_point
                    FROM roads
                    ORDER BY ST_Length(geometry::geography)
                    LIMIT 1
                    """
                )
            ).one_or_none()
        except SQLAlchemyError:
            pytest.skip("PostgreSQL/PostGIS de integração não está disponível.")
    if road is None:
        pytest.skip("Cadastre ao menos uma estrada para testar snapping.")

    import json

    clicked_geometry = json.loads(road.clicked_point)
    problem_id = None
    try:
        response = client.post(
            "/api/v1/road-problems",
            json={
                "road_id": road.id,
                "tipo": "LAMA",
                "gravidade": "MEDIA",
                "geometry": clicked_geometry,
            },
        )
        assert response.status_code == 201
        problem_id = response.json()["id"]

        with SessionLocal() as db:
            distance = db.execute(
                text(
                    """
                    SELECT ST_Distance(problems.geometry::geography, roads.geometry::geography)
                    FROM road_problems AS problems
                    JOIN roads ON roads.id = problems.road_id
                    WHERE problems.id = :problem_id
                    """
                ),
                {"problem_id": problem_id},
            ).scalar_one()

        assert response.json()["geometry"] != clicked_geometry
        assert distance <= 0.01
    finally:
        if problem_id is not None:
            with SessionLocal() as db:
                db.execute(text("DELETE FROM road_problems WHERE id = :problem_id"), {"problem_id": problem_id})
                db.commit()