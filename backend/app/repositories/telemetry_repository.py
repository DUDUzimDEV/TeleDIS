from datetime import datetime, timezone

from app.database import SessionLocal
from app.models.machine import Machine
from app.models.telemetry import MeasurementType, TelemetryReading


class TelemetryRepository:
    def ensure_machine(self, machine_id: int) -> Machine:
        with SessionLocal() as db:
            machine = db.get(Machine, machine_id)
            if machine is not None:
                return machine

            machine = Machine(
                name=f"Máquina {machine_id}",
                code=f"M-{machine_id}",
                status="active",
            )
            db.add(machine)
            db.commit()
            db.refresh(machine)
            return machine

    def get_or_create_measurement(self, metric: str, unit: str) -> MeasurementType:
        metric_name = (metric or "temperatura").strip().lower()
        with SessionLocal() as db:
            measurement = db.query(MeasurementType).filter(MeasurementType.name == metric_name).first()
            if measurement is not None:
                return measurement

            measurement = MeasurementType(
                name=metric_name,
                unit=(unit or "C").strip() or "C",
                type_name=metric_name,
            )
            db.add(measurement)
            db.commit()
            db.refresh(measurement)
            return measurement

    def create_reading(self, payload: dict):
        machine_id = int(payload["maquina_id"])
        metric = str(payload.get("metric") or "temperatura").strip().lower()
        unit = str(payload.get("unidade") or payload.get("unit") or "C")
        value = float(payload["valor"])
        recorded_at = payload.get("timestamp")

        if recorded_at is not None:
            dt = str(recorded_at).replace("Z", "+00:00")
            parsed = datetime.fromisoformat(dt)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
        else:
            parsed = datetime.now(timezone.utc)

        with SessionLocal() as db:
            machine = self.ensure_machine(machine_id)
            measurement = self.get_or_create_measurement(metric, unit)

            reading = TelemetryReading(
                machine_id=machine.id,
                measurement_type_id=measurement.id,
                recorded_at=parsed,
                value=value,
            )
            db.add(reading)
            db.commit()
            db.refresh(reading)

            return {
                "id": reading.id,
                "maquina_id": reading.machine_id,
                "metric": measurement.name,
                "valor": reading.value,
                "unidade": measurement.unit,
                "timestamp": reading.recorded_at.isoformat().replace("+00:00", "Z"),
            }

    def list_recent(self, machine_id: int | None = None):
        with SessionLocal() as db:
            query = db.query(TelemetryReading, MeasurementType).join(
                MeasurementType,
                TelemetryReading.measurement_type_id == MeasurementType.id,
            )

            if machine_id is not None:
                query = query.filter(TelemetryReading.machine_id == machine_id)

            rows = query.order_by(TelemetryReading.recorded_at.desc()).limit(20).all()
            return [
                {
                    "id": reading.id,
                    "maquina_id": reading.machine_id,
                    "metric": measurement.name,
                    "valor": reading.value,
                    "unidade": measurement.unit,
                    "timestamp": reading.recorded_at.isoformat().replace("+00:00", "Z"),
                }
                for reading, measurement in rows
            ]
