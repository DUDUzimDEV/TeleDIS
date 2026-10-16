from datetime import datetime, timedelta, timezone
import json

import pytest

import simulator.simulator as simulator_module
from simulator.simulator import (
    AgriculturalMachine,
    MachineReading,
    MqttPublisher,
    SimulatorApiError,
    SimulationEngine,
    SimulationRunStatus,
    SimulationState,
    SimulatorConfig,
    TeleDisApiClient,
)


def test_config_reads_environment_and_defaults_to_windows_host():
    config = SimulatorConfig.from_environment(
        {
            "MQTT_USERNAME": "teledis",
            "MQTT_PASSWORD": "hidden",
            "SIMULATOR_INTERVAL": "3",
            "SIMULATOR_TIME_MULTIPLIER": "5",
            "SIMULATOR_MACHINE_ID": "7",
            "SIMULATOR_API_TOKEN": "jwt",
            "SIMULATOR_FARM_ID": "3",
        }
    )

    assert config.mqtt_host == "localhost"
    assert config.machine_id == 7
    assert config.mqtt_client_id == "teledis-simulator-machine-7"
    assert config.interval == 3
    assert config.time_multiplier == 5
    assert config.farm_id == 3
    assert config.mqtt_username == "teledis"


def test_config_rejects_invalid_interval():
    with pytest.raises(ValueError, match="SIMULATOR_INTERVAL"):
        SimulatorConfig.from_environment({"SIMULATOR_INTERVAL": "0"})


def test_config_rejects_unsupported_time_multiplier():
    with pytest.raises(ValueError, match="SIMULATOR_TIME_MULTIPLIER"):
        SimulatorConfig.from_environment({"SIMULATOR_TIME_MULTIPLIER": "3"})


def test_config_rejects_non_positive_machine_id():
    with pytest.raises(ValueError, match="SIMULATOR_MACHINE_ID"):
        SimulatorConfig.from_environment({"SIMULATOR_MACHINE_ID": "0"})


def test_api_client_requires_credentials_and_active_farm():
    with pytest.raises(SimulatorApiError, match="SIMULATOR_API_TOKEN"):
        TeleDisApiClient(SimulatorConfig())
    with pytest.raises(SimulatorApiError, match="SIMULATOR_FARM_ID"):
        TeleDisApiClient(SimulatorConfig(api_token="jwt"))


def test_api_client_sends_jwt_and_farm_scope_to_resolve_machine_context(monkeypatch):
    requests = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return json.dumps({
                "success": True,
                "data": {
                    "machine": {"id": 7, "farm_id": 3},
                    "simulator_state": "WAITING_OPERATION",
                },
            }).encode("utf-8")

    def open_request(request, timeout):
        requests.append(request)
        assert timeout == 5
        return Response()

    monkeypatch.setattr(simulator_module, "urlopen", open_request)
    client = TeleDisApiClient(SimulatorConfig(
        api_token="jwt-token",
        farm_id=3,
        machine_id=7,
    ))

    context = client.resolve_context()

    assert context["machine"] == {"id": 7, "farm_id": 3}
    assert requests[0].get_header("Authorization") == "Bearer jwt-token"
    assert requests[0].get_header("X-farm-id") == "3"
    assert requests[0].full_url.endswith("/api/v1/simulator/machines/7/context")


def test_api_client_rejects_machine_context_from_another_farm(monkeypatch):
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return b'{"success":true,"data":{"machine":{"id":7,"farm_id":4}}}'

    monkeypatch.setattr(simulator_module, "urlopen", lambda *args, **kwargs: Response())
    client = TeleDisApiClient(SimulatorConfig(
        api_token="jwt-token",
        farm_id=3,
        machine_id=7,
    ))

    with pytest.raises(SimulatorApiError, match="não pertence à fazenda"):
        client.resolve_context()


def test_machine_without_operation_stays_at_its_validated_position():
    config = SimulatorConfig()
    machine = AgriculturalMachine(config)
    start = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    machine.set_position(-23.5012, -47.4521)

    first = machine.next_reading(start)
    second = machine.next_reading(start + timedelta(seconds=5))

    assert first.speed == second.speed == 0
    assert first.rpm == second.rpm == 950
    assert second.fuel < first.fuel
    assert (second.latitude, second.longitude) == (first.latitude, first.longitude)
    assert first.timestamp == "2026-10-01T12:00:00Z"


def test_machine_requires_a_context_position_before_producing_gps():
    with pytest.raises(RuntimeError, match="posição operacional validada"):
        AgriculturalMachine(SimulatorConfig()).next_reading()


def test_machine_moves_continuously_at_configured_physical_speed_on_route():
    config = SimulatorConfig(interval=1, speed_kmh=8)
    machine = AgriculturalMachine(config)
    machine.set_position(-23.5012, -47.4521)
    machine.set_route([
        (-23.5012, -47.4521),
        (-23.4982, -47.4521),
    ])
    start = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)

    first = machine.next_reading(start)
    second = machine.next_reading(start + timedelta(seconds=1))

    assert first.speed == second.speed == 8
    assert first.rpm == second.rpm == round(950 + 8 * 145)
    assert first.latitude < second.latitude < -23.4982
    assert first.longitude == second.longitude == -47.4521
    assert second.fuel < first.fuel


