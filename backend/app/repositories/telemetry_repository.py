from datetime import datetime, timezone

from app.config import get_settings
from app.database import SessionLocal
from app.models.machine import Machine
from app.models.telemetry import MachineLocation, MeasurementType, TelemetryReading
from app.models.user import Farm


class TelemetryRepository:
    @staticmethod
    def _ensure_machine(db, machine_id: int) -> Machine:
        machine = db.get(Machine, machine_id)
        if machine is not None:
            return machine

        settings = get_settings()
        farm = db.query(Farm).filter(Farm.code == settings.initial_farm_code).one_or_none()
        if farm is None:
            raise RuntimeError("Não há fazenda inicial configurada para associar a máquina recebida.")
        machine = Machine(
            name=f"Máquina {machine_id}",
            code=f"M-{machine_id}",
            status="active",
            farm_id=farm.id,
        )
        db.add(machine)
        db.flush()
        return machine

    @staticmethod
    def _get_or_create_measurement(db, metric: str, unit: str) -> MeasurementType:
        metric_name = (metric or "temperatura").strip().lower()
        measurement = db.query(MeasurementType).filter(MeasurementType.name == metric_name).first()
        if measurement is not None:
            return measurement

        measurement = MeasurementType(
            name=metric_name,
            unit=(unit or "C").strip() or "C",
            type_name=metric_name,
        )
        db.add(measurement)
        db.flush()
        return measurement

    @staticmethod
    def _parse_timestamp(value: str | datetime | None) -> datetime:
        if value is None:
            return datetime.now(timezone.utc)
        if isinstance(value, datetime):
            parsed = value
        else:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed

    @staticmethod
    def _timestamp_string(value: datetime) -> str:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    def ensure_machine(self, machine_id: int) -> Machine:
        with SessionLocal() as db:
            machine = self._ensure_machine(db, machine_id)
            db.commit()
            db.refresh(machine)
            return machine

    def get_or_create_measurement(self, metric: str, unit: str) -> MeasurementType:
        with SessionLocal() as db:
            measurement = self._get_or_create_measurement(db, metric, unit)
            db.commit()
            db.refresh(measurement)
            return measurement

    def create_reading(self, payload: dict):
        machine_id = int(payload["maquina_id"])
        metric = str(payload.get("metric") or "temperatura").strip().lower()
        unit = str(payload.get("unidade") or payload.get("unit") or "C")
        value = float(payload["valor"])
        parsed = self._parse_timestamp(payload.get("timestamp"))

        with SessionLocal() as db:
            machine = self._ensure_machine(db, machine_id)
            measurement = self._get_or_create_measurement(db, metric, unit)

            reading = TelemetryReading(
                machine_id=machine.id,
                measurement_type_id=measurement.id,
                recorded_at=parsed,
                value=value,
                farm_id=machine.farm_id,
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
                "timestamp": self._timestamp_string(reading.recorded_at),
            }

    def create_location(self, payload: dict):
        machine_id = int(payload["maquina_id"])
        recorded_at = self._parse_timestamp(payload["timestamp"])

        with SessionLocal() as db:
            machine = self._ensure_machine(db, machine_id)
            location = MachineLocation(
                machine_id=machine.id,
                recorded_at=recorded_at,
                latitude=float(payload["latitude"]),
                longitude=float(payload["longitude"]),
                farm_id=machine.farm_id,
            )
            db.add(location)
            db.commit()
            db.refresh(location)

            return {
                "id": location.id,
                "maquina_id": location.machine_id,
                "timestamp": self._timestamp_string(location.recorded_at),
                "latitude": location.latitude,
                "longitude": location.longitude,
            }

    def list_recent(
        self,
        machine_id: int | None = None,
        farm_id: int | None = None,
        limit: int = 20,
    ):
        with SessionLocal() as db:
            query = db.query(TelemetryReading, MeasurementType).join(
                MeasurementType,
                TelemetryReading.measurement_type_id == MeasurementType.id,
            ).join(Machine, Machine.id == TelemetryReading.machine_id)

            if machine_id is not None:
                query = query.filter(TelemetryReading.machine_id == machine_id)
            if farm_id is not None:
                query = query.filter(Machine.farm_id == farm_id)

            rows = query.order_by(TelemetryReading.recorded_at.desc()).limit(limit).all()
            return [
                {
                    "id": reading.id,
                    "maquina_id": reading.machine_id,
                    "metric": measurement.name,
                    "valor": reading.value,
                    "unidade": measurement.unit,
                    "timestamp": self._timestamp_string(reading.recorded_at),
                }
                for reading, measurement in rows
            ]

    def list_locations(self, machine_id: int | None = None, limit: int = 100, farm_id: int | None = None):
        with SessionLocal() as db:
            query = db.query(MachineLocation).join(Machine, Machine.id == MachineLocation.machine_id)
            if machine_id is not None:
                query = query.filter(MachineLocation.machine_id == machine_id)
            if farm_id is not None:
                query = query.filter(Machine.farm_id == farm_id)

            rows = query.order_by(MachineLocation.recorded_at.desc(), MachineLocation.id.desc()).limit(limit).all()
            return [
                {
                    "id": location.id,
                    "maquina_id": location.machine_id,
                    "timestamp": self._timestamp_string(location.recorded_at),
                    "latitude": location.latitude,
                    "longitude": location.longitude,
                }
                for location in rows
            ]
