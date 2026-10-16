from sqlalchemy.exc import IntegrityError
from fastapi.testclient import TestClient

from app.api.v1.endpoints import maquinas
from app.core.security import get_farm_context
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
    assert len(payload["data"]) == 1


def test_machine_create_and_get_use_active_farm(monkeypatch):
    calls = {}
    machine = {
        "id": 25,
        "nome": "Trator teste",
        "code": "TR-TESTE",
        "status": "active",
        "tipo": None,
        "created_at": None,
    }

    def create(payload, farm_id):
        calls["create"] = (payload, farm_id)
        return machine

    def get_by_id(machine_id, farm_id):
        calls["get"] = (machine_id, farm_id)
        return machine if machine_id == machine["id"] and farm_id == 1 else None

    monkeypatch.setattr(maquinas.repository, "create", create)
    monkeypatch.setattr(maquinas.repository, "get_by_id", get_by_id)

    response = client.post(
        "/api/v1/machines",
        json={
            "name": "  Trator teste  ",
            "code": " TR-TESTE ",
            "status": " active ",
            "farm_id": 999,
        },
    )
    assert response.status_code == 201
    assert calls["create"][1] == 1
    assert calls["create"][0].name == "Trator teste"
    assert calls["create"][0].code == "TR-TESTE"
    assert "farm_id" not in response.json()["data"]

    detail = client.get("/api/v1/machines/25")
    assert detail.status_code == 200
    assert detail.json()["data"]["id"] == 25
    assert calls["get"] == (25, 1)


def test_machine_update_changes_name_code_and_status(monkeypatch):
    calls = {}
    machine = {
        "id": 25,
        "nome": "Trator atualizado",
        "code": "TR-NOVO",
        "status": "maintenance",
        "tipo": None,
        "created_at": None,
    }

    def update(machine_id, farm_id, changes):
        calls["update"] = (machine_id, farm_id, changes)
        return machine

    monkeypatch.setattr(maquinas.repository, "update", update)
    response = client.patch(
        "/api/v1/machines/25",
        json={"name": "Trator atualizado", "code": "TR-NOVO", "status": "maintenance"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["nome"] == "Trator atualizado"
    assert calls["update"] == (
        25,
        1,
        {"name": "Trator atualizado", "code": "TR-NOVO", "status": "maintenance"},
    )


def test_machine_create_and_update_validate_required_text(monkeypatch):
    create_calls = []
    update_calls = []
    monkeypatch.setattr(maquinas.repository, "create", lambda *args: create_calls.append(args))
    monkeypatch.setattr(maquinas.repository, "update", lambda *args: update_calls.append(args))

    invalid_create = client.post(
        "/api/v1/machines",
        json={"name": "  ", "code": "T1", "status": "active"},
    )
    invalid_update = client.patch("/api/v1/machines/25", json={"name": " "})
    empty_update = client.patch("/api/v1/machines/25", json={})

    assert invalid_create.status_code == 422
    assert invalid_update.status_code == 422
    assert empty_update.status_code == 422
    assert not create_calls
    assert not update_calls


def test_machine_code_conflict_returns_409(monkeypatch):
    monkeypatch.setattr(
        maquinas.repository,
        "create",
        lambda *args: (_ for _ in ()).throw(
            IntegrityError("duplicate machine code", {}, Exception("duplicate"))
        ),
    )

    response = client.post(
        "/api/v1/machines",
        json={"name": "Trator teste", "code": "TR-TESTE"},
    )
    assert response.status_code == 409
    assert "código da máquina" in response.json()["detail"]


def test_machine_write_routes_require_permissions():
    previous_context = app.dependency_overrides[get_farm_context]

    def read_only_context():
        return {
            "user": {"id": 1},
            "farm_id": 1,
            "role": "ANALYST",
            "permissions": {"machines.view"},
            "membership": None,
            "assigned_machine_id": None,
        }

    app.dependency_overrides[get_farm_context] = read_only_context
    try:
        create_response = client.post(
            "/api/v1/machines",
            json={"name": "Trator teste", "code": "TR-TESTE"},
        )
        update_response = client.patch(
            "/api/v1/machines/25",
            json={"name": "Trator atualizado"},
        )
    finally:
        app.dependency_overrides[get_farm_context] = previous_context

    assert create_response.status_code == 403
    assert update_response.status_code == 403


def test_machine_outside_active_farm_is_not_found(monkeypatch):
    calls = {}

    def get_by_id(machine_id, farm_id):
        calls["get"] = (machine_id, farm_id)
        return None

    def update(machine_id, farm_id, changes):
        calls["update"] = (machine_id, farm_id, changes)
        return None

    monkeypatch.setattr(maquinas.repository, "get_by_id", get_by_id)
    monkeypatch.setattr(maquinas.repository, "update", update)

    detail = client.get("/api/v1/machines/99")
    update_response = client.patch("/api/v1/machines/99", json={"status": "inactive"})

    assert detail.status_code == 404
    assert update_response.status_code == 404
    assert calls["get"] == (99, 1)
    assert calls["update"] == (99, 1, {"status": "inactive"})
