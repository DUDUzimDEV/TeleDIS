from datetime import datetime, timezone

import pytest

from simulator.simulator import (
    AgriculturalMachine,
    MachineReading,
    MqttPublisher,
    SimulatorConfig,
)


def test_config_reads_environment_and_defaults_to_windows_host():
    config = SimulatorConfig.from_environment(
        {
            "MQTT_USERNAME": "teledis",
            "MQTT_PASSWORD": "hidden",
            "SIMULATOR_INTERVAL": "3",
        }
    )

    assert config.mqtt_host == "localhost"
    assert config.machine_id == 1
    assert config.interval == 3
    assert config.mqtt_username == "teledis"


def test_config_rejects_invalid_interval():
    with pytest.raises(ValueError, match="SIMULATOR_INTERVAL"):
        SimulatorConfig.from_environment({"SIMULATOR_INTERVAL": "0"})


def test_readings_have_correlated_engine_values_and_progressive_gps():
    config = SimulatorConfig()
    machine = AgriculturalMachine(config)
    start = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)

    first = machine.next_reading(start)
    second = machine.next_reading(start)

    assert second.speed > first.speed
    assert second.rpm > first.rpm
    assert second.fuel < first.fuel
    assert second.latitude > first.latitude
    assert second.longitude > first.longitude
    assert first.timestamp == "2026-10-01T12:00:00Z"


def test_payload_topics_and_shapes_match_backend_contract():
    machine = AgriculturalMachine(SimulatorConfig())
    reading = machine.next_reading(datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc))
    payloads = machine.payloads(reading)

    assert set(payloads) == {
        "temperatura",
        "velocidade",
        "rpm",
        "combustivel",
        "horimetro",
        "localizacao",
    }
    for metric, payload in payloads.items():
        assert payload["maquina_id"] == 1
        assert payload["timestamp"] == "2026-10-01T12:00:00Z"
        if metric != "localizacao":
            assert isinstance(payload["valor"], (float, int))

    location = payloads["localizacao"]
    assert "valor" not in location
    assert location["latitude"] == reading.latitude
    assert location["longitude"] == reading.longitude


class FakePublishResult:
    rc = 0

    def wait_for_publish(self, timeout):
        return None

    def is_published(self):
        return True


class FakeMqttClient:
    def __init__(self):
        self.published = []

    def reconnect_delay_set(self, min_delay, max_delay):
        self.reconnect_delays = (min_delay, max_delay)

    def connect_async(self, host, port, keepalive):
        self.connection = (host, port, keepalive)

    def loop_start(self):
        self.loop_started = True

    def username_pw_set(self, username, password):
        self.credentials = (username, password)

    def is_connected(self):
        return True

    def publish(self, topic, payload, qos):
        self.published.append((topic, payload, qos))
        return FakePublishResult()


def test_publisher_sends_only_backend_subscribed_topics():
    client = FakeMqttClient()
    publisher = MqttPublisher(SimulatorConfig(), client=client)
    reading = MachineReading(
        timestamp="2026-10-01T12:00:00Z",
        temperature=82.0,
        speed=5.0,
        rpm=1675,
        fuel=74.7,
        latitude=-23.5012,
        longitude=-47.4521,
    )

    assert publisher.publish_reading(reading)
    assert [entry[0] for entry in client.published] == [
        "teledis/maquina/1/temperatura",
        "teledis/maquina/1/velocidade",
        "teledis/maquina/1/rpm",
        "teledis/maquina/1/combustivel",
        "teledis/maquina/1/horimetro",
        "teledis/maquina/1/localizacao",
    ]
    assert all(entry[2] == 1 for entry in client.published)


def test_publisher_connects_asynchronously_and_enables_reconnect():
    client = FakeMqttClient()
    publisher = MqttPublisher(SimulatorConfig(mqtt_host="localhost"), client=client)

    publisher.connect()

    assert client.connection == ("localhost", 1883, 60)
    assert client.reconnect_delays == (1, 30)
    assert client.loop_started is True