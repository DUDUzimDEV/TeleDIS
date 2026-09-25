import json

from app.config import get_settings

settings = get_settings()


class MqttClient:
    def __init__(self):
        self.host = settings.mqtt_host
        self.port = settings.mqtt_port
        self.client_id = settings.mqtt_client_id

    def build_topic(self, machine_id: int, metric: str) -> str:
        return f"teledis/maquina/{machine_id}/{metric}"

    def parse_payload(self, raw_message: str) -> dict:
        return json.loads(raw_message)
