from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.security import ensure_machine_access, require_permission
from app.database import SessionLocal
from app.models.operations import Operation
from app.schemas.simulator import SimulatedLocationValidation, SimulatorOperationTransition
from app.services.operations_service import OperationalService
from app.services.simulator_context_service import (
    simulated_location_validator,
    simulator_context_resolver,
)

router = APIRouter(tags=["simulator"])
operations_service = OperationalService()

ACTION_TO_STATUS = {
    "accept": "ACEITA",
    "start": "EM_EXECUCAO",
    "complete": "CONCLUIDA",
}


@router.get("/machines/{machine_id}/context")
def get_machine_simulator_context(
    machine_id: int,
    context: dict = Depends(require_permission("machines.view")),
):
    ensure_machine_access(context, machine_id)
    return {
        "success": True,
        "data": simulator_context_resolver.resolve(machine_id, context["farm_id"]),
    }


@router.post("/machines/{machine_id}/validate-location")
def validate_machine_simulated_location(
    machine_id: int,
    payload: SimulatedLocationValidation,
    context: dict = Depends(require_permission("machines.view")),
):
    ensure_machine_access(context, machine_id)
    return {
        "success": True,
        "data": simulated_location_validator.validate(
            machine_id,
            context["farm_id"],
            payload.latitude,
            payload.longitude,
        ),
    }


@router.post("/operations/{operation_id}/transition")
def transition_operation_for_simulator(
    operation_id: int,
    payload: SimulatorOperationTransition,
    request: Request,
    context: dict = Depends(require_permission("operations.assign")),
):
    with SessionLocal() as db:
        operation = db.query(Operation).filter(
            Operation.id == operation_id,
            Operation.farm_id == context["farm_id"],
        ).one_or_none()
        if operation is None:
            raise HTTPException(status_code=404, detail="Operação não encontrada.")
        if operation.operator_id is None:
            raise HTTPException(
                status_code=409,
                detail="Operação não possui operador atribuído para transição simulada.",
            )
        operator_id = operation.operator_id

    operator_context = {
        **context,
        "role": "OPERATOR",
        "user": {**context["user"], "id": operator_id},
    }
    target_status = ACTION_TO_STATUS[payload.action]
    reason = payload.reason or (
        f"Transição '{payload.action}' executada automaticamente pelo simulador operacional (SIMULATED)."
    )
    updated = operations_service.change_status(
        operator_context,
        operation_id,
        target_status,
        reason,
        request,
    )
    return {"success": True, "data": updated}
