import json

from sqlalchemy import text

from app.config import get_settings
from app.database import SessionLocal
from app.services.route_algorithm import evaluate_segment_problems


class RouteNetworkRepository:
    def rebuild(self, farm_id: int) -> dict[str, int]:
        settings = get_settings()
        with SessionLocal.begin() as db:
            db.execute(text("DELETE FROM network_segments WHERE farm_id = :farm_id"), {"farm_id": farm_id})
            db.execute(text("DELETE FROM network_nodes WHERE farm_id = :farm_id"), {"farm_id": farm_id})
            node_count = db.execute(
                text(
                    """
                    WITH linework AS (
                        SELECT ST_Node(ST_UnaryUnion(ST_Collect(geometry))) AS geometry
                        FROM roads
                        WHERE farm_id = :farm_id
                    ), pieces AS (
                        SELECT (ST_Dump(ST_CollectionExtract(geometry, 2))).geom AS geometry
                        FROM linework
                        WHERE geometry IS NOT NULL
                    ), endpoints AS (
                        SELECT ST_StartPoint(geometry) AS geometry FROM pieces
                        UNION ALL
                        SELECT ST_EndPoint(geometry) AS geometry FROM pieces
                    ), unique_endpoints AS (
                        SELECT DISTINCT ON (encode(ST_AsEWKB(geometry), 'hex')) geometry
                        FROM endpoints
                        ORDER BY encode(ST_AsEWKB(geometry), 'hex')
                    )
                    INSERT INTO network_nodes (geometry, farm_id)
                    SELECT geometry::geometry(Point, 4326), :farm_id
                    FROM unique_endpoints
                    RETURNING id
                    """
                ),
                {"farm_id": farm_id},
            ).all()

            segment_count = db.execute(
                text(
                    """
                    WITH linework AS (
                        SELECT ST_Node(ST_UnaryUnion(ST_Collect(geometry))) AS geometry
                        FROM roads
                        WHERE farm_id = :farm_id
                    ), pieces AS (
                        SELECT (ST_Dump(ST_CollectionExtract(geometry, 2))).geom AS geometry
                        FROM linework
                        WHERE geometry IS NOT NULL
                    ), assigned AS (
                        SELECT pieces.geometry,
                               roads.id AS road_id,
                               ROW_NUMBER() OVER (
                                   PARTITION BY encode(ST_AsEWKB(pieces.geometry), 'hex')
                                   ORDER BY roads.id
                               ) AS match_number
                        FROM pieces
                        JOIN roads ON ST_CoveredBy(pieces.geometry, roads.geometry)
                                  AND roads.farm_id = :farm_id
                    ), unique_pieces AS (
                        SELECT geometry, road_id
                        FROM assigned
                        WHERE match_number = 1
                    )
                    INSERT INTO network_segments (
                        road_id,
                        farm_id,
                        from_node_id,
                        to_node_id,
                        geometry,
                        length_m,
                        base_cost,
                        is_blocked
                    )
                    SELECT unique_pieces.road_id,
                           :farm_id,
                           from_node.id,
                           to_node.id,
                           unique_pieces.geometry::geometry(LineString, 4326),
                           ST_Length(unique_pieces.geometry::geography),
                           ST_Length(unique_pieces.geometry::geography),
                           EXISTS (
                               SELECT 1
                               FROM road_problems AS problems
                               WHERE problems.road_id = unique_pieces.road_id
                                 AND problems.tipo = 'VIA_BLOQUEADA'
                                 AND problems.status IN ('ABERTO', 'EM_ANALISE')
                                 AND ST_DWithin(
                                     problems.geometry::geography,
                                     unique_pieces.geometry::geography,
                                     :problem_tolerance_m
                                 )
                           )
                    FROM unique_pieces
                    JOIN network_nodes AS from_node
                      ON from_node.farm_id = :farm_id
                     AND ST_Equals(from_node.geometry, ST_StartPoint(unique_pieces.geometry))
                    JOIN network_nodes AS to_node
                      ON to_node.farm_id = :farm_id
                     AND ST_Equals(to_node.geometry, ST_EndPoint(unique_pieces.geometry))
                    WHERE ST_Length(unique_pieces.geometry::geography) > 0
                    RETURNING id
                    """
                ),
                {"problem_tolerance_m": settings.route_problem_segment_tolerance_m, "farm_id": farm_id},
            ).all()
            return {"nodes_created": len(node_count), "segments_created": len(segment_count)}

    @staticmethod
    def list_nodes(farm_id: int) -> list[dict]:
        with SessionLocal() as db:
            rows = db.execute(
                text(
                    """
                    SELECT id, ST_AsGeoJSON(geometry) AS geometry_json, created_at
                    FROM network_nodes
                    WHERE farm_id = :farm_id
                    ORDER BY id
                    """
                ),
                {"farm_id": farm_id},
            ).all()
            return [
                {
                    "id": row.id,
                    "geometry": json.loads(row.geometry_json),
                    "created_at": row.created_at,
                }
                for row in rows
            ]

    def load_graph(self, farm_id: int) -> list[dict]:
        settings = get_settings()
        with SessionLocal() as db:
            segment_rows = db.execute(
                text(
                    """
                    SELECT id, road_id, from_node_id, to_node_id,
                           ST_AsGeoJSON(geometry) AS geometry_json,
                           length_m, base_cost, is_blocked,
                           created_at, updated_at
                    FROM network_segments
                    WHERE farm_id = :farm_id
                    ORDER BY id
                    """
                ),
                {"farm_id": farm_id},
            ).all()
            problem_rows = db.execute(
                text(
                    """
                    SELECT segments.id AS segment_id,
                           problems.id,
                           problems.tipo,
                           problems.gravidade,
                           problems.status,
                           problems.descricao
                    FROM network_segments AS segments
                    JOIN road_problems AS problems
                      ON problems.road_id = segments.road_id
                     AND problems.farm_id = segments.farm_id
                    WHERE segments.farm_id = :farm_id
                     AND ST_DWithin(
                         problems.geometry::geography,
                         segments.geometry::geography,
                         :problem_tolerance_m
                     )
                    ORDER BY segments.id, problems.id
                    """
                ),
                {"problem_tolerance_m": settings.route_problem_segment_tolerance_m, "farm_id": farm_id},
            ).all()

        active_problems: dict[int, list[dict]] = {}
        for problem in problem_rows:
            active_problems.setdefault(problem.segment_id, []).append(
                {
                    "id": problem.id,
                    "segment_id": problem.segment_id,
                    "tipo": problem.tipo,
                    "gravidade": problem.gravidade,
                    "status": problem.status,
                    "descricao": problem.descricao,
                }
            )

        severity_costs = {
            "BAIXA": settings.route_penalty_low,
            "MEDIA": settings.route_penalty_medium,
            "ALTA": settings.route_penalty_high,
            "CRITICA": settings.route_penalty_critical,
        }
        segments = []
        for row in segment_rows:
            problems, blocked, multiplier = evaluate_segment_problems(
                active_problems.get(row.id, []),
                severity_costs,
            )
            geometry = json.loads(row.geometry_json)
            segments.append(
                {
                    "id": row.id,
                    "road_id": row.road_id,
                    "from_node_id": row.from_node_id,
                    "to_node_id": row.to_node_id,
                    "geometry": geometry,
                    "coordinates": geometry["coordinates"],
                    "length_m": row.length_m,
                    "base_cost": row.base_cost,
                    "cost_multiplier": multiplier,
                    "cost": row.base_cost * multiplier,
                    "is_blocked": blocked,
                    "problems": problems,
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
            )
        return segments

    def nearest_segment(self, latitude: float, longitude: float, maximum_distance_m: float, farm_id: int):
        with SessionLocal() as db:
            row = db.execute(
                text(
                    """
                    WITH input AS (
                        SELECT ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326) AS geometry
                    )
                    SELECT segments.id,
                           ST_LineLocatePoint(segments.geometry, ST_ClosestPoint(segments.geometry, input.geometry))
                               AS fraction,
                           ST_Distance(segments.geometry::geography, input.geometry::geography) AS distance_m,
                           ST_AsGeoJSON(ST_ClosestPoint(segments.geometry, input.geometry)) AS snapped_json
                    FROM network_segments AS segments
                    CROSS JOIN input
                    WHERE segments.farm_id = :farm_id
                      AND ST_DWithin(
                        segments.geometry::geography,
                        input.geometry::geography,
                        :maximum_distance_m
                    )
                    ORDER BY ST_Distance(segments.geometry::geography, input.geometry::geography), segments.id
                    LIMIT 1
                    """
                ),
                {
                    "latitude": latitude,
                    "longitude": longitude,
                    "maximum_distance_m": maximum_distance_m,
                    "farm_id": farm_id,
                },
            ).one_or_none()
            if row is None:
                return None
            snapped = json.loads(row.snapped_json)
            return {
                "segment_id": row.id,
                "fraction": row.fraction,
                "coordinates": tuple(snapped["coordinates"]),
                "distance_m": row.distance_m,
            }

    @staticmethod
    def get_machine_location(machine_id: int, farm_id: int):
        with SessionLocal() as db:
            machine_exists = db.execute(
                text("SELECT EXISTS (SELECT 1 FROM machines WHERE id = :machine_id AND farm_id = :farm_id)"),
                {"machine_id": machine_id, "farm_id": farm_id},
            ).scalar_one()
            if not machine_exists:
                return "machine_not_found", None

            row = db.execute(
                text(
                    """
                    SELECT locations.latitude, locations.longitude, locations.recorded_at
                    FROM machine_locations AS locations
                    JOIN machines ON machines.id = locations.machine_id
                    WHERE locations.machine_id = :machine_id AND machines.farm_id = :farm_id
                    ORDER BY locations.recorded_at DESC, locations.id DESC
                    LIMIT 1
                    """
                ),
                {"machine_id": machine_id, "farm_id": farm_id},
            ).one_or_none()
            if row is None:
                return "location_not_found", None
            return "ok", {
                "latitude": row.latitude,
                "longitude": row.longitude,
                "recorded_at": row.recorded_at,
            }

    @staticmethod
    def get_structure_location(structure_id: int, farm_id: int):
        with SessionLocal() as db:
            row = db.execute(
                text(
                    """
                    SELECT ST_Y(geometry) AS latitude, ST_X(geometry) AS longitude
                    FROM structures
                    WHERE id = :structure_id AND farm_id = :farm_id
                    """
                ),
                {"structure_id": structure_id, "farm_id": farm_id},
            ).one_or_none()
            if row is None:
                return None
            return {"latitude": row.latitude, "longitude": row.longitude}

    @staticmethod
    def network_has_roads(farm_id: int) -> bool:
        with SessionLocal() as db:
            return db.execute(
                text("SELECT EXISTS (SELECT 1 FROM roads WHERE farm_id = :farm_id)"),
                {"farm_id": farm_id},
            ).scalar_one()
