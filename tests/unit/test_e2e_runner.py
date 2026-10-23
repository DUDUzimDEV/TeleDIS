import pytest

from scripts.teledis_e2e import (
    SCENARIO_OPERATION_NAME,
    ScenarioError,
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


def test_prepare_reuses_the_only_non_terminal_run():
    existing = [
        operation(6, "CONCLUIDA"),
        operation(7, "ATRIBUIDA", 2),
    ]

    assert _select_prepared_operation(existing)["id"] == 7
    assert _next_scenario_operation_name(existing)[1] == 3


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
