from fastapi import APIRouter, Depends

from app.core.security import ensure_machine_access, require_permission
from app.repositories.telemetry_repository import TelemetryRepository

router = APIRouter(tags=["telemetry"])
repository = TelemetryRepository()


@router.get("")
def list_telemetry(context: dict = Depends(require_permission("telemetry.view"))):
    if context["role"] == "OPERATOR" and context["assigned_machine_id"] is None:
        return {"success": True, "data": []}
    assigned_machine_id = context["assigned_machine_id"] if context["role"] == "OPERATOR" else None
    return {
        "success": True,
        "data": repository.list_recent(machine_id=assigned_machine_id, farm_id=context["farm_id"]),
    }


@router.get("/{machine_id}")
def get_machine_telemetry(
    machine_id: int,
    context: dict = Depends(require_permission("telemetry.history")),
):
    ensure_machine_access(context, machine_id)
    return {
        "success": True,
        "data": {
            "maquina_id": machine_id,
            "historico": repository.list_recent(machine_id, farm_id=context["farm_id"]),
        },
    }
