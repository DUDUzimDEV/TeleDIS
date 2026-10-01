from app.services.mqtt_service import MqttService
from app.services.telemetry_service import TelemetryService


def test_mqtt_service_parses_real_machine_topic_payload():
    service = MqttService()

    payload = service.parse_message(
        topic="teledis/maquina/1/temperatura",
        raw_message="90.2",
    )

    assert payload["maquina_id"] == 1
    assert payload["valor"] == 90.2
    assert payload["unidade"] == "C"
    assert payload["metric"] == "temperatura"


def test_mqtt_callback_validates_and_forwards_payload_to_repository():
    class RecordingRepository:
        def __init__(self):
            self.payload = None

        def create_reading(self, payload):
            self.payload = payload
            return {
                "id": 42,
                "maquina_id": payload["maquina_id"],
                "metric": payload["metric"],
                "valor": payload["valor"],
            }

    repository = RecordingRepository()
    service = MqttService()
    service.telemetry_service = TelemetryService(repository)

    record = service.handle_message(
        "teledis/maquina/1/temperatura",
        '{"maquina_id":1,"timestamp":"2026-10-01T11:00:00Z","valor":91.3,"unidade":"C"}',
    )

    assert record["id"] == 42
    assert repository.payload["maquina_id"] == 1
    assert repository.payload["valor"] == 91.3
