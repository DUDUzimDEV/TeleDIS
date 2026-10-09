import json

from sqlalchemy import text

from app.database import SessionLocal
from app.services.spatial_validation_service import spatial_validation_service


class InvalidStructureGeometry(ValueError):
    pass


class StructureRepository:
    @staticmethod
    def _serialize_row(row):
        structure = dict(row._mapping)
        geometry = structure.pop("geometry_json")
        structure["geometry"] = json.loads(geometry) if isinstance(geometry, str) else geometry
        return structure

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

            if not geometry_check.is_valid or geometry_check.srid != 4326 or geometry_check.geometry_type != "ST_Point":
                raise InvalidStructureGeometry("A localização informada não é um ponto geográfico válido.")
            spatial_validation_service.validate_resource(
                db,
                farm_id,
                "structure",
                json.loads(geometry_json),
            )

            row = db.execute(
                text(
                    """
                    WITH input AS (
                        SELECT ST_SetSRID(ST_GeomFromGeoJSON(:geometry_json), 4326) AS geom
                    )
                    INSERT INTO structures (nome, tipo, descricao, geometry, farm_id)
                    SELECT :nome, :tipo, :descricao, geom, :farm_id
                    FROM input
                    RETURNING id, nome, tipo, descricao,
                              ST_AsGeoJSON(geometry) AS geometry_json,
                              created_at, updated_at
                    """
                ),
                {
                    "nome": payload.nome,
                    "tipo": payload.tipo,
                    "descricao": payload.descricao,
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
                    SELECT id, nome, tipo, descricao,
                           ST_AsGeoJSON(geometry) AS geometry_json,
                           created_at, updated_at
                    FROM structures
                    WHERE farm_id = :farm_id
                    ORDER BY id
                    """
                ),
                {"farm_id": farm_id},
            ).all()
            return [self._serialize_row(row) for row in rows]

    def get_by_id(self, structure_id: int, farm_id: int):
        with SessionLocal() as db:
            row = db.execute(
                text(
                    """
                    SELECT id, nome, tipo, descricao,
                           ST_AsGeoJSON(geometry) AS geometry_json,
                           created_at, updated_at
                    FROM structures
                    WHERE id = :structure_id AND farm_id = :farm_id
                    """
                ),
                {"structure_id": structure_id, "farm_id": farm_id},
            ).one_or_none()
            return self._serialize_row(row) if row is not None else None