from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.machine import Machine
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
