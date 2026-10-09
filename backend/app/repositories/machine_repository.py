from sqlalchemy import text

from app.database import SessionLocal


class MachineRepository:
    @staticmethod
    def _read(row):
        return {
            "id": row.id,
            "nome": row.name,
            "code": row.code,
            "status": row.status,
            "tipo": row.tipo,
            "created_at": row.created_at,
        }

    def list_all(self, farm_id: int, machine_id: int | None = None):
        machine_filter = (
            "AND machines.id = :machine_id" if machine_id is not None else ""
        )
        with SessionLocal() as db:
            rows = db.execute(
                text(
                    f"""
                    SELECT machines.id, machines.name, machines.code, machines.status,
                           models.name AS tipo, machines.created_at
                    FROM machines
                    LEFT JOIN models ON models.id = machines.model_id
                    WHERE machines.farm_id = :farm_id
                      {machine_filter}
                    ORDER BY machines.id
                    """
                ),
                {"farm_id": farm_id, **(
                    {"machine_id": machine_id} if machine_id is not None else {}
                )},
            ).all()
            return [self._read(row) for row in rows]

    def get_by_id(self, machine_id: int, farm_id: int):
        with SessionLocal() as db:
            row = db.execute(
                text(
                    """
                    SELECT machines.id, machines.name, machines.code, machines.status,
                           models.name AS tipo, machines.created_at
                    FROM machines
                    LEFT JOIN models ON models.id = machines.model_id
                    WHERE machines.id = :machine_id AND machines.farm_id = :farm_id
                    """
                ),
                {"machine_id": machine_id, "farm_id": farm_id},
            ).one_or_none()
            return self._read(row) if row else None

    def create(self, payload, farm_id: int):
        with SessionLocal.begin() as db:
            row = db.execute(
                text(
                    """
                    INSERT INTO machines (name, code, status, farm_id)
                    VALUES (:name, :code, :status, :farm_id)
                    RETURNING id, name, code, status, created_at
                    """
                ),
                {
                    "name": payload.name.strip(),
                    "code": payload.code.strip(),
                    "status": payload.status,
                    "farm_id": farm_id,
                },
            ).one()
            return {
                "id": row.id,
                "nome": row.name,
                "code": row.code,
                "status": row.status,
                "tipo": None,
                "created_at": row.created_at,
            }

    def update_status(self, machine_id: int, farm_id: int, status: str):
        with SessionLocal.begin() as db:
            row = db.execute(
                text(
                    """
                    UPDATE machines SET status = :status
                    WHERE id = :machine_id AND farm_id = :farm_id
                    RETURNING id, name, code, status, created_at
                    """
                ),
                {"status": status, "machine_id": machine_id, "farm_id": farm_id},
            ).one_or_none()
            if row is None:
                return None
            return {
                "id": row.id,
                "nome": row.name,
                "code": row.code,
                "status": row.status,
                "tipo": None,
                "created_at": row.created_at,
            }
