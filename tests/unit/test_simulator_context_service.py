import pytest
from fastapi import HTTPException

from app.services.simulator_context_service import SimulatorContextResolver


@pytest.mark.parametrize(
    (
        "operation_status", "has_location", "has_field", "has_route",
        "inside_field", "on_route", "moving_towards_operation", "base_structure",
        "location_at_base", "return_route_available", "expected",
    ),
    [
        (None, True, False, False, False, False, False, None, False, False, "NO_BASE_CONFIGURED"),
        (None, True, False, False, False, False, False, {"id": 9, "location": {}}, True, False, "AT_BASE"),
        (None, True, False, False, False, False, False, {"id": 9, "location": {}}, False, True, "RETURNING_TO_BASE"),
        (None, False, False, False, False, False, False, {"id": 9, "location": {}}, False, False, "AT_BASE"),
        ("PLANEJADA", True, True, False, False, False, False, {"id": 9, "location": {}}, False, False, "OPERATION_NOT_READY"),
        ("ATRIBUIDA", True, True, True, False, False, False, {"id": 9, "location": {}}, False, False, "READY_FOR_OPERATION"),
        ("ACEITA", True, True, True, False, False, False, {"id": 9, "location": {}}, False, False, "READY_FOR_OPERATION"),
        ("EM_EXECUCAO", True, True, True, True, False, False, {"id": 9, "location": {}}, False, False, "EXECUTING_OPERATION"),
        ("EM_EXECUCAO", True, True, True, False, True, True, {"id": 9, "location": {}}, False, False, "TRAVELING"),
        ("EM_EXECUCAO", True, True, True, False, True, False, {"id": 9, "location": {}}, False, False, "TRAVELING"),
        ("EM_EXECUCAO", True, True, False, False, False, False, {"id": 9, "location": {}}, False, False, "ERROR"),
        ("EM_EXECUCAO", False, True, True, False, False, False, {"id": 9, "location": {}}, False, False, "ERROR"),
        ("INTERROMPIDA", True, True, True, False, False, False, {"id": 9, "location": {}}, False, False, "PAUSED"),
        ("CONCLUIDA", True, True, True, False, False, False, {"id": 9, "location": {}}, True, False, "AT_BASE"),
        ("CANCELADA", True, True, True, False, False, False, {"id": 9, "location": {}}, False, True, "RETURNING_TO_BASE"),
    ],
)
def test_operation_status_derives_simulator_state_without_changing_operation(
    operation_status,
    has_location,
    has_field,
    has_route,
    inside_field,
    on_route,
    moving_towards_operation,
    base_structure,
    location_at_base,
    return_route_available,
    expected,
):
    operation = {"status": operation_status} if operation_status else None
    location = {"latitude": -23.5} if has_location else None
    field = {"id": 4} if has_field else None
    route = {"id": 8} if has_route else None

    state, reason = SimulatorContextResolver._derive_state(
        operation,
        location,
        field,
        route,
        inside_field,
        on_route,
        moving_towards_operation,
        1,
        base_structure,
        location_at_base,
        return_route_available,
    )

    assert state == expected
    assert reason
    if operation is not None:
        assert operation["status"] == operation_status


def test_executing_operation_requires_location_field_and_route_evidence():
    operation = {"status": "EM_EXECUCAO"}

    assert SimulatorContextResolver._derive_state(
        operation, None, {"id": 4}, {"id": 8}, False, False, False, 1, {"id": 9}
    ) == ("ERROR", "CURRENT_LOCATION_NOT_AVAILABLE")
    assert SimulatorContextResolver._derive_state(
        operation, {"latitude": 0}, None, {"id": 8}, False, False, False, 1, {"id": 9}
    ) == ("ERROR", "OPERATION_FIELD_NOT_AVAILABLE")
    assert SimulatorContextResolver._derive_state(
        operation, {"latitude": 0}, {"id": 4}, None, False, False, False, 1, {"id": 9}
    ) == ("ERROR", "PLANNED_ROUTE_NOT_AVAILABLE")
    assert SimulatorContextResolver._derive_state(
        operation, {"latitude": 0}, {"id": 4}, {"id": 8}, False, False, False, 1,
        {"id": 9, "location": {}},
    ) == ("ERROR", "LOCATION_NOT_ON_PLANNED_ROUTE")
    assert SimulatorContextResolver._derive_state(
        operation, {"latitude": 0}, {"id": 4}, {"id": 8}, True, False, False, 2, {"id": 9}
    ) == ("ERROR", "MULTIPLE_ACTIVE_OPERATIONS")


def test_resolver_does_not_return_a_machine_from_another_farm(monkeypatch):
    class Result:
        def mappings(self):
            return self

        def one_or_none(self):
            return None

    class FakeDatabase:
        def execute(self, statement, parameters):
            assert parameters == {"machine_id": 7, "farm_id": 3}
            return Result()

    class DatabaseContext:
        def __enter__(self):
            return FakeDatabase()

        def __exit__(self, exc_type, exc, traceback):
            return False

    monkeypatch.setattr(
        "app.services.simulator_context_service.SessionLocal",
        DatabaseContext,
    )

    with pytest.raises(HTTPException) as error:
        SimulatorContextResolver().resolve(machine_id=7, farm_id=3)

    assert error.value.status_code == 404
    assert error.value.detail == "Máquina não encontrada nesta fazenda."
