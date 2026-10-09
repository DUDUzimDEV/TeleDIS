import json

from sqlalchemy import text

from app.database import SessionLocal
from app.services.spatial_validation_service import spatial_validation_service


class InvalidFieldGeometry(ValueError):
    pass


class FieldRepository:
    @staticmethod
    def _serialize_row(row):
        field = dict(row._mapping)
        geometry = field.pop("geometry_json")
        field["geometry"] = json.loads(geometry) if isinstance(geometry, str) else geometry
        return field

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
                           ST_Area(geom::geography) AS area_m2
                    FROM input
                    """
                ),
                {"geometry_json": geometry_json},
            ).one()

            if not geometry_check.is_valid:
                raise InvalidFieldGeometry("O polígono informado não é uma geometria válida.")
            if geometry_check.area_m2 <= 0:
                raise InvalidFieldGeometry("O polígono deve possuir uma área maior que zero.")
            spatial_validation_service.validate_resource(
                db,
                farm_id,
                "field",
                json.loads(geometry_json),
            )

            row = db.execute(
                text(
                    """
                    WITH input AS (
                        SELECT ST_SetSRID(ST_GeomFromGeoJSON(:geometry_json), 4326) AS geom
                    )
                    INSERT INTO fields (nome, cultura, safra, area_ha, geometry, farm_id)
                    SELECT :nome, :cultura, :safra,
                           ST_Area(geom::geography) / 10000.0, geom, :farm_id
                    FROM input
                    RETURNING id, nome, cultura, safra, area_ha,
                              ST_AsGeoJSON(geometry) AS geometry_json,
                              created_at, updated_at
                    """
                ),
                {
                    "nome": payload.nome,
                    "cultura": payload.cultura,
                    "safra": payload.safra,
                    "geometry_json": geometry_json,
                    "farm_id": farm_id,
                },
            ).one()
            db.commit()
            return self._serialize_row(row)

    def list_all(self, farm_id: int):
        with SessionLocal() as db:
            rows = db.execute(
                text(
                    """
                    SELECT id, nome, cultura, safra, area_ha,
                           ST_AsGeoJSON(geometry) AS geometry_json,
                           created_at, updated_at
                    FROM fields
                    WHERE farm_id = :farm_id
                    ORDER BY id
                    """
                ),
                {"farm_id": farm_id},
            ).all()
            return [self._serialize_row(row) for row in rows]

    def get_by_id(self, field_id: int, farm_id: int):
        with SessionLocal() as db:
            row = db.execute(
                text(
                    """
                    SELECT id, nome, cultura, safra, area_ha,
                           ST_AsGeoJSON(geometry) AS geometry_json,
                           created_at, updated_at
                    FROM fields
                    WHERE id = :field_id AND farm_id = :farm_id
                    """
                ),
                {"field_id": field_id, "farm_id": farm_id},
            ).one_or_none()
            return self._serialize_row(row) if row is not None else None