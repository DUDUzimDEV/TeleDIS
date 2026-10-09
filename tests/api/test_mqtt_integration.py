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
            self.location = None

        def create_reading(self, payload):
            self.payload = payload
            return {
                "id": 42,
                "maquina_id": payload["maquina_id"],
                "metric": payload["metric"],
                "valor": payload["valor"],
            }

        def create_location(self, payload):
            self.location = payload
            return {
                "id": 7,
                "maquina_id": payload["maquina_id"],
                "timestamp": payload["timestamp"],
                "latitude": payload["latitude"],
                "longitude": payload["longitude"],
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


def test_mqtt_callback_routes_location_without_scalar_value():
    class RecordingRepository:
        def create_reading(self, payload):
            raise AssertionError("location must not be stored as a numeric reading")

        def create_location(self, payload):
            return {"id": 8, **payload}

    service = MqttService()
    service.telemetry_service = TelemetryService(RecordingRepository())
    raw_message = (
        '{"maquina_id":1,"timestamp":"2026-10-01T14:10:00Z",'
        '"latitude":-23.500467,"longitude":-47.452100}'
    )

    location = service.handle_message("teledis/maquina/1/localizacao", raw_message)

    assert location["latitude"] == -23.500467
    assert location["longitude"] == -47.4521
    assert "valor" not in location


def test_mqtt_subscribes_to_generic_numeric_metric_topics():
    topics = MqttService().subscribe_topics()

    assert "teledis/maquina/+/rpm" in topics
    assert "teledis/maquina/+/combustivel" in topics
    assert "teledis/maquina/+/horimetro" in topics
