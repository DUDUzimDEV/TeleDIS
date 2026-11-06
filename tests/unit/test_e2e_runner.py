from types import SimpleNamespace

import pytest

import scripts.teledis_e2e as e2e
from scripts.teledis_e2e import (
    SCENARIO_OPERATION_NAME,
    ScenarioError,
    cleanup,
    _host_for_local_process,
    _next_scenario_operation_name,
    _select_prepared_operation,
)


def operation(operation_id, status, suffix=None):
    name = SCENARIO_OPERATION_NAME
    if suffix is not None:
        name = f"{name} #{suffix}"
    return {"id": operation_id, "name": name, "status": status}


def test_terminal_run_is_preserved_and_next_run_gets_a_new_name():
    existing = [operation(6, "CONCLUIDA")]

    assert _select_prepared_operation(existing) is None
    assert _next_scenario_operation_name(existing) == (
        f"{SCENARIO_OPERATION_NAME} #2",
        2,
    )


def test_prepare_refuses_to_reuse_a_non_terminal_run():
    existing = [
        operation(6, "CONCLUIDA"),
        operation(7, "ATRIBUIDA", 2),
    ]

    with pytest.raises(ScenarioError, match="não é terminal"):
        _select_prepared_operation(existing)


def test_prepare_refuses_ambiguous_non_terminal_runs():
    existing = [
        operation(7, "ATRIBUIDA", 2),
        operation(8, "ACEITA", 3),
    ]

    with pytest.raises(ScenarioError, match="múltiplas operações E2E"):
        _select_prepared_operation(existing)


def test_unrelated_operations_do_not_change_demo_sequence():
    existing = [{"id": 99, "name": "Colheita comercial", "status": "CONCLUIDA"}]

    assert _select_prepared_operation(existing) is None
    assert _next_scenario_operation_name(existing) == (SCENARIO_OPERATION_NAME, 1)


def test_scenario_machine_codes_are_unique_per_farm():
    assert e2e._scenario_machine_code(2, "A") == "E2E-TELEDIS-FARM-2-MACHINE-A"
    assert e2e._scenario_machine_code(2, "A") != e2e._scenario_machine_code(3, "A")


def test_validate_accepts_only_an_assigned_unstarted_scenario_operation():
    prepared = {
        "id": 12,
        "farm_id": 8,
        "name": SCENARIO_OPERATION_NAME,
        "status": "ATRIBUIDA",
        "machine_id": 4,
        "operator_id": 6,
        "team_id": 3,
        "field_id": 11,
        "route_plan_id": None,
        "started_at": None,
    }

    e2e._assert_prepared_operation(prepared, 8, 12)

    for changed in (
        {**prepared, "status": "EM_EXECUCAO"},
        {**prepared, "farm_id": 9},
        {**prepared, "route_plan_id": 2},
        {**prepared, "started_at": "2026-11-05T12:00:00Z"},
    ):
        with pytest.raises(ScenarioError, match="operação E2E atribuída"):
            e2e._assert_prepared_operation(changed, 8, 12)


@pytest.mark.parametrize(
    ("farm", "allowed"),
    [
        (SimpleNamespace(code="E2E-ISOLATED-001", status="active"), True),
        (SimpleNamespace(code="DEV-TEST-001", status="active"), False),
        (SimpleNamespace(code="E2E-ISOLATED-002", status="inactive"), False),
        (None, False),
    ],
)
def test_scenario_requires_active_dedicated_farm(monkeypatch, farm, allowed):
    class FakeSession:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def get(self, _model, _farm_id):
            return farm

    monkeypatch.setattr(e2e, "SessionLocal", FakeSession)
    if allowed:
        assert e2e._require_isolated_farm(8) is farm
    else:
        with pytest.raises(ScenarioError, match="fazenda ativa e exclusiva"):
            e2e._require_isolated_farm(8)


def test_automatic_cleanup_preserves_records_without_ownership_proof():
    with pytest.raises(ScenarioError, match="dados de teste devem ser preservados"):
        cleanup(1)


@pytest.mark.parametrize(
    ("configured_host", "local_host"),
    [
        ("mqtt", "localhost"),
        ("teledis-mqtt", "localhost"),
        ("localhost", "localhost"),
        ("broker.example.invalid", "broker.example.invalid"),
    ],
)
def test_local_e2e_process_uses_host_reachable_mqtt_endpoint(configured_host, local_host):
    assert _host_for_local_process(configured_host) == local_host


def test_api_request_uses_bearer_token(monkeypatch):
    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return b'{"success": true, "data": []}'

    captured = {}

    def fake_urlopen(request, timeout):
        captured["authorization"] = request.get_header("Authorization")
        return FakeResponse()

    monkeypatch.setattr(e2e, "urlopen", fake_urlopen)
    api = e2e.Api("http://localhost", 42, "e2e-token")

    api.request("GET", "/farms")
    status_code = e2e._http_status(api, "GET", "/farms")

    assert status_code == 200
    assert captured["authorization"] == "Bearer e2e-token"
