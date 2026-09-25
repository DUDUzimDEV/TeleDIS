from fastapi import APIRouter

router = APIRouter(tags=["machines"])


@router.get("")
def list_machines():
    return {
        "success": True,
        "data": [
            {"id": 1, "nome": "MF 4270", "status": "ativo", "tipo": "trator"},
            {"id": 2, "nome": "G 600", "status": "manutencao", "tipo": "colheitadeira"},
        ],
    }


@router.get("/{machine_id}")
def get_machine(machine_id: int):
    return {"success": True, "data": {"id": machine_id, "nome": "MF 4270", "status": "ativo"}}