def test_payload_topics_and_shapes_match_backend_contract():
    machine = AgriculturalMachine(SimulatorConfig())
    machine.set_position(-23.5012, -47.4521)
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
        assert payload["source"] == "SIMULATED"
        if metric != "localizacao":
            assert isinstance(payload["valor"], (float, int))

    location = payloads["localizacao"]
    assert "valor" not in location
    assert location["latitude"] == reading.latitude
    assert location["longitude"] == reading.longitude
    assert location["source"] == "SIMULATED"


def test_simulation_engine_starts_stopped_and_advances_simulated_time():
    class RecordingPublisher:
        def publish_reading(self, reading):
            self.reading = reading
            return True

    config = SimulatorConfig(interval=5, time_multiplier=10)
    machine = AgriculturalMachine(config)
    machine.set_position(-23.5012, -47.4521)
    publisher = RecordingPublisher()
    engine = SimulationEngine(config, machine, publisher)
    start = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)

    assert SimulationState.initial(config).run_status is SimulationRunStatus.STOPPED
    with pytest.raises(RuntimeError, match="precisa estar em execução"):
        engine.step()

    engine.start(start)
    reading, published = engine.step()

    assert engine.state.run_status is SimulationRunStatus.RUNNING
    assert reading.timestamp == "2026-10-01T12:00:50Z"
    assert machine.engine_hours == pytest.approx(50 / 3600)
    assert publisher.reading == reading
    assert published is True

    engine.stop()
    assert engine.state.run_status is SimulationRunStatus.STOPPED


def test_simulation_engine_supports_pause_resume_and_route_traversal():
    class RecordingPublisher:
        def publish_reading(self, reading):
            self.reading = reading
            return True

    config = SimulatorConfig(interval=1, time_multiplier=1)
    machine = AgriculturalMachine(config)
    publisher = RecordingPublisher()
    engine = SimulationEngine(config, machine, publisher)
    start = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    route = [
        (-23.501200, -47.452100),
        (-23.500900, -47.451800),
        (-23.500600, -47.451400),
    ]

    engine.start(start, route_points=route, speed_kmh=12)
    assert engine.state.run_status is SimulationRunStatus.RUNNING
    engine.pause()
    assert engine.state.run_status is SimulationRunStatus.PAUSED
    with pytest.raises(RuntimeError, match="precisa estar em execução"):
        engine.step()

    engine.resume()
    reading, published = engine.step()
    assert engine.state.run_status is SimulationRunStatus.RUNNING
    assert reading.latitude != route[0][0]
    assert published is True
    assert machine.latitude != route[0][0]

    engine.stop()
    assert engine.state.run_status is SimulationRunStatus.STOPPED


def test_context_controls_idle_travel_interruption_and_return_to_base():
    class RecordingPublisher:
        def publish_reading(self, reading):
            self.reading = reading
            return True

    config = SimulatorConfig(machine_id=7, farm_id=3, interval=1, time_multiplier=1, speed_kmh=8)
    machine = AgriculturalMachine(config)
    engine = SimulationEngine(config, machine, RecordingPublisher())
    engine.start(datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc))
    origin = {"latitude": -23.5012, "longitude": -47.4521}
    destination = {"latitude": -23.4982, "longitude": -47.4521}
    route = {
        "id": 12,
        "geometry": {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [-47.4521, -23.5012],
                    [-47.4521, -23.4982],
                ],
            },
        },
    }
    context = {
        "machine": {"id": 7, "farm_id": 3},
        "farm": {"id": 3},
        "simulator_state": "AT_BASE",
        "current_location": origin,
        "base_structure": {"id": 9, "location": origin},
    }

    assert engine.sync_context(context) == "AT_BASE"
    idle_reading, _ = engine.step()
    assert idle_reading.speed == 0
    assert (idle_reading.latitude, idle_reading.longitude) == (-23.5012, -47.4521)

    context.update(
        simulator_state="TRAVELING",
        operation_state="EM_EXECUCAO",
        planned_route=route,
        field={"location": destination},
    )
    assert engine.sync_context(context) == "TRAVELING"
    moving_reading, _ = engine.step()
    assert moving_reading.speed == 8
    assert -23.5012 < moving_reading.latitude < -23.4982

    context.update(simulator_state="PAUSED", operation_state="INTERROMPIDA")
    assert engine.sync_context(context) == "PAUSED"
    interrupted_reading, _ = engine.step()
    assert interrupted_reading.speed == 0
    assert (interrupted_reading.latitude, interrupted_reading.longitude) == (
        moving_reading.latitude,
        moving_reading.longitude,
    )

    return_route = {
        "id": None,
        "geometry": {
            "type": "LineString",
            "coordinates": [
                [-47.4521, moving_reading.latitude],
                [-47.4521, -23.5012],
            ],
        },
    }
    context.update(
        simulator_state="RETURNING_TO_BASE",
        operation_state="CONCLUIDA",
        return_route=return_route,
    )
    assert engine.sync_context(context) == "RETURNING_TO_BASE"
    returning_reading, _ = engine.step()
    assert returning_reading.latitude < moving_reading.latitude
    assert returning_reading.latitude >= -23.5012
    engine.stop()


