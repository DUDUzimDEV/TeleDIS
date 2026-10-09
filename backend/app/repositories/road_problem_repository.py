import json

from sqlalchemy import text

from app.database import SessionLocal


class InvalidRoadProblemGeometry(ValueError):
    pass


class RoadProblemRoadNotFound(ValueError):
    pass


class RoadProblemTooFarFromRoad(ValueError):
    pass


class RoadProblemRepository:
    maximum_road_distance_m = 30.0

    @staticmethod
    def _serialize_row(row):
        problem = dict(row._mapping)
        geometry = problem.pop("geometry_json")
        problem["geometry"] = json.loads(geometry) if isinstance(geometry, str) else geometry
        return problem

    def create(self, payload, farm_id: int):
        geometry_json = payload.geometry.json()

        with SessionLocal() as db:
            geometry_check = db.execute(
                text(
                    """
                    WITH input AS (
                        SELECT ST_SetSRID(ST_GeomFromGeoJSON(:geometry_json), 4326) AS geom
                    )
                    SELECT ST_IsValid(geom) AS is_valid,
                           ST_SRID(geom) AS srid,
                           ST_GeometryType(geom) AS geometry_type
                    FROM input
                    """
                ),
                {"geometry_json": geometry_json},
            ).one()

            if (
                not geometry_check.is_valid
                or geometry_check.srid != 4326
                or geometry_check.geometry_type != "ST_Point"
            ):
                raise InvalidRoadProblemGeometry("A posição do problema deve ser um Point válido em WGS84.")

            road_check = db.execute(
                text(
                    """
                    WITH input AS (
                        SELECT ST_SetSRID(ST_GeomFromGeoJSON(:geometry_json), 4326)::geography AS clicked
                    )
                    SELECT roads.id, roads.nome,
                           ST_Distance(input.clicked, roads.geometry::geography) AS distance_m,
                           ST_AsGeoJSON(
                               ST_ClosestPoint(roads.geometry::geography, input.clicked)::geometry
                           ) AS snapped_geometry_json
                    FROM roads, input
                    WHERE roads.id = :road_id AND roads.farm_id = :farm_id
                    """
                ),
                {
                    "road_id": payload.road_id,
                    "farm_id": farm_id,
                    "geometry_json": geometry_json,
                },
            ).one_or_none()
            if road_check is None:
                raise RoadProblemRoadNotFound("A estrada selecionada não existe.")
            if road_check.distance_m > self.maximum_road_distance_m:
                raise RoadProblemTooFarFromRoad(
                    f"Clique a no mÃ¡ximo {self.maximum_road_distance_m:g} m da estrada selecionada para registrar o problema."
                )

            row = db.execute(
                text(
                    """
                    WITH input AS (
                        SELECT ST_SetSRID(ST_GeomFromGeoJSON(:snapped_geometry_json), 4326) AS geom
                    ), inserted AS (
                        INSERT INTO road_problems (road_id, tipo, gravidade, descricao, geometry, farm_id)
                        SELECT :road_id, :tipo, :gravidade, :descricao, geom, :farm_id
                        FROM input
                        RETURNING id, road_id, tipo, gravidade, status, descricao,
                                  geometry, created_at, updated_at
                    )
                    SELECT inserted.id, inserted.road_id, roads.nome AS road_nome,
                           inserted.tipo, inserted.gravidade, inserted.status, inserted.descricao,
                           ST_AsGeoJSON(inserted.geometry) AS geometry_json,
                           inserted.created_at, inserted.updated_at
                    FROM inserted
                    JOIN roads ON roads.id = inserted.road_id
                    """
                ),
                {
                    "road_id": payload.road_id,
                    "farm_id": farm_id,
                    "tipo": payload.tipo,
                    "gravidade": payload.gravidade,
                    "descricao": payload.descricao,
                    "snapped_geometry_json": road_check.snapped_geometry_json,
                },
            ).one()
            db.commit()
            return self._serialize_row(row)

    def list_all(self, farm_id: int):
        with SessionLocal() as db:
            rows = db.execute(
                text(
                    """
                    SELECT problems.id, problems.road_id, roads.nome AS road_nome,
                           problems.tipo, problems.gravidade, problems.status, problems.descricao,
                           ST_AsGeoJSON(problems.geometry) AS geometry_json,
                           problems.created_at, problems.updated_at
                    FROM road_problems AS problems
                    JOIN roads ON roads.id = problems.road_id
                    WHERE problems.farm_id = :farm_id
                    ORDER BY problems.id
                    """
                ),
                {"farm_id": farm_id},
            ).all()
            return [self._serialize_row(row) for row in rows]

    def get_by_id(self, problem_id: int, farm_id: int):
        with SessionLocal() as db:
            row = db.execute(
                text(
                    """
                    SELECT problems.id, problems.road_id, roads.nome AS road_nome,
                           problems.tipo, problems.gravidade, problems.status, problems.descricao,
                           ST_AsGeoJSON(problems.geometry) AS geometry_json,
                           problems.created_at, problems.updated_at
                    FROM road_problems AS problems
                    JOIN roads ON roads.id = problems.road_id
                    WHERE problems.id = :problem_id AND problems.farm_id = :farm_id
                    """
                ),
                {"problem_id": problem_id, "farm_id": farm_id},
            ).one_or_none()
            return self._serialize_row(row) if row is not None else None

    def update_status(self, problem_id: int, farm_id: int, new_status: str):
        with SessionLocal() as db:
            row = db.execute(
                text(
                    """
                    WITH updated AS (
                        UPDATE road_problems
                        SET status = :status, updated_at = NOW()
                        WHERE id = :problem_id AND farm_id = :farm_id
                        RETURNING id, road_id, tipo, gravidade, status, descricao,
                                  geometry, created_at, updated_at, farm_id
                    )
                    SELECT updated.id, updated.road_id, roads.nome AS road_nome,
                           updated.tipo, updated.gravidade, updated.status, updated.descricao,
                           ST_AsGeoJSON(updated.geometry) AS geometry_json,
                           updated.created_at, updated.updated_at
                    FROM updated
                    JOIN roads ON roads.id = updated.road_id
                              AND roads.farm_id = updated.farm_id
                    """
                ),
                {"problem_id": problem_id, "farm_id": farm_id, "status": new_status},
            ).one_or_none()
            db.commit()
            return self._serialize_row(row) if row is not None else None