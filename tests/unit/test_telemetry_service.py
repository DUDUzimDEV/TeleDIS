import pytest

from app.services.telemetry_service import TelemetryService


class RecordingRepository:
    def __init__(self):
        self.readings = []
        self.locations = []

    def create_reading(self, payload):
        self.readings.append(payload)
        return payload

    def create_location(self, payload):
        self.locations.append(payload)
        return payload


def test_location_payload_keeps_both_coordinates_and_timestamp():
    repository = RecordingRepository()
    service = TelemetryService(repository)
    payload = {
        "maquina_id": 1,
        "timestamp": "2026-10-01T14:10:00Z",
        "latitude": -23.500467,
        "longitude": -47.4521,
    }

    saved = service.process_location(payload)

    assert saved["latitude"] == -23.500467
    assert saved["longitude"] == -47.4521
    assert saved["timestamp"] == "2026-10-01T14:10:00Z"
    assert "valor" not in saved
    assert repository.locations == [payload]
    assert repository.readings == []


@pytest.mark.parametrize(
    ("metric", "value", "unit"),
    [
        ("temperatura", 88.4, "C"),
        ("velocidade", 8.4, "km/h"),
        ("rpm", 1840, "rpm"),
        ("combustivel", 74.8, "%"),
        ("horimetro", 123.5, "h"),
    ],
)
def test_numeric_metrics_share_generic_reading_storage(metric, value, unit):
    repository = RecordingRepository()
    service = TelemetryService(repository)
    payload = {
        "maquina_id": 1,
        "timestamp": "2026-10-01T14:10:00Z",
        "metric": metric,
        "valor": value,
        "unidade": unit,
    }

    service.process_measurement(payload)

    assert repository.readings[0]["metric"] == metric
    assert repository.readings[0]["valor"] == value


@pytest.mark.parametrize(
    "payload",
    [
        {"maquina_id": 1, "timestamp": "2026-10-01T14:10:00Z", "latitude": 91, "longitude": 0},
        {"maquina_id": 1, "timestamp": "bad", "latitude": 0, "longitude": 0},
        {"maquina_id": 1, "timestamp": "2026-10-01T14:10:00Z", "latitude": 0},
    ],
)
def test_invalid_location_payload_is_rejected(payload):
    service = TelemetryService(RecordingRepository())

    assert not service.validate_location_payload(payload)