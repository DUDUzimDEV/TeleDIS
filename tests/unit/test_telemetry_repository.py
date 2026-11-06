from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.machine import Machine
from app.models.operations import Operation
from app.models.telemetry import MachineLocation, MeasurementType, TelemetryReading
from app.repositories import telemetry_repository
from app.repositories.telemetry_repository import TelemetryRepository
from app.services.spatial_validation_service import spatial_validation_service


class FakeDatabase:
    def get(self, model, machine_id):
        self.lookup = (model, machine_id)
        return None


def test_unknown_machine_telemetry_does_not_create_a_machine():
    db = FakeDatabase()

    with pytest.raises(LookupError, match="Máquina 404 não cadastrada"):
        TelemetryRepository._ensure_machine(db, 404)

    assert db.lookup[1] == 404


def test_simulated_location_uses_registered_machine_farm_not_payload(monkeypatch):
    machine = SimpleNamespace(id=12, farm_id=42)

    class FakeSession(FakeDatabase):
        def __init__(self):
            self.added = None

        def get(self, model, machine_id):
            return machine

        def add(self, instance):
            self.added = instance

        def commit(self):
            pass

        def refresh(self, instance):
            instance.id = 99

    class SessionContext:
        def __init__(self, session):
            self.session = session

        def __enter__(self):
            return self.session

        def __exit__(self, exc_type, exc, traceback):
            return False

    session = FakeSession()
    boundary_calls = []
    monkeypatch.setattr(
        telemetry_repository,
        "SessionLocal",
        lambda: SessionContext(session),
    )
    monkeypatch.setattr(
        spatial_validation_service,
        "validate_simulated_location",
        lambda db, farm_id, latitude, longitude: boundary_calls.append(
            (db, farm_id, latitude, longitude)
        ),
    )

    result = TelemetryRepository().create_location({
        "maquina_id": machine.id,
        "timestamp": datetime(2026, 10, 1, 14, 10, tzinfo=timezone.utc).isoformat(),
        "latitude": -23.5,
        "longitude": -47.4,
        "farm_id": 999,
        "source": "SIMULATED",
    })

    assert boundary_calls == [(session, machine.farm_id, -23.5, -47.4)]
    assert session.added.farm_id == machine.farm_id
    assert result["source"] == "SIMULATED"


def test_simulated_mqtt_retries_are_idempotent_without_deduplicating_real_data(monkeypatch):
    engine = create_engine("sqlite://")
    tables = [
        Machine.__table__,
        Operation.__table__,
        MeasurementType.__table__,
        TelemetryReading.__table__,
        MachineLocation.__table__,
    ]
    Base.metadata.create_all(engine, tables=tables)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        db.add(Machine(id=7, name="Test", code="SIM-7", farm_id=42))
        db.commit()

    monkeypatch.setattr(telemetry_repository, "SessionLocal", session_factory)
    monkeypatch.setattr(
        spatial_validation_service,
        "validate_simulated_location",
        lambda *args: None,
    )

    timestamp = "2026-10-01T14:10:00Z"
    reading_payload = {
        "maquina_id": 7,
        "timestamp": timestamp,
        "metric": "temperatura",
        "valor": 21.5,
        "source": "SIMULATED",
    }
    repository = TelemetryRepository()
    first_reading = repository.create_reading(reading_payload)
    retried_reading = repository.create_reading(reading_payload)

    assert retried_reading["id"] == first_reading["id"]
    with pytest.raises(ValueError, match="Conflito de identidade"):
        repository.create_reading({**reading_payload, "valor": 22})
    repository.create_reading({**reading_payload, "source": "REAL"})

    location_payload = {
        "maquina_id": 7,
        "timestamp": timestamp,
        "latitude": -23.5,
        "longitude": -47.4,
        "source": "SIMULATED",
    }
    first_location = repository.create_location(location_payload)
    retried_location = repository.create_location(location_payload)

    assert retried_location["id"] == first_location["id"]
    with pytest.raises(ValueError, match="Conflito de identidade"):
        repository.create_location({**location_payload, "longitude": -47.3})
    repository.create_location({**location_payload, "source": "REAL"})

    with session_factory() as db:
        assert db.query(func.count(TelemetryReading.id)).scalar() == 2
        assert db.query(func.count(MachineLocation.id)).scalar() == 2

    engine.dispose()


def _operation(operation_id, farm_id):
    timestamp = datetime(2026, 10, 1, 14, 0, tzinfo=timezone.utc)
    return Operation(
        id=operation_id,
        farm_id=farm_id,
        code=f"OP-{operation_id}",
        operation_type="COLHEITA",
        name=f"Operação {operation_id}",
        field_id=1,
        status="EM_EXECUCAO",
        created_by=1,
        created_at=timestamp,
        updated_at=timestamp,
        started_at=timestamp,
    )


