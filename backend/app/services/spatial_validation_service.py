import json

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal


class SpatialValidationError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class OperationalAreaConflict(ValueError):
    def __init__(self, resources: list[dict]):
        super().__init__("A nova área deixaria recursos espaciais existentes fora do contexto permitido.")
        self.resources = resources


class SpatialValidationService:
    RESOURCE_TYPES = {
        "field": ("ST_Polygon", "O talhão precisa estar inteiramente dentro da área operacional."),
        "structure": ("ST_Point", "Esta estrutura está fora da área operacional da fazenda."),
        "road": ("ST_LineString", "A estrada está fora da área e da zona de proximidade permitida."),
    }

    def get_area(self, farm_id: int) -> dict:
        with SessionLocal() as db:
            row = self._area_record(db, farm_id)
            return self._serialize_area(row, farm_id, db)

    def preview_area(self, farm_id: int, geometry: dict, proximity_radius_m: int) -> dict:
        with SessionLocal() as db:
            area_geometry = self._validate_area_geometry(db, farm_id, geometry)
            blockers = self._find_conflicts(db, farm_id, area_geometry, proximity_radius_m)
            zone = self._proximity_zone(db, area_geometry, proximity_radius_m)
            return {
                "farm_id": farm_id,
                "configured": True,
                "geometry": json.loads(area_geometry),
                "proximity_radius_m": proximity_radius_m,
                "proximity_zone": zone,
                "valid_for_existing_resources": not blockers,
                "conflicts": blockers,
            }

    def save_area(self, farm_id: int, geometry: dict, proximity_radius_m: int) -> dict:
        with SessionLocal.begin() as db:
            return self.save_area_in_session(db, farm_id, geometry, proximity_radius_m)

    def save_area_in_session(
        self,
        db: Session,
        farm_id: int,
        geometry: dict,
        proximity_radius_m: int,
    ) -> dict:
        farm = db.execute(
            text("SELECT id FROM farms WHERE id = :farm_id FOR UPDATE"),
            {"farm_id": farm_id},
        ).one_or_none()
        if farm is None:
            raise HTTPException(status_code=404, detail="Fazenda não encontrada.")
        area_geometry = self._validate_area_geometry(db, farm_id, geometry)
        blockers = self._find_conflicts(db, farm_id, area_geometry, proximity_radius_m)
        if blockers:
            raise OperationalAreaConflict(blockers)
        db.execute(
            text("""
                UPDATE farms
                SET operational_area = ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326),
                    proximity_radius_m = :proximity_radius_m,
                    updated_at = NOW()
                WHERE id = :farm_id
            """),
            {
                "farm_id": farm_id,
                "geometry": area_geometry,
                "proximity_radius_m": proximity_radius_m,
            },
        )
        return self._serialize_area(self._area_record(db, farm_id), farm_id, db)

    def delete_area(self, farm_id: int) -> dict:
        with SessionLocal.begin() as db:
            return self.delete_area_in_session(db, farm_id)

    def delete_area_in_session(self, db: Session, farm_id: int) -> dict:
        farm = db.execute(
            text("SELECT id FROM farms WHERE id = :farm_id FOR UPDATE"),
            {"farm_id": farm_id},
        ).one_or_none()
        if farm is None:
            raise HTTPException(status_code=404, detail="Fazenda não encontrada.")
        blockers = self._existing_resources(db, farm_id)
        if blockers:
            raise OperationalAreaConflict(blockers)
        db.execute(
            text("""
                UPDATE farms
                SET operational_area = NULL, updated_at = NOW()
                WHERE id = :farm_id
            """),
            {"farm_id": farm_id},
        )
        return self._serialize_area(self._area_record(db, farm_id), farm_id, db)

    def validate_resource(
        self,
        db: Session,
        farm_id: int,
        resource_type: str,
        geometry: dict,
    ) -> dict:
        if resource_type not in self.RESOURCE_TYPES:
            raise SpatialValidationError("UNSUPPORTED_RESOURCE_TYPE", "Tipo de recurso espacial não suportado.")
        expected_type, inside_message = self.RESOURCE_TYPES[resource_type]
        geometry_json = json.dumps(geometry)
        row = db.execute(
            text("""
                WITH input AS (
                    SELECT ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326) AS geom
                )
                SELECT farms.operational_area IS NOT NULL AS configured,
                       ST_IsValid(input.geom) AS valid,
                       ST_IsEmpty(input.geom) AS empty,
                       ST_GeometryType(input.geom) AS geometry_type,
                       ST_NPoints(input.geom) AS points_count,
                       CASE WHEN farms.operational_area IS NOT NULL
                            THEN ST_Covers(farms.operational_area, input.geom)
                            ELSE FALSE END AS inside_area,
                       CASE WHEN farms.operational_area IS NOT NULL
                            AND :resource_type = 'road'
                            THEN ST_Covers(
                                ST_Buffer(
                                    farms.operational_area::geography,
                                    farms.proximity_radius_m
                                )::geometry,
                                input.geom
                            )
                            ELSE FALSE END AS within_proximity
                FROM farms CROSS JOIN input
                WHERE farms.id = :farm_id
                FOR SHARE OF farms
            """),
            {
                "farm_id": farm_id,
                "geometry": geometry_json,
                "resource_type": resource_type,
            },
        ).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Fazenda não encontrada.")
        if not row.configured:
            raise SpatialValidationError(
                "OPERATIONAL_AREA_NOT_CONFIGURED",
                "A área operacional desta fazenda ainda não foi configurada.",
            )
        if (
            not row.valid
            or row.empty
            or row.geometry_type != expected_type
            or (resource_type in {"field", "road"} and row.points_count < 2)
        ):
            raise SpatialValidationError(
                "INVALID_RESOURCE_GEOMETRY",
                "A geometria enviada não corresponde a um recurso válido em WGS84.",
            )
        if row.inside_area:
            return {
                "valid": True,
                "location_scope": "INSIDE_OPERATIONAL_AREA",
                "message": "Recurso dentro da área operacional.",
            }
        if resource_type == "road" and row.within_proximity:
            return {
                "valid": True,
                "location_scope": "WITHIN_PROXIMITY_ZONE",
                "message": "Via externa próxima à fazenda, dentro da zona de proximidade permitida.",
            }
        code = "OUTSIDE_PROXIMITY_ZONE" if resource_type == "road" else "OUTSIDE_OPERATIONAL_AREA"
        message = (
            "A via está fora da área operacional e da zona de proximidade permitida."
            if resource_type == "road"
            else inside_message
        )
        raise SpatialValidationError(code, message)

    @staticmethod
    def _area_record(db: Session, farm_id: int):
        return db.execute(
            text("""
                SELECT farms.id AS farm_id,
                       farms.operational_area IS NOT NULL AS configured,
                       CASE WHEN farms.operational_area IS NOT NULL
                            THEN ST_AsGeoJSON(farms.operational_area) END AS geometry_json,
                       farms.proximity_radius_m,
                       COALESCE(
                           ST_Centroid(farms.operational_area),
                           (
                               SELECT ST_Centroid(ST_Collect(spatial.geometry))
                               FROM (
                                   SELECT geometry FROM fields WHERE farm_id = farms.id
                                   UNION ALL
                                   SELECT geometry FROM structures WHERE farm_id = farms.id
                                   UNION ALL
                                   SELECT geometry FROM roads WHERE farm_id = farms.id
                               ) AS spatial
                           ),
                           (
                               SELECT ST_SetSRID(ST_MakePoint(location.longitude, location.latitude), 4326)
                               FROM machine_locations AS location
                               WHERE location.farm_id = farms.id
                               ORDER BY location.recorded_at DESC
                               LIMIT 1
                           )
                       ) AS center
                FROM farms
                WHERE farms.id = :farm_id
            """),
            {"farm_id": farm_id},
        ).one_or_none()

    def _serialize_area(self, row, farm_id: int, db: Session) -> dict:
        if row is None:
            raise HTTPException(status_code=404, detail="Fazenda não encontrada.")
        geometry = json.loads(row.geometry_json) if row.geometry_json else None
        zone = None
        if geometry is not None:
            zone = self._proximity_zone(db, row.geometry_json, row.proximity_radius_m)
        center = None
        if row.center is not None:
            center = {"type": "Point", "coordinates": [row.center.x, row.center.y]}
        return {
            "farm_id": farm_id,
            "configured": bool(row.configured),
            "geometry": geometry,
            "proximity_radius_m": row.proximity_radius_m,
            "max_proximity_radius_m": get_settings().operational_proximity_max_m,
            "proximity_zone": zone,
            "center": center,
        }

    def _validate_area_geometry(self, db: Session, farm_id: int, geometry: dict) -> str:
        geometry_json = json.dumps(geometry)
        row = db.execute(
            text("""
                WITH input AS (
                    SELECT ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326) AS geom
                )
                SELECT farms.id,
                       ST_IsValid(input.geom) AS valid,
                       ST_IsEmpty(input.geom) AS empty,
                       ST_GeometryType(input.geom) AS geometry_type,
                       ST_NPoints(input.geom) AS points_count,
                       ST_Area(input.geom::geography) AS area_m2,
                       ST_XMin(ST_Envelope(input.geom)) AS min_longitude,
                       ST_XMax(ST_Envelope(input.geom)) AS max_longitude,
                       ST_YMin(ST_Envelope(input.geom)) AS min_latitude,
                       ST_YMax(ST_Envelope(input.geom)) AS max_latitude,
                       ST_AsGeoJSON(input.geom) AS geometry_json
                FROM farms CROSS JOIN input
                WHERE farms.id = :farm_id
            """),
            {"farm_id": farm_id, "geometry": geometry_json},
        ).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Fazenda não encontrada.")
        if (
            not row.valid
            or row.empty
            or row.geometry_type not in {"ST_Polygon", "ST_MultiPolygon"}
            or row.points_count < 4
            or row.area_m2 <= 0
            or row.min_longitude < -180
            or row.max_longitude > 180
            or row.min_latitude < -90
            or row.max_latitude > 90
            or row.points_count > 50000
        ):
            raise SpatialValidationError(
                "INVALID_OPERATIONAL_AREA",
                "A área operacional precisa ser um Polygon ou MultiPolygon válido em SRID 4326.",
            )
        return row.geometry_json

    def _find_conflicts(
        self,
        db: Session,
        farm_id: int,
        area_geometry: str,
        proximity_radius_m: int,
    ) -> list[dict]:
        return [
            dict(row._mapping)
            for row in db.execute(
                text("""
                    WITH area AS (
                        SELECT ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326) AS geom,
                               ST_Buffer(
                                   ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326)::geography,
                                   :radius_m
                               )::geometry AS proximity_zone
                    ), invalid_roads AS (
                        SELECT roads.id, roads.nome
                        FROM roads CROSS JOIN area
                        WHERE roads.farm_id = :farm_id
                          AND NOT ST_Covers(
                              area.proximity_zone,
                              roads.geometry
                          )
                    ), conflicts AS (
                        SELECT 'field' AS resource_type, fields.id, fields.nome AS name
                        FROM fields CROSS JOIN area
                        WHERE fields.farm_id = :farm_id
                          AND NOT ST_Covers(area.geom, fields.geometry)
                        UNION ALL
                        SELECT 'structure', structures.id, structures.nome
                        FROM structures CROSS JOIN area
                        WHERE structures.farm_id = :farm_id
                          AND NOT ST_Covers(area.geom, structures.geometry)
                        UNION ALL
                        SELECT 'road', invalid_roads.id, invalid_roads.nome
                        FROM invalid_roads
                        UNION ALL
                        SELECT 'road_problem', problems.id, problems.descricao
                        FROM road_problems AS problems
                        JOIN invalid_roads ON invalid_roads.id = problems.road_id
                        WHERE problems.farm_id = :farm_id
                    )
                    SELECT resource_type, id, name
                    FROM conflicts
                    ORDER BY resource_type, id
                    LIMIT 100
                """),
                {
                    "farm_id": farm_id,
                    "geometry": area_geometry,
                    "radius_m": proximity_radius_m,
                },
            ).all()
        ]

    @staticmethod
    def _existing_resources(db: Session, farm_id: int) -> list[dict]:
        return [
            dict(row._mapping)
            for row in db.execute(
                text("""
                    SELECT resource_type, id, name FROM (
                        SELECT 'field' AS resource_type, id, nome AS name FROM fields WHERE farm_id = :farm_id
                        UNION ALL
                        SELECT 'structure', id, nome FROM structures WHERE farm_id = :farm_id
                        UNION ALL
                        SELECT 'road', id, nome FROM roads WHERE farm_id = :farm_id
                        UNION ALL
                        SELECT 'road_problem', id, descricao FROM road_problems WHERE farm_id = :farm_id
                    ) AS resources
                    ORDER BY resource_type, id
                    LIMIT 100
                """),
                {"farm_id": farm_id},
            ).all()
        ]

    @staticmethod
    def _proximity_zone(db: Session, area_geometry: str, radius_m: int) -> dict:
        row = db.execute(
            text("""
                SELECT ST_AsGeoJSON(
                    ST_Buffer(
                        ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326)::geography,
                        :radius_m
                    )::geometry
                ) AS geometry_json
            """),
            {"geometry": area_geometry, "radius_m": radius_m},
        ).one()
        return json.loads(row.geometry_json)


spatial_validation_service = SpatialValidationService()
