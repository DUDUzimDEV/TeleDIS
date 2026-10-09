from fastapi.testclient import TestClient

from app.api.v1.endpoints import maquinas
from app.main import app

client = TestClient(app)


def test_machine_list_route(monkeypatch):
    monkeypatch.setattr(maquinas.repository, "list_all", lambda farm_id, machine_id=None: [
        {"id": 1, "nome": "Máquina de teste", "code": "M-TESTE", "status": "active", "tipo": None, "created_at": None},
    ])
    response = client.get("/api/v1/machines")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert len(payload["data"]) >= 1
