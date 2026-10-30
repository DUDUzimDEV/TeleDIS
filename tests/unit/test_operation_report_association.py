from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.machine import Machine
from app.models.operations import Operation
from app.models.telemetry import MachineLocation, MeasurementType, TelemetryReading
from app.services.operations_service import OperationalService
import app.services.operations_service as operations_service_module


def _session_factory():
    engine = create_engine('sqlite://')
    Base.metadata.create_all(
        engine,
        tables=[
            Machine.__table__,
            Operation.__table__,
            MeasurementType.__table__,
            TelemetryReading.__table__,
            MachineLocation.__table__,
        ],
    )
    return sessionmaker(bind=engine)


def test_operation_report_prioritizes_explicit_rows_and_uses_temporal_fallback(monkeypatch):
    session_factory = _session_factory()
    monkeypatch.setattr(operations_service_module, 'SessionLocal', session_factory)

    started_at = datetime(2026, 1, 2, 8, 0, tzinfo=timezone.utc)
    completed_at = started_at + timedelta(hours=2)
    with session_factory() as db:
        db.add_all([
            Machine(id=1, name='Machine A', code='M-001', farm_id=1),
            Machine(id=2, name='Machine B', code='M-002', farm_id=1),
            Operation(
                id=10,
                farm_id=1,
                code='OP-10',
                operation_type='COLHEITA',
                name='Operação 10',
                field_id=100,
                machine_id=1,
                status='EM_EXECUCAO',
                created_by=99,
                created_at=started_at,
                updated_at=started_at,
                started_at=started_at,
                completed_at=completed_at,
            ),
            Operation(
                id=11,
                farm_id=1,
                code='OP-11',
                operation_type='COLHEITA',
                name='Operação 11',
                field_id=101,
                machine_id=1,
                status='EM_EXECUCAO',
                created_by=99,
                created_at=started_at,
                updated_at=started_at,
                started_at=started_at,
                completed_at=completed_at,
            ),
            MeasurementType(id=1, name='temperatura', unit='C', type_name='temperature'),
            MeasurementType(id=2, name='pressao', unit='kPa', type_name='pressure'),
        ])
        db.commit()

        db.add_all([
            TelemetryReading(
                machine_id=1,
                farm_id=1,
                operation_id=10,
                measurement_type_id=1,
                recorded_at=started_at - timedelta(hours=2),
                value=72.0,
                source='REAL',
            ),
            TelemetryReading(
                machine_id=1,
                farm_id=1,
                operation_id=None,
                measurement_type_id=1,
                recorded_at=started_at + timedelta(minutes=12),
                value=68.0,
                source='REAL',
            ),
            TelemetryReading(
                machine_id=1,
                farm_id=1,
                operation_id=11,
                measurement_type_id=2,
                recorded_at=started_at + timedelta(minutes=30),
                value=88.0,
                source='REAL',
            ),
            TelemetryReading(
                machine_id=1,
                farm_id=1,
                operation_id=None,
                measurement_type_id=1,
                recorded_at=started_at + timedelta(minutes=12),
                value=68.0,
                source='REAL',
            ),
            MachineLocation(
                machine_id=1,
                farm_id=1,
                operation_id=10,
                recorded_at=started_at - timedelta(hours=1),
                latitude=-22.0,
                longitude=-47.0,
                source='REAL',
            ),
            MachineLocation(
                machine_id=1,
                farm_id=1,
                operation_id=None,
                recorded_at=started_at + timedelta(minutes=5),
                latitude=-22.1,
                longitude=-47.1,
                source='REAL',
            ),
            MachineLocation(
                machine_id=1,
                farm_id=1,
                operation_id=11,
                recorded_at=started_at + timedelta(minutes=15),
                latitude=-21.0,
                longitude=-46.0,
                source='REAL',
            ),
        ])
        db.commit()

    service = OperationalService()
    context = {'farm_id': 1, 'role': 'COORDINATOR', 'user': {'id': 99}, 'permissions': {'operations.history'}}

    telemetry = service.operation_telemetry(context, 10)
    assert [row['association_source'] for row in telemetry] == ['EXPLICIT', 'TEMPORAL_FALLBACK']
    assert {row['operation_id'] for row in telemetry if row['association_source'] == 'EXPLICIT'} == {10}
    assert all(row['operation_id'] is None for row in telemetry if row['association_source'] == 'TEMPORAL_FALLBACK')
    assert len(telemetry) == 2

    locations = service.operation_locations(context, 10)
    assert [row['association_source'] for row in locations['locations']] == ['EXPLICIT', 'TEMPORAL_FALLBACK']
    assert {row['operation_id'] for row in locations['locations'] if row['association_source'] == 'EXPLICIT'} == {10}
    assert all(row['operation_id'] is None for row in locations['locations'] if row['association_source'] == 'TEMPORAL_FALLBACK')
    assert len(locations['locations']) == 2
