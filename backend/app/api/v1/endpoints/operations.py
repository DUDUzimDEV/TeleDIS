from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.core.security import get_farm_context, require_permission
from app.schemas.operations import (
    OccurrenceCreate,
    OperationAction,
    OperationAssign,
    OperationCreate,
    OperationUpdate,
)
from app.services.operations_service import OperationalService

router = APIRouter(tags=["operations"])
service = OperationalService()


@router.get("")
def list_operations(
    status_filter: str | None = Query(default=None, alias="status"),
    operator_id: int | None = None,
    machine_id: int | None = None,
    team_id: int | None = None,
    field_id: int | None = None,
    context: dict = Depends(require_permission("operations.view")),
):
    return {"success": True, "data": service.list_operations(
        context, status_filter, operator_id, machine_id, team_id, field_id
    )}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_operation(payload: OperationCreate, request: Request,
                     context: dict = Depends(require_permission("operations.create"))):
    return {"success": True, "data": service.create_operation(context, payload.dict(), request)}


@router.get("/summary")
def operation_summary(context: dict = Depends(require_permission("operations.view"))):
    return {"success": True, "data": service.operation_summary(context)}


@router.get("/{operation_id}")
def get_operation(operation_id: int,
                  context: dict = Depends(require_permission("operations.view"))):
    operation = service.get_operation(context, operation_id)
    if operation is None:
        raise HTTPException(status_code=404, detail="Operação não encontrada.")
    return {"success": True, "data": operation}


@router.patch("/{operation_id}")
def update_operation(operation_id: int, payload: OperationUpdate, request: Request,
                     context: dict = Depends(require_permission("operations.update"))):
    return {"success": True, "data": service.update_operation(
        context, operation_id, payload.dict(exclude_unset=True), request
    )}


@router.post("/{operation_id}/assign")
def assign_operation(operation_id: int, payload: OperationAssign, request: Request,
                     context: dict = Depends(require_permission("operations.assign"))):
    return {"success": True, "data": service.assign_operation(
        context, operation_id, payload.dict(), request
    )}


@router.post("/{operation_id}/route")
def calculate_operation_route(operation_id: int, payload: OperationAction, request: Request,
                              context: dict = Depends(require_permission("operations.assign"))):
    if "routes.create" not in context["permissions"]:
        raise HTTPException(status_code=403, detail="Permissão necessária: routes.create")
    return {"success": True, "data": service.calculate_operation_route(
        context, operation_id, payload.reason, request
    )}


def _transition(operation_id: int, new_status: str, payload: OperationAction,
                request: Request, context: dict):
    return {"success": True, "data": service.change_status(
        context, operation_id, new_status, payload.reason, request
    )}


@router.post("/{operation_id}/accept")
def accept_operation(operation_id: int, payload: OperationAction, request: Request,
                     context: dict = Depends(require_permission("operations.execute"))):
    return _transition(operation_id, "ACEITA", payload, request, context)


@router.post("/{operation_id}/start")
def start_operation(operation_id: int, payload: OperationAction, request: Request,
                    context: dict = Depends(require_permission("operations.execute"))):
    return _transition(operation_id, "EM_EXECUCAO", payload, request, context)


@router.post("/{operation_id}/interrupt")
def interrupt_operation(operation_id: int, payload: OperationAction, request: Request,
                        context: dict = Depends(require_permission("operations.execute"))):
    return _transition(operation_id, "INTERROMPIDA", payload, request, context)


@router.post("/{operation_id}/resume")
def resume_operation(operation_id: int, payload: OperationAction, request: Request,
                     context: dict = Depends(require_permission("operations.execute"))):
    return _transition(operation_id, "EM_EXECUCAO", payload, request, context)


@router.post("/{operation_id}/complete")
def complete_operation(operation_id: int, payload: OperationAction, request: Request,
                       context: dict = Depends(require_permission("operations.execute"))):
    return _transition(operation_id, "CONCLUIDA", payload, request, context)


@router.post("/{operation_id}/cancel")
def cancel_operation(operation_id: int, payload: OperationAction, request: Request,
                     context: dict = Depends(get_farm_context)):
    if context["role"] != "OPERATOR" and "operations.assign" not in context["permissions"]:
        raise HTTPException(status_code=403, detail="Permissão necessária: operations.assign")
    if context["role"] == "OPERATOR" and "operations.execute" not in context["permissions"]:
        raise HTTPException(status_code=403, detail="Permissão necessária: operations.execute")
    return _transition(operation_id, "CANCELADA", payload, request, context)


@router.get("/{operation_id}/history")
def operation_history(operation_id: int,
                      context: dict = Depends(require_permission("operations.history"))):
    return {"success": True, "data": service.operation_history(context, operation_id)}


@router.get("/{operation_id}/locations")
def operation_locations(operation_id: int,
                        context: dict = Depends(require_permission("operations.history"))):
    return {"success": True, "data": service.operation_locations(context, operation_id)}


@router.get("/{operation_id}/occurrences")
def list_occurrences(operation_id: int,
                     context: dict = Depends(require_permission("operations.history"))):
    return {"success": True, "data": service.list_occurrences(context, operation_id)}


@router.post("/{operation_id}/occurrences", status_code=status.HTTP_201_CREATED)
def create_occurrence(operation_id: int, payload: OccurrenceCreate, request: Request,
                      context: dict = Depends(require_permission("operations.execute"))):
    return {"success": True, "data": service.create_occurrence(
        context, operation_id, payload.dict(), request
    )}
