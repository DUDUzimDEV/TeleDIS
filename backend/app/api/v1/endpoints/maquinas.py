from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.core.security import ensure_machine_access, require_permission
from app.database import SessionLocal
from app.repositories.machine_repository import MachineRepository
from app.schemas.machine import MachineCreate
from app.services.audit_service import record_audit

router = APIRouter(tags=["machines"])
repository = MachineRepository()


class MachineStatusUpdate(BaseModel):
    status: str = Field(..., min_length=2, max_length=30)


@router.get("")
def list_machines(context: dict = Depends(require_permission("machines.view"))):
    if context["role"] == "OPERATOR" and context["assigned_machine_id"] is None:
        return {"success": True, "data": []}
    assigned_machine_id = context["assigned_machine_id"] if context["role"] == "OPERATOR" else None
    return {"success": True, "data": repository.list_all(context["farm_id"], assigned_machine_id)}


@router.get("/{machine_id}")
def get_machine(machine_id: int, context: dict = Depends(require_permission("machines.view"))):
    ensure_machine_access(context, machine_id)
    machine = repository.get_by_id(machine_id, context["farm_id"])
    if machine is None:
        raise HTTPException(status_code=404, detail="Máquina não encontrada.")
    return {"success": True, "data": machine}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_machine(
    payload: MachineCreate,
    request: Request,
    context: dict = Depends(require_permission("machines.create")),
):
    machine = repository.create(payload, context["farm_id"])
    with SessionLocal.begin() as db:
        record_audit(db, context=context, action="machines.create", resource="machine",
                     resource_id=machine["id"], request=request)
    return {"success": True, "data": machine}


@router.patch("/{machine_id}")
def update_machine_status(
    machine_id: int,
    payload: MachineStatusUpdate,
    request: Request,
    context: dict = Depends(require_permission("machines.update")),
):
    machine = repository.update_status(machine_id, context["farm_id"], payload.status)
    if machine is None:
        raise HTTPException(status_code=404, detail="Máquina não encontrada.")
    with SessionLocal.begin() as db:
        record_audit(db, context=context, action="machines.update", resource="machine",
                     resource_id=machine_id, request=request, details={"status": payload.status})
    return {"success": True, "data": machine}
