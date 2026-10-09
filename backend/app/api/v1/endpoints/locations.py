from fastapi import APIRouter, Depends, Query

from app.core.security import ensure_machine_access, require_permission
from app.repositories.telemetry_repository import TelemetryRepository

router = APIRouter(tags=["locations"])
repository = TelemetryRepository()


@router.get("")
def list_locations(
    limit: int = Query(default=100, ge=1, le=1000),
    context: dict = Depends(require_permission("machines.view")),
):
    if context["role"] == "OPERATOR" and context["assigned_machine_id"] is None:
        return {"success": True, "data": []}
    assigned_machine_id = context["assigned_machine_id"] if context["role"] == "OPERATOR" else None
    return {
        "success": True,
        "data": repository.list_locations(
            machine_id=assigned_machine_id, limit=limit, farm_id=context["farm_id"]
        ),
    }


@router.get("/{machine_id}")
def get_machine_locations(
    machine_id: int,
    limit: int = Query(default=100, ge=1, le=1000),
    context: dict = Depends(require_permission("machines.view")),
):
    ensure_machine_access(context, machine_id)
    locations = repository.list_locations(
        machine_id=machine_id, limit=limit, farm_id=context["farm_id"]
    )
    if not locations:
        return {
            "success": True,
            "data": {"maquina_id": machine_id, "historico": []},
        }
    return {
        "success": True,
        "data": {
            "maquina_id": machine_id,
            "historico": locations,
        },
    }