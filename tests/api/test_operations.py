import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints import operations, teams
from app.core.security import get_farm_context
from app.main import app

client = TestClient(app)


def test_create_team_uses_active_farm_and_rejects_farm_id(monkeypatch):
    received = {}

    def create_team(context, payload, request):
        del request
        received["farm_id"] = context["farm_id"]
        received["payload"] = payload
        return {"id": 4, "name": payload["name"]}

    monkeypatch.setattr(teams.service, "create_team", create_team)

    response = client.post("/api/v1/teams", json={"name": "Equipe A", "code": "EQA"})
    assert response.status_code == 201
    assert received["farm_id"] == 1
    assert received["payload"]["name"] == "Equipe A"

    forged = client.post(
        "/api/v1/teams",
        json={"name": "Equipe B", "code": "EQB", "farm_id": 2},
    )
    assert forged.status_code == 422


def test_create_operation_passes_selected_farm_and_payload(monkeypatch):
    received = {}

    def create_operation(context, payload, request):
        del request
        received["farm_id"] = context["farm_id"]
        received["payload"] = payload
        return {"id": 11, "name": payload["name"], "farm_id": context["farm_id"]}

    monkeypatch.setattr(operations.service, "create_operation", create_operation)
    response = client.post(
        "/api/v1/operations",
        json={
            "operation_type": "COLHEITA",
            "name": "Colheita lote 4",
            "field_id": 8,
            "priority": "ALTA",
        },
    )

    assert response.status_code == 201
    assert response.json()["data"]["farm_id"] == 1
    assert received["payload"]["field_id"] == 8


def test_operation_accept_endpoint_requests_operator_transition(monkeypatch):
    received = {}

    def change_status(context, operation_id, new_status, reason, request):
        del request
        received.update(operation_id=operation_id, new_status=new_status, reason=reason)
        return {"id": operation_id, "status": new_status}

    monkeypatch.setattr(operations.service, "change_status", change_status)
    response = client.post("/api/v1/operations/12/accept", json={"reason": "Recebida"})

    assert response.status_code == 200
    assert received == {"operation_id": 12, "new_status": "ACEITA", "reason": "Recebida"}


def test_operation_summary_returns_only_visible_operation_counts(monkeypatch):
    def limited_context():
        return {
            "user": {"id": 2},
            "farm_id": 1,
            "role": "COORDINATOR",
            "permissions": {"operations.view"},
        }

    previous = app.dependency_overrides[get_farm_context]
    app.dependency_overrides[get_farm_context] = limited_context
    monkeypatch.setattr(operations.service, "list_operations", lambda *_args: [
        {"id": 4, "status": "EM_EXECUCAO", "machine_id": 9},
        {"id": 5, "status": "INTERROMPIDA", "machine_id": 10},
    ])
    try:
        response = client.get("/api/v1/operations/summary")
    finally:
        app.dependency_overrides[get_farm_context] = previous

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["operations_by_status"]["EM_EXECUCAO"] == 1
    assert data["operations_by_status"]["INTERROMPIDA"] == 1
    assert data["machines_in_active_operations"] == 2
    assert data["occurrences_recorded"] is None


def test_operation_summary_requires_view_permission(monkeypatch):
    def limited_context():
        return {
            "user": {"id": 2},
            "farm_id": 1,
            "role": "ANALYST",
            "permissions": set(),
        }

    previous = app.dependency_overrides[get_farm_context]
    app.dependency_overrides[get_farm_context] = limited_context
    monkeypatch.setattr(
        operations.service,
        "operation_summary",
        lambda *_args: pytest.fail("service must not run"),
    )
    try:
        response = client.get("/api/v1/operations/summary")
    finally:
        app.dependency_overrides[get_farm_context] = previous

    assert response.status_code == 403


def test_team_list_requires_permission(monkeypatch):
    def limited_context():
        return {
            "user": {"id": 2},
            "farm_id": 1,
            "role": "ANALYST",
            "permissions": set(),
        }

    previous = app.dependency_overrides[get_farm_context]
    app.dependency_overrides[get_farm_context] = limited_context
    monkeypatch.setattr(
        teams.service,
        "list_teams",
        lambda *_args, **_kwargs: pytest.fail("service must not run"),
    )
    try:
        response = client.get("/api/v1/teams")
    finally:
        app.dependency_overrides[get_farm_context] = previous

    assert response.status_code == 403


def test_team_member_candidates_use_active_farm_and_requested_role(monkeypatch):
    received = {}

    def list_candidates(farm_id, team_id, team_role):
        received.update(farm_id=farm_id, team_id=team_id, team_role=team_role)
        return [{"id": 7, "full_name": "Operador", "role": team_role}]

    monkeypatch.setattr(teams.service, "list_team_member_candidates", list_candidates)
    response = client.get("/api/v1/teams/12/member-candidates?team_role=OPERATOR")

    assert response.status_code == 200
    assert response.json()["data"][0]["id"] == 7
    assert received == {"farm_id": 1, "team_id": 12, "team_role": "OPERATOR"}


def test_team_member_candidates_require_team_management(monkeypatch):
    def limited_context():
        return {
            "user": {"id": 2},
            "farm_id": 1,
            "role": "ANALYST",
            "permissions": {"teams.view"},
        }

    previous = app.dependency_overrides[get_farm_context]
    app.dependency_overrides[get_farm_context] = limited_context
    monkeypatch.setattr(
        teams.service,
        "list_team_member_candidates",
        lambda *_args, **_kwargs: pytest.fail("service must not run"),
    )
    try:
        response = client.get("/api/v1/teams/12/member-candidates?team_role=OPERATOR")
    finally:
        app.dependency_overrides[get_farm_context] = previous

    assert response.status_code == 403
