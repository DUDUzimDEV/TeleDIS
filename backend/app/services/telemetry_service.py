from datetime import datetime, timezone

from app.repositories.telemetry_repository import TelemetryRepository


class TelemetryService:
    def __init__(self, repository: TelemetryRepository | None = None):
        self.repository = repository or TelemetryRepository()

    def normalize_payload(self, payload: dict) -> dict:
        if payload is None:
            raise ValueError("Payload ausente")
        if not isinstance(payload, dict):
            raise ValueError("Payload deve ser um dicionário")

        normalized = dict(payload)
        if "maquina_id" not in normalized and "machine_id" in normalized:
            normalized["maquina_id"] = normalized["machine_id"]

        if "valor" not in normalized and "value" in normalized:
            normalized["valor"] = normalized["value"]

        if "timestamp" not in normalized and "recorded_at" in normalized:
            normalized["timestamp"] = normalized["recorded_at"]

        if "unidade" not in normalized and "unit" in normalized:
            normalized["unidade"] = normalized["unit"]

        if normalized.get("valor") is not None and isinstance(normalized["valor"], str):
            try:
                normalized["valor"] = float(normalized["valor"])
            except ValueError:
                pass

        if normalized.get("maquina_id") is not None and not isinstance(normalized["maquina_id"], int):
            try:
                normalized["maquina_id"] = int(normalized["maquina_id"])
            except (TypeError, ValueError):
                raise ValueError("maquina_id inválido")

        if normalized.get("valor") is None:
            raise ValueError("valor obrigatório")

        if "timestamp" not in normalized:
            normalized["timestamp"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        return normalized

    def validate_payload(self, payload: dict) -> bool:
        try:
            normalized = self.normalize_payload(payload)
        except ValueError:
            return False

        if not isinstance(normalized.get("maquina_id"), int) or normalized["maquina_id"] <= 0:
            return False

        if normalized.get("valor") is None:
            return False

        try:
            float(normalized["valor"])
        except (TypeError, ValueError):
            return False

        try:
            timestamp = str(normalized["timestamp"]).replace("Z", "+00:00")
            datetime.fromisoformat(timestamp)
        except ValueError:
            return False

        return True

    def process_measurement(self, payload: dict):
        normalized = self.normalize_payload(payload)
        if not self.validate_payload(normalized):
            raise ValueError("Payload inválido para telemetria")

        return self.repository.create_reading(normalized)
