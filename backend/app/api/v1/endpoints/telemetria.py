from fastapi import APIRouter

router = APIRouter(tags=["telemetry"])


@router.get("")
def list_telemetry():
    return {
        "success": True,
        "data": [
            {"maquina_id": 1, "timestamp": "2026-09-25T10:00:00Z", "temperatura": 87.5, "velocidade": 8.4},
            {"maquina_id": 1, "timestamp": "2026-09-25T10:05:00Z", "temperatura": 89.1, "velocidade": 9.2},
        ],
    }


@router.get("/{machine_id}")
def get_machine_telemetry(machine_id: int):
    return {
        "success": True,
        "data": {
            "maquina_id": machine_id,
            "historico": [
                {"timestamp": "2026-09-25T10:00:00Z", "temperatura": 87.5, "velocidade": 8.4},
                {"timestamp": "2026-09-25T10:05:00Z", "temperatura": 89.1, "velocidade": 9.2},
            ],
        },
    }
