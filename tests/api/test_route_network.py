import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import SessionLocal
from app.repositories.route_network_repository import RouteNetworkRepository
from app.services.route_service import RouteNotFound, RouteService

def require_route_network_database():
    with SessionLocal() as db:
        try:
            db.execute(text("SELECT postgis_version()"))
            present = db.execute(
                text(
                    """
                    SELECT to_regclass('public.network_nodes') IS NOT NULL
                       AND to_regclass('public.network_segments') IS NOT NULL
                       AND to_regclass('public.roads') IS NOT NULL
                    """
                )
            ).scalar_one()
        except SQLAlchemyError:
            pytest.skip("PostgreSQL/PostGIS de integração não está disponível.")
    if not present:
        pytest.skip("A migration 008_route_network.sql ainda não foi aplicada ao banco de integração.")


def test_postgis_rebuild_nodes_real_crossings_and_routes_across_segments():
    require_route_network_database()
    center_longitude = 120 + (uuid4().int % 100_000) / 1_000_000
    center_latitude = -40 - (uuid4().int % 100_000) / 1_000_000
    road_a = {
        "type": "LineString",
        "coordinates": [
            [center_longitude - 0.001, center_latitude],
            [center_longitude + 0.001, center_latitude],
        ],
    }
    road_b = {
        "type": "LineString",
        "coordinates": [
            [center_longitude, center_latitude - 0.001],
            [center_longitude, center_latitude + 0.001],
        ],
    }
    created_road_ids = []
    with SessionLocal() as db:
        for name, geometry in ((f"route-test-a-{uuid4().hex}", road_a), (f"route-test-b-{uuid4().hex}", road_b)):
            road_id = db.execute(
                text(
                    """
                    INSERT INTO roads (nome, tipo, geometry)
                    VALUES (
                        :name,
                        'OUTRA',
                        ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326)
                    )
                    RETURNING id
                    """
                ),
                {"name": name, "geometry": json.dumps(geometry)},
            ).scalar_one()
            created_road_ids.append(road_id)
        db.commit()

    try:
        counts = RouteNetworkRepository().rebuild()
        assert counts["nodes_created"] >= 5
        assert counts["segments_created"] >= 4

        with SessionLocal() as db:
            crossing = db.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM network_nodes
                    WHERE ST_DWithin(
                        geometry::geography,
                        ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
                        0.1
                    )
                      AND EXISTS (
                          SELECT 1
                          FROM network_segments AS segments
                          WHERE segments.road_id = ANY(:road_ids)
                            AND (
                                segments.from_node_id = network_nodes.id
                                OR segments.to_node_id = network_nodes.id
                            )
                      )
                    """
                ),
                {
                    "longitude": center_longitude,
                    "latitude": center_latitude,
                    "road_ids": created_road_ids,
                },
            ).scalar_one()
            lengths = db.execute(
                text(
                    """
                    SELECT COUNT(*) AS segment_count,
                           MIN(length_m) AS minimum_length,
                           MAX(ABS(length_m - ST_Length(geometry::geography))) AS length_difference,
                       COUNT(*) FILTER (WHERE base_cost = length_m) AS base_cost_count,
                       COUNT(DISTINCT from_node_id) + COUNT(DISTINCT to_node_id) AS endpoint_count
                    FROM network_segments
                    WHERE road_id = ANY(:road_ids)
                    """
                ),
                {"road_ids": created_road_ids},
            ).one()

        assert crossing == 1
        assert lengths.segment_count == 4
        assert lengths.endpoint_count >= 5
        assert lengths.minimum_length > 0
        assert lengths.length_difference == pytest.approx(0.0)
        assert lengths.base_cost_count == 4

        route = RouteService().calculate(
            {"latitude": center_latitude, "longitude": center_longitude - 0.001},
            {"latitude": center_latitude, "longitude": center_longitude + 0.001},
        )
        assert route["found"] is True
        assert len(route["segments"]) == 2
        assert route["distance_m"] > 100
        assert route["route"]["geometry"]["coordinates"][0] == pytest.approx(
            [center_longitude - 0.001, center_latitude]
        )
        assert route["route"]["geometry"]["coordinates"][-1] == pytest.approx(
            [center_longitude + 0.001, center_latitude]
        )

        with SessionLocal() as db:
            db.execute(
                text(
                    """
                    INSERT INTO road_problems (road_id, tipo, gravidade, status, geometry)
                    VALUES (
                        :road_id,
                        'BURACO',
                        'ALTA',
                        'ABERTO',
                        ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)
                    )
                    """
                ),
                {
                    "road_id": created_road_ids[0],
                    "longitude": center_longitude - 0.0005,
                    "latitude": center_latitude,
                },
            )
            db.commit()

        penalized_route = RouteService().calculate(
            {"latitude": center_latitude, "longitude": center_longitude - 0.001},
            {"latitude": center_latitude, "longitude": center_longitude + 0.001},
        )
        assert len(penalized_route["affected_segments"]) == 1
        assert len(penalized_route["problems"]) == 1
        assert penalized_route["total_cost"] > penalized_route["distance_m"]

        with SessionLocal() as db:
            db.execute(
                text("UPDATE road_problems SET status = 'RESOLVIDO' WHERE road_id = :road_id"),
                {"road_id": created_road_ids[0]},
            )
            db.commit()

        resolved_route = RouteService().calculate(
            {"latitude": center_latitude, "longitude": center_longitude - 0.001},
            {"latitude": center_latitude, "longitude": center_longitude + 0.001},
        )
        assert resolved_route["affected_segments"] == []
        assert resolved_route["problems"] == []
        assert resolved_route["total_cost"] == pytest.approx(resolved_route["distance_m"])

        with SessionLocal() as db:
            db.execute(
                text(
                    """
                    INSERT INTO road_problems (road_id, tipo, gravidade, status, geometry)
                    VALUES (
                        :road_id,
                        'VIA_BLOQUEADA',
                        'CRITICA',
                        'EM_ANALISE',
                        ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)
                    )
                    """
                ),
                {
                    "road_id": created_road_ids[0],
                    "longitude": center_longitude - 0.0005,
                    "latitude": center_latitude,
                },
            )
            db.commit()

        with pytest.raises(RouteNotFound):
            RouteService().calculate(
                {"latitude": center_latitude, "longitude": center_longitude - 0.001},
                {"latitude": center_latitude, "longitude": center_longitude + 0.001},
            )
    finally:
        with SessionLocal() as db:
            db.execute(
                text(
                    """
                    DELETE FROM road_problems
                    WHERE road_id = ANY(:road_ids)
                    """
                ),
                {"road_ids": created_road_ids},
            )
            db.execute(
                text("DELETE FROM roads WHERE id = ANY(:road_ids)"),
                {"road_ids": created_road_ids},
            )
            db.commit()
        RouteNetworkRepository().rebuild()