def test_context_without_base_or_position_never_invents_a_gps_position():
    config = SimulatorConfig(machine_id=8, farm_id=3)
    machine = AgriculturalMachine(config)
    engine = SimulationEngine(config, machine, publisher=object())
    engine.start()

    state = engine.sync_context({
        "machine": {"id": 8, "farm_id": 3},
        "farm": {"id": 3},
        "simulator_state": "NO_BASE_CONFIGURED",
        "current_location": None,
        "base_structure": None,
    })

    assert state == "NO_BASE_CONFIGURED"
    assert not machine.has_position
    engine.stop()


def test_context_rejects_another_farms_machine():
    config = SimulatorConfig(machine_id=9, farm_id=3)
    engine = SimulationEngine(config, AgriculturalMachine(config), publisher=object())
    with pytest.raises(SimulatorApiError, match="não pertence"):
        engine.sync_context({
            "machine": {"id": 9, "farm_id": 999},
            "farm": {"id": 999},
            "simulator_state": "AT_BASE",
        })


def test_simulation_engine_blocks_simultaneous_runs_for_same_machine():
    class RecordingPublisher:
        def publish_reading(self, reading):
            return True

    config = SimulatorConfig(interval=1, time_multiplier=1)
    first = SimulationEngine(config, AgriculturalMachine(config), RecordingPublisher())
    second = SimulationEngine(config, AgriculturalMachine(config), RecordingPublisher())
    route = [
        (-23.501200, -47.452100),
        (-23.500900, -47.451800),
        (-23.500600, -47.451400),
    ]

    first.start(datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc), route_points=route, speed_kmh=12)
    with pytest.raises(RuntimeError, match="Já existe uma simulação ativa"):
        second.start(datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc), route_points=route, speed_kmh=12)

    first.stop()
    other_machine = SimulationEngine(
        SimulatorConfig(machine_id=2),
        AgriculturalMachine(SimulatorConfig(machine_id=2)),
        RecordingPublisher(),
    )
    other_machine.start(datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc))
    other_machine.stop()


def test_time_multiplier_scales_fuel_consumption_with_simulated_time():
    normal = AgriculturalMachine(SimulatorConfig(time_multiplier=1))
    accelerated = AgriculturalMachine(SimulatorConfig(time_multiplier=5))
    normal.set_position(-23.5012, -47.4521)
    accelerated.set_position(-23.5012, -47.4521)
    start = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)

    normal_reading = normal.next_reading(start)
    accelerated_reading = accelerated.next_reading(start)

    assert 74.8 - accelerated_reading.fuel > 74.8 - normal_reading.fuel


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


class AcceptingBoundaryValidator:
    def __init__(self):
        self.validated = []

    def validate_location(self, latitude, longitude):
        self.validated.append((latitude, longitude))


def test_publisher_sends_only_backend_subscribed_topics():
    client = FakeMqttClient()
    boundary_validator = AcceptingBoundaryValidator()
    publisher = MqttPublisher(
        SimulatorConfig(),
        client=client,
        boundary_validator=boundary_validator,
    )
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
    assert boundary_validator.validated == [(-23.5012, -47.4521)]


def test_publisher_rejects_location_before_publishing_any_metric():
    class RejectingBoundaryValidator:
        def validate_location(self, latitude, longitude):
            raise SimulatorApiError("fora da área operacional")

    client = FakeMqttClient()
    publisher = MqttPublisher(
        SimulatorConfig(),
        client=client,
        boundary_validator=RejectingBoundaryValidator(),
    )
    reading = MachineReading(
        timestamp="2026-10-01T12:00:00Z",
        temperature=82.0,
        speed=5.0,
        rpm=1675,
        fuel=74.7,
        latitude=-23.5012,
        longitude=-47.4521,
    )

    with pytest.raises(SimulatorApiError, match="fora da área"):
        publisher.publish_reading(reading)

    assert client.published == []


def test_publisher_connects_asynchronously_and_enables_reconnect():
    client = FakeMqttClient()
    publisher = MqttPublisher(
        SimulatorConfig(mqtt_host="localhost"),
        client=client,
        boundary_validator=AcceptingBoundaryValidator(),
    )

    publisher.connect()

    assert client.connection == ("localhost", 1883, 60)
    assert client.reconnect_delays == (1, 30)
    assert client.loop_started is True