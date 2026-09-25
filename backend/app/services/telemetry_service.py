from datetime import datetime


class TelemetryService:
    def validate_payload(self, payload: dict) -> bool:
        required_fields = {"maquina_id", "timestamp", "valor"}
        if not required_fields.issubset(payload):
            return False
        if isinstance(payload["maquina_id"], int) is False:
            return False
        if payload["valor"] is None:
            return False
        try:
            datetime.fromisoformat(str(payload["timestamp"]).replace("Z", "+00:00"))
        except ValueError:
            return False
        return True
