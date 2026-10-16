from fastapi import APIRouter, Depends

from app.core.security import ensure_machine_access, require_permission
from app.schemas.simulator import SimulatedLocationValidation
from app.services.simulator_context_service import (
    simulated_location_validator,
    simulator_context_resolver,
)

router = APIRouter(tags=["simulator"])


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
