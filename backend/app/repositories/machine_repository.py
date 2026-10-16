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
            "base_structure_id": row.base_structure_id,
            "created_at": row.created_at,
        }

    @staticmethod
    def _select_machine():
        return """
            SELECT machines.id, machines.name, machines.code, machines.status,
                   machines.base_structure_id,
                   models.name AS tipo, machines.created_at
            FROM machines
            LEFT JOIN models ON models.id = machines.model_id
        """

    def list_all(self, farm_id: int, machine_id: int | None = None):
        machine_filter = (
            "AND machines.id = :machine_id" if machine_id is not None else ""
        )
        with SessionLocal() as db:
            rows = db.execute(
                text(
                    f"""{self._select_machine()}
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
                    f"""{self._select_machine()}
                    WHERE machines.id = :machine_id AND machines.farm_id = :farm_id
                    """
                ),
                {"machine_id": machine_id, "farm_id": farm_id},
            ).one_or_none()
            return self._read(row) if row else None

    def create(self, payload, farm_id: int):
        with SessionLocal.begin() as db:
            created = db.execute(
                text(
                    """
                    INSERT INTO machines (name, code, status, farm_id, base_structure_id)
                    VALUES (:name, :code, :status, :farm_id, :base_structure_id)
                    RETURNING id, name, code, status, base_structure_id, created_at
                    """
                ),
                {
                    "name": payload.name.strip(),
                    "code": payload.code.strip(),
                    "status": payload.status,
                    "farm_id": farm_id,
                    "base_structure_id": getattr(payload, "base_structure_id", None),
                },
            ).one()
            row = db.execute(
                text(
                    f"""{self._select_machine()}
                    WHERE machines.id = :machine_id AND machines.farm_id = :farm_id
                    """
                ),
                {"machine_id": created.id, "farm_id": farm_id},
            ).one()
            return self._read(row)

    def update(self, machine_id: int, farm_id: int, changes: dict):
        if not changes:
            return self.get_by_id(machine_id, farm_id)
        allowed_columns = {"name", "code", "status", "base_structure_id"}
        if not changes.keys() <= allowed_columns:
            raise ValueError("Campos de máquina não suportados.")
        assignments = ", ".join(f"{column} = :{column}" for column in changes)
        parameters = {
            **changes,
            "machine_id": machine_id,
            "farm_id": farm_id,
        }
        with SessionLocal.begin() as db:
            if "base_structure_id" in changes:
                base_structure_id = changes["base_structure_id"]
                if base_structure_id is not None:
                    structure = db.execute(
                        text(
                            """
                            SELECT id
                            FROM structures
                            WHERE id = :structure_id AND farm_id = :farm_id
                            """
                        ),
                        {"structure_id": base_structure_id, "farm_id": farm_id},
                    ).one_or_none()
                    if structure is None:
                        raise ValueError("A estrutura-base deve pertencer à mesma fazenda da máquina.")
            updated = db.execute(
                text(
                    f"""
                    UPDATE machines SET {assignments}
                    WHERE id = :machine_id AND farm_id = :farm_id
                    RETURNING id
                    """
                ),
                parameters,
            ).one_or_none()
            if updated is None:
                return None
            row = db.execute(
                text(
                    f"""{self._select_machine()}
                    WHERE machines.id = :machine_id AND machines.farm_id = :farm_id
                    """
                ),
                {"machine_id": machine_id, "farm_id": farm_id},
            ).one()
            return self._read(row)