def test_explicit_operation_is_validated_and_legacy_payload_stays_unlinked(monkeypatch):
    engine = create_engine("sqlite://")
    tables = [
        Machine.__table__,
        Operation.__table__,
        MeasurementType.__table__,
        TelemetryReading.__table__,
        MachineLocation.__table__,
    ]
    Base.metadata.create_all(engine, tables=tables)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        db.add(Machine(id=7, name="Test", code="SIM-7", farm_id=42))
        db.add_all([_operation(10, 42), _operation(11, 99)])
        db.commit()

    monkeypatch.setattr(telemetry_repository, "SessionLocal", session_factory)
    monkeypatch.setattr(
        spatial_validation_service,
        "validate_simulated_location",
        lambda *args: None,
    )
    repository = TelemetryRepository()
    timestamp = "2026-10-01T14:10:00Z"

    explicit_reading = repository.create_reading({
        "maquina_id": 7,
        "operation_id": 10,
        "timestamp": timestamp,
        "metric": "temperatura",
        "valor": 21.5,
    })
    legacy_reading = repository.create_reading({
        "maquina_id": 7,
        "timestamp": "2026-10-01T14:11:00Z",
        "metric": "temperatura",
        "valor": 21.6,
    })
    explicit_location = repository.create_location({
        "maquina_id": 7,
        "operation_id": 10,
        "timestamp": timestamp,
        "latitude": -23.5,
        "longitude": -47.4,
    })
    legacy_location = repository.create_location({
        "maquina_id": 7,
        "timestamp": "2026-10-01T14:11:00Z",
        "latitude": -23.5,
        "longitude": -47.4,
    })

    assert explicit_reading["operation_id"] == 10
    assert explicit_location["operation_id"] == 10
    assert legacy_reading["operation_id"] is None
    assert legacy_location["operation_id"] is None

    for invalid_operation_id in (999, 11):
        with pytest.raises(ValueError, match="operation_id inválido"):
            repository.create_reading({
                "maquina_id": 7,
                "operation_id": invalid_operation_id,
                "timestamp": f"2026-10-01T14:{invalid_operation_id % 60:02d}:00Z",
                "metric": "temperatura",
                "valor": 22.0,
            })
        with pytest.raises(ValueError, match="operation_id inválido"):
            repository.create_location({
                "maquina_id": 7,
                "operation_id": invalid_operation_id,
                "timestamp": f"2026-10-01T15:{invalid_operation_id % 60:02d}:00Z",
                "latitude": -23.5,
                "longitude": -47.4,
            })

    with session_factory() as db:
        assert db.query(TelemetryReading).count() == 2
        assert db.query(MachineLocation).count() == 2

    engine.dispose()


def test_simulated_retries_cannot_change_explicit_operation_linkage(monkeypatch):
    engine = create_engine("sqlite://")
    tables = [
        Machine.__table__,
        Operation.__table__,
        MeasurementType.__table__,
        TelemetryReading.__table__,
        MachineLocation.__table__,
    ]
    Base.metadata.create_all(engine, tables=tables)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        db.add(Machine(id=7, name="Test", code="SIM-7", farm_id=42))
        db.add_all([_operation(10, 42), _operation(11, 42)])
        db.commit()

    monkeypatch.setattr(telemetry_repository, "SessionLocal", session_factory)
    monkeypatch.setattr(
        spatial_validation_service,
        "validate_simulated_location",
        lambda *args: None,
    )
    repository = TelemetryRepository()
    reading = {
        "maquina_id": 7,
        "operation_id": 10,
        "timestamp": "2026-10-01T14:10:00Z",
        "metric": "temperatura",
        "valor": 21.5,
        "source": "SIMULATED",
    }
    location = {
        "maquina_id": 7,
        "operation_id": 10,
        "timestamp": "2026-10-01T14:10:00Z",
        "latitude": -23.5,
        "longitude": -47.4,
        "source": "SIMULATED",
    }

    repository.create_reading(reading)
    repository.create_location(location)
    with pytest.raises(ValueError, match="Conflito de identidade"):
        repository.create_reading({**reading, "operation_id": 11})
    with pytest.raises(ValueError, match="Conflito de identidade"):
        repository.create_location({**location, "operation_id": 11})

    with session_factory() as db:
        assert db.query(TelemetryReading).count() == 1
        assert db.query(MachineLocation).count() == 1
        assert db.query(TelemetryReading).one().operation_id == 10
        assert db.query(MachineLocation).one().operation_id == 10

    engine.dispose()
