from fastapi import APIRouter

from app.repositories.telemetry_repository import TelemetryRepository

router = APIRouter(tags=["telemetry"])
repository = TelemetryRepository()


@router.get("")
def list_telemetry():
    return {
        "success": True,
        "data": repository.list_recent(),
    }


@router.get("/{machine_id}")
def get_machine_telemetry(machine_id: int):
    return {
        "success": True,
        "data": {
            "maquina_id": machine_id,
            "historico": repository.list_recent(machine_id),
        },
    }
