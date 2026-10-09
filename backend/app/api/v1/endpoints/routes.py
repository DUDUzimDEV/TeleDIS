from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.security import ensure_machine_access, require_permission
from app.database import SessionLocal
from app.schemas.routes import (
    NetworkRebuildResult,
    RouteCalculateRequest,
    RouteNodeRead,
    RouteResult,
    RouteSegmentRead,
)
from app.services.route_network_service import RouteNetworkService
from app.services.route_service import (
    DestinationTooFar,
    MachineLocationNotFound,
    MachineNotFound,
    NoRoadNetwork,
    OriginTooFar,
    RouteNotFound,
    RouteService,
    StructureNotFound,
)
from app.services.audit_service import record_audit

router = APIRouter(tags=["routes"])
network_service = RouteNetworkService()
route_service = RouteService()


@router.post(
    "/network/rebuild",
    response_model=NetworkRebuildResult,
)
def rebuild_network(context: dict = Depends(require_permission("roads.update"))):
    result = network_service.rebuild(context["farm_id"])
    with SessionLocal.begin() as db:
        record_audit(db, context=context, action="routes.network.rebuild", resource="route_network")
    return result


@router.get("/nodes", response_model=list[RouteNodeRead])
def list_network_nodes(context: dict = Depends(require_permission("routes.view"))):
    return network_service.list_nodes(context["farm_id"])


@router.get("/segments", response_model=list[RouteSegmentRead])
def list_network_segments(context: dict = Depends(require_permission("routes.view"))):
    return network_service.list_segments(context["farm_id"])


def _route_error_status(error: Exception) -> int:
    if isinstance(error, (MachineNotFound, StructureNotFound)):
        return status.HTTP_404_NOT_FOUND
    return status.HTTP_422_UNPROCESSABLE_ENTITY


def _raise_route_http_error(error: Exception):
    message = getattr(error, "message", str(error))
    raise HTTPException(status_code=_route_error_status(error), detail=message) from error


@router.post("/calculate", response_model=RouteResult)
def calculate_route(
    payload: RouteCalculateRequest,
    request: Request,
    context: dict = Depends(require_permission("routes.create")),
):
    try:
        result = route_service.calculate(
            payload.origin.dict(),
            payload.destination.dict(),
            context["farm_id"],
        )
        with SessionLocal.begin() as db:
            record_audit(db, context=context, action="routes.create", resource="route",
                         request=request, details={"segments": result["segments"]})
        return result
    except (NoRoadNetwork, OriginTooFar, DestinationTooFar, RouteNotFound) as exc:
        _raise_route_http_error(exc)


@router.post(
    "/machine/{machine_id}/to-structure/{structure_id}",
    response_model=RouteResult,
)
def calculate_machine_route(
    machine_id: int,
    structure_id: int,
    request: Request,
    context: dict = Depends(require_permission("routes.create")),
):
    ensure_machine_access(context, machine_id)
    try:
        result = route_service.calculate_machine_to_structure(machine_id, structure_id, context["farm_id"])
        with SessionLocal.begin() as db:
            record_audit(db, context=context, action="routes.create", resource="route",
                         resource_id=None, request=request,
                         details={"machine_id": machine_id, "structure_id": structure_id,
                                  "segments": result["segments"]})
        return result
    except (
        NoRoadNetwork,
        OriginTooFar,
        DestinationTooFar,
        RouteNotFound,
        MachineNotFound,
        MachineLocationNotFound,
        StructureNotFound,
    ) as exc:
        _raise_route_http_error(exc)
