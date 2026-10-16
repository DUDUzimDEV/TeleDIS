import json
import logging
import math
import os
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import paho.mqtt.client as mqtt
from dotenv import dotenv_values


logger = logging.getLogger("teledis.simulator")
SIMULATED_DATA_SOURCE = "SIMULATED"
TIME_MULTIPLIERS = {1, 5, 10, 20, 50}


class LocationBoundaryValidator(Protocol):
    def validate_location(self, latitude: float, longitude: float) -> None:
        ...


@dataclass(frozen=True)
class SimulatorConfig:
    api_base_url: str = "http://localhost:8000"
    api_token: str = field(default="", repr=False)
    farm_id: int | None = None
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_username: str = ""
    mqtt_password: str = field(default="", repr=False)
    mqtt_client_id: str = "teledis-simulator-machine-1"
    machine_id: int = 1
    machine_name: str = "MF 4270"
    interval: float = 5.0
    time_multiplier: int = 1
    speed_kmh: float = 8.0

    @classmethod
    def from_environment(cls, environ: Mapping[str, str] | None = None):
        dotenv_config = {}
        if environ is None:
            dotenv_config = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
            environ = os.environ

        machine_id = int(environ.get("SIMULATOR_MACHINE_ID", "1"))
        farm_id_value = environ.get(
            "SIMULATOR_FARM_ID",
            dotenv_config.get("SIMULATOR_FARM_ID"),
        )
        config = cls(
            api_base_url=environ.get(
                "SIMULATOR_API_URL",
                dotenv_config.get("SIMULATOR_API_URL") or "http://localhost:8000",
            ).rstrip("/"),
            api_token=environ.get(
                "SIMULATOR_API_TOKEN",
                dotenv_config.get("SIMULATOR_API_TOKEN") or "",
            ),
            farm_id=int(farm_id_value) if farm_id_value else None,
            mqtt_host=environ.get("MQTT_HOST", "localhost"),
            mqtt_port=int(environ.get("MQTT_PORT", "1883")),
            mqtt_username=environ.get("MQTT_USERNAME", dotenv_config.get("MQTT_USERNAME") or ""),
            mqtt_password=environ.get("MQTT_PASSWORD", dotenv_config.get("MQTT_PASSWORD") or ""),
            mqtt_client_id=environ.get(
                "SIMULATOR_MQTT_CLIENT_ID",
                f"teledis-simulator-machine-{machine_id}",
            ),
            machine_id=machine_id,
            machine_name=environ.get("SIMULATOR_NAME", "MF 4270"),
            interval=float(environ.get("SIMULATOR_INTERVAL", "5")),
            time_multiplier=int(environ.get("SIMULATOR_TIME_MULTIPLIER", "1")),
            speed_kmh=float(environ.get("SIMULATOR_SPEED_KMH", "8")),
        )
        config.validate()
        return config

    def validate(self):
        if not self.mqtt_host.strip():
            raise ValueError("MQTT_HOST não pode ser vazio")
        if not self.api_base_url.strip():
            raise ValueError("SIMULATOR_API_URL não pode ser vazio")
        if self.farm_id is not None and self.farm_id <= 0:
            raise ValueError("SIMULATOR_FARM_ID deve ser maior que zero")
        if not 1 <= self.mqtt_port <= 65535:
            raise ValueError("MQTT_PORT deve estar entre 1 e 65535")
        if self.machine_id <= 0:
            raise ValueError("SIMULATOR_MACHINE_ID deve ser maior que zero")
        if self.interval <= 0:
            raise ValueError("SIMULATOR_INTERVAL deve ser maior que zero")
        if self.time_multiplier not in TIME_MULTIPLIERS:
            raise ValueError(
                "SIMULATOR_TIME_MULTIPLIER deve ser 1, 5, 10, 20 ou 50"
            )
        if not 0 < self.speed_kmh <= 40:
            raise ValueError("SIMULATOR_SPEED_KMH deve ser maior que zero e no máximo 40")


@dataclass(frozen=True)
class MachineReading:
    timestamp: str
    temperature: float
    speed: float
    rpm: int
    fuel: float
    latitude: float
    longitude: float
    engine_hours: float = 0.0
    source: str = SIMULATED_DATA_SOURCE


def build_payloads(machine_id: int, reading: MachineReading) -> dict[str, dict]:
    common = {
        "maquina_id": machine_id,
        "timestamp": reading.timestamp,
        "source": reading.source,
    }
    return {
        "temperatura": {
            **common,
            "valor": reading.temperature,
            "unidade": "C",
        },
        "velocidade": {
            **common,
            "valor": reading.speed,
            "unidade": "km/h",
        },
        "rpm": {
            **common,
            "valor": reading.rpm,
            "unidade": "rpm",
        },
        "combustivel": {
            **common,
            "valor": reading.fuel,
            "unidade": "%",
        },
        "horimetro": {
            **common,
            "valor": reading.engine_hours,
            "unidade": "h",
        },
        "localizacao": {
            **common,
            "latitude": reading.latitude,
            "longitude": reading.longitude,
        },
    }


class AgriculturalMachine:
    def __init__(self, config: SimulatorConfig):
        self.config = config
        self.latitude: float | None = None
        self.longitude: float | None = None
        self.speed = 0.0
        self.fuel = 74.8
        self.engine_hours = 0.0
        self.cycle = 0
        self.route_points: list[tuple[float, float]] = []
        self.route_index = 0
        self._moving = False

    @property
    def has_position(self) -> bool:
        return self.latitude is not None and self.longitude is not None

    @property
    def is_moving(self) -> bool:
        return self._moving

    def set_position(self, latitude: float, longitude: float):
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise ValueError("A posição inicial contém coordenadas inválidas.")
        self.latitude = float(latitude)
        self.longitude = float(longitude)

    def set_route(self, points: list[tuple[float, float]] | list[dict] | None, *, speed_kmh: float | None = None):
        if points is None:
            self.route_points = []
            self.route_index = 0
            self._moving = False
            self.speed = 0.0
            return
        normalized_points: list[tuple[float, float]] = []
        for point in points:
            if isinstance(point, dict):
                normalized_points.append((float(point["latitude"]), float(point["longitude"])))
            else:
                normalized_points.append((float(point[0]), float(point[1])))
        if len(normalized_points) < 2:
            self.set_route(None)
            return
        if not self.has_position:
            self.set_position(*normalized_points[0])
        current_position = (self.latitude, self.longitude)
        if self._haversine_distance_m(current_position, normalized_points[0]) > 0.5:
            normalized_points.insert(0, current_position)
        self.route_points = normalized_points
        self.route_index = 0
        self._moving = True
        self.speed = self.config.speed_kmh if speed_kmh is None else max(0.0, float(speed_kmh))
        if self.speed == 0:
            self.set_route(None)

    def _advance_along_route(self, elapsed_seconds: float) -> None:
        if not self.route_points or not self._moving:
            return
        remaining_m = self.speed * 1000 / 3600 * elapsed_seconds
        while self.route_index < len(self.route_points) - 1:
            start = (self.latitude, self.longitude)
            end = self.route_points[self.route_index + 1]
            distance_m = self._haversine_distance_m(start, end)
            if distance_m <= 0.01:
                self.route_index += 1
                continue
            if remaining_m < distance_m:
                fraction = remaining_m / distance_m
                self.latitude = start[0] + (end[0] - start[0]) * fraction
                self.longitude = start[1] + (end[1] - start[1]) * fraction
                return
            remaining_m -= distance_m
            self.route_index += 1
            self.latitude, self.longitude = end
        self.latitude, self.longitude = self.route_points[-1]
        self._moving = False
        self.speed = 0.0

    @staticmethod
    def _haversine_distance_m(start: tuple[float, float], end: tuple[float, float]) -> float:
        lat1, lon1 = map(math.radians, start)
        lat2, lon2 = map(math.radians, end)
        delta_lat = lat2 - lat1
        delta_lon = lon2 - lon1
        a = (
            math.sin(delta_lat / 2) ** 2
            + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
        )
        return 2 * 6371000 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def next_reading(self, now: datetime | None = None) -> MachineReading:
        if not self.has_position:
            raise RuntimeError("O simulador não possui uma posição operacional validada.")
        self.cycle += 1
        elapsed_seconds = self.config.interval * self.config.time_multiplier
        simulated_cycle = self.cycle * self.config.time_multiplier
        if self._moving:
            self.speed = self.config.speed_kmh

        rpm = round(950 + self.speed * 145)
        temperature = 74.0 + self.speed * 1.55 + 0.7 * math.sin(simulated_cycle / 5.0)
        fuel_used = (
            0.001 + 0.012 * (self.speed / 6.0) if self._moving else 0.001
        ) * self.config.time_multiplier
        self.fuel = max(0.0, self.fuel - fuel_used)
        self.engine_hours += elapsed_seconds / 3600

        if self._moving:
            self._advance_along_route(elapsed_seconds)

        timestamp = now or datetime.now(timezone.utc)
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)

        return MachineReading(
            timestamp=timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            temperature=round(temperature, 1),
            speed=round(self.speed, 1),
            rpm=rpm,
            fuel=round(self.fuel, 3),
            latitude=round(self.latitude, 6),
            longitude=round(self.longitude, 6),
            engine_hours=round(self.engine_hours, 4),
        )

    def payloads(self, reading: MachineReading) -> dict[str, dict]:
        return build_payloads(self.config.machine_id, reading)


class MqttPublisher:
    def __init__(
        self,
        config: SimulatorConfig,
        *,
        boundary_validator: LocationBoundaryValidator,
        client=None,
    ):
        self.config = config
        self.boundary_validator = boundary_validator
        self.client = client or mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=config.mqtt_client_id,
        )
        if config.mqtt_username:
            self.client.username_pw_set(config.mqtt_username, config.mqtt_password)

        self.client.reconnect_delay_set(min_delay=1, max_delay=30)
        self.client.on_connect = self._on_connect
        self.client.on_connect_fail = self._on_connect_fail
        self.client.on_disconnect = self._on_disconnect

    def connect(self):
        logger.info("Conectando ao MQTT %s:%s", self.config.mqtt_host, self.config.mqtt_port)
        self.client.connect_async(self.config.mqtt_host, self.config.mqtt_port, keepalive=60)
        self.client.loop_start()

    def publish_reading(self, reading: MachineReading) -> bool:
        self.boundary_validator.validate_location(reading.latitude, reading.longitude)
        if not self.client.is_connected():
            return False

        all_published = True
        payloads = build_payloads(self.config.machine_id, reading)

        for metric, payload in payloads.items():
            topic = f"teledis/maquina/{self.config.machine_id}/{metric}"
            result = self.client.publish(topic, json.dumps(payload), qos=1)
            if result.rc != mqtt.MQTT_ERR_SUCCESS:
                logger.error("Falha ao publicar em %s; aguardando reconexão", topic)
                all_published = False
                continue

            try:
                result.wait_for_publish(timeout=5)
            except (RuntimeError, ValueError) as exc:
                logger.error("Falha ao confirmar publicação em %s: %s", topic, exc)
                all_published = False
                continue

            if not result.is_published():
                logger.error("Publicação não confirmada em %s", topic)
                all_published = False

        return all_published

    def disconnect(self):
        self.client.disconnect()
        self.client.loop_stop()

    @staticmethod
    def _on_connect(client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            logger.error("Conexão MQTT recusada: %s; tentando novamente", reason_code)
            return
        logger.info("Conexão MQTT estabelecida")

    @staticmethod
    def _on_connect_fail(client, userdata):
        logger.warning("Tentativa MQTT falhou; aguardando próxima tentativa automática")

    @staticmethod
    def _on_disconnect(client, userdata, disconnect_flags, reason_code, properties):
        if reason_code.is_failure:
            logger.warning("Conexão MQTT perdida (%s); reconexão automática ativa", reason_code)
        else:
            logger.info("Desconectado do MQTT")


class SimulationRunStatus(str, Enum):
    STOPPED = "STOPPED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"


@dataclass(frozen=True)
class SimulationState:
    machine_id: int
    run_status: SimulationRunStatus
    time_multiplier: int

    @classmethod
    def initial(cls, config: SimulatorConfig):
        config.validate()
        return cls(
            machine_id=config.machine_id,
            run_status=SimulationRunStatus.STOPPED,
            time_multiplier=config.time_multiplier,
        )


class SimulationClock:
    def __init__(self, started_at: datetime):
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        self.current_time = started_at.astimezone(timezone.utc)

    def advance(self, elapsed_seconds: float) -> datetime:
        self.current_time += timedelta(seconds=elapsed_seconds)
        return self.current_time


def _route_points(route: dict | None) -> list[tuple[float, float]]:
    geometry = (route or {}).get("geometry")
    if isinstance(geometry, dict) and geometry.get("type") == "Feature":
        geometry = geometry.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
        raise SimulatorApiError("O contexto não contém uma rota LineString válida.")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        raise SimulatorApiError("A rota do contexto não contém coordenadas.")
    points = []
    for coordinate in coordinates:
        if not isinstance(coordinate, list) or len(coordinate) < 2:
            raise SimulatorApiError("A rota do contexto contém uma coordenada inválida.")
        longitude, latitude = float(coordinate[0]), float(coordinate[1])
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise SimulatorApiError("A rota do contexto contém coordenadas fora dos limites.")
        points.append((latitude, longitude))
    if len(points) < 2:
        raise SimulatorApiError("A rota do contexto precisa conter ao menos dois pontos.")
    return points


def _append_destination(points: list[tuple[float, float]], location: dict | None):
    if location is None:
        return points
    destination = (float(location["latitude"]), float(location["longitude"]))
    if AgriculturalMachine._haversine_distance_m(points[-1], destination) > 0.5:
        points.append(destination)
    return points


def _remaining_route(
    points: list[tuple[float, float]],
    current: tuple[float, float],
) -> list[tuple[float, float]]:
    best = None
    for index, (start, end) in enumerate(zip(points, points[1:])):
        latitude_scale = 111_320.0
        longitude_scale = latitude_scale * math.cos(math.radians(current[0]))
        start_x = start[1] * longitude_scale
        start_y = start[0] * latitude_scale
        end_x = end[1] * longitude_scale
        end_y = end[0] * latitude_scale
        current_x = current[1] * longitude_scale
        current_y = current[0] * latitude_scale
        delta_x = end_x - start_x
        delta_y = end_y - start_y
        length_squared = delta_x * delta_x + delta_y * delta_y
        fraction = 0.0 if length_squared == 0 else max(
            0.0,
            min(1.0, ((current_x - start_x) * delta_x + (current_y - start_y) * delta_y) / length_squared),
        )
        projected = (
            start[0] + (end[0] - start[0]) * fraction,
            start[1] + (end[1] - start[1]) * fraction,
        )
        distance = AgriculturalMachine._haversine_distance_m(current, projected)
        if best is None or distance < best[0]:
            best = (distance, index, fraction, projected)

    if best is None or best[0] > 100:
        raise SimulatorApiError("A posição atual não está próxima da rota operacional.")
    _, index, fraction, projected = best
    remaining = [current]
    if AgriculturalMachine._haversine_distance_m(current, projected) > 0.5:
        remaining.append(projected)
    if fraction < 1.0:
        remaining.append(points[index + 1])
    remaining.extend(points[index + 2 :])
    return [
        point for index, point in enumerate(remaining)
        if index == 0 or AgriculturalMachine._haversine_distance_m(remaining[index - 1], point) > 0.5
    ]


class SimulationEngine:
    def __init__(
        self,
        config: SimulatorConfig,
        machine: AgriculturalMachine,
        publisher: MqttPublisher,
    ):
        self.config = config
        self.machine = machine
        self.publisher = publisher
        self.state = SimulationState.initial(config)
        self.clock: SimulationClock | None = None
        self._lock_file = None
        self._route_context_key = None
        self.context_state = "STOPPED"

    def _acquire_machine_lock(self):
        if self._lock_file is not None:
            return
        lock_path = Path(tempfile.gettempdir()) / f"teledis-simulator-machine-{self.config.machine_id}.lock"
        self._lock_file = open(lock_path, "a+", encoding="utf-8")
        try:
            if os.fstat(self._lock_file.fileno()).st_size == 0:
                self._lock_file.write("0")
                self._lock_file.flush()
            self._lock_file.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(self._lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._lock_file.close()
            self._lock_file = None
            raise RuntimeError("Já existe uma simulação ativa para a máquina selecionada.")

    def _release_machine_lock(self):
        if self._lock_file is None:
            return
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(self._lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._lock_file.fileno(), fcntl.LOCK_UN)
        finally:
            self._lock_file.close()
            self._lock_file = None

    def start(self, started_at: datetime | None = None, *, route_points=None, speed_kmh: float | None = None):
        if self.state.run_status is SimulationRunStatus.RUNNING:
            raise RuntimeError("O simulador já está em execução.")
        if self.state.run_status is SimulationRunStatus.PAUSED:
            raise RuntimeError("O simulador está pausado; use resume() para continuar.")
        self._acquire_machine_lock()
        if route_points is not None:
            self.machine.set_route(route_points, speed_kmh=speed_kmh)
        self.clock = SimulationClock(started_at or datetime.now(timezone.utc))
        self.state = SimulationState(
            machine_id=self.config.machine_id,
            run_status=SimulationRunStatus.RUNNING,
            time_multiplier=self.config.time_multiplier,
        )

    def sync_context(self, context: dict) -> str:
        machine = context.get("machine") or {}
        farm = context.get("farm") or {}
        try:
            machine_id = int(machine["id"])
            machine_farm_id = int(machine["farm_id"])
            context_farm_id = int(farm["id"])
        except (KeyError, TypeError, ValueError) as exc:
            raise SimulatorApiError("O contexto não contém o escopo de máquina e fazenda.") from exc
        if (
            machine_id != self.config.machine_id
            or machine_farm_id != self.config.farm_id
            or context_farm_id != self.config.farm_id
        ):
            raise SimulatorApiError("O contexto retornado não pertence à máquina e fazenda configuradas.")

        if not self.machine.has_position:
            current_location = context.get("current_location")
            base_location = (context.get("base_structure") or {}).get("location")
            initial_location = current_location or base_location
            if initial_location is not None:
                self.machine.set_position(
                    float(initial_location["latitude"]),
                    float(initial_location["longitude"]),
                )

        self.context_state = str(context.get("simulator_state") or "ERROR")
        route = None
        route_key = None
        if self.context_state == "TRAVELING":
            route = context.get("planned_route")
            route_key = ("operation", (route or {}).get("id"))
        elif self.context_state == "RETURNING_TO_BASE":
            route = context.get("return_route")
            route_key = ("base", (context.get("base_structure") or {}).get("id"))

        if route is not None:
            if not self.machine.has_position:
                raise SimulatorApiError("Não há posição conhecida para iniciar a rota operacional.")
            points = _route_points(route)
            if self.context_state == "TRAVELING":
                points = _append_destination(points, (context.get("field") or {}).get("location"))
            elif self.context_state == "RETURNING_TO_BASE":
                points = _append_destination(points, (context.get("base_structure") or {}).get("location"))
            points = _remaining_route(
                points,
                (self.machine.latitude, self.machine.longitude),
            )
            if route_key != self._route_context_key:
                self.machine.set_route(points, speed_kmh=self.config.speed_kmh)
                self._route_context_key = route_key
        else:
            self.machine.set_route(None)
            self._route_context_key = None
        return self.context_state

    def pause(self):
        if self.state.run_status is not SimulationRunStatus.RUNNING or self.clock is None:
            raise RuntimeError("O simulador precisa estar em execução para pausar.")
        self.state = SimulationState(
            machine_id=self.config.machine_id,
            run_status=SimulationRunStatus.PAUSED,
            time_multiplier=self.config.time_multiplier,
        )

    def resume(self):
        if self.state.run_status is not SimulationRunStatus.PAUSED:
            raise RuntimeError("O simulador precisa estar pausado para retomar.")
        if self.clock is None:
            self.clock = SimulationClock(datetime.now(timezone.utc))
        self.state = SimulationState(
            machine_id=self.config.machine_id,
            run_status=SimulationRunStatus.RUNNING,
            time_multiplier=self.config.time_multiplier,
        )

    def step(self) -> tuple[MachineReading, bool]:
        if self.state.run_status is not SimulationRunStatus.RUNNING or self.clock is None:
            raise RuntimeError("O simulador precisa estar em execução para avançar.")
        simulated_interval = self.config.interval * self.config.time_multiplier
        reading = self.machine.next_reading(self.clock.advance(simulated_interval))
        return reading, self.publisher.publish_reading(reading)

    def stop(self):
        self.state = SimulationState(
            machine_id=self.config.machine_id,
            run_status=SimulationRunStatus.STOPPED,
            time_multiplier=self.config.time_multiplier,
        )
        self.clock = None
        self._release_machine_lock()


class SimulatorApiError(RuntimeError):
    pass


class TeleDisApiClient:
    def __init__(self, config: SimulatorConfig):
        self.config = config
        if not config.api_token.strip():
            raise SimulatorApiError("SIMULATOR_API_TOKEN é obrigatório para validar o contexto.")
        if config.farm_id is None:
            raise SimulatorApiError("SIMULATOR_FARM_ID é obrigatório para validar a fazenda ativa.")

    def resolve_context(self) -> dict:
        response = self._request(
            "GET",
            f"/api/v1/simulator/machines/{self.config.machine_id}/context",
        )
        context = response.get("data")
        if not isinstance(context, dict):
            raise SimulatorApiError("A API não retornou o contexto da máquina.")
        machine = context.get("machine")
        if (
            not isinstance(machine, dict)
            or machine.get("id") != self.config.machine_id
            or machine.get("farm_id") != self.config.farm_id
        ):
            raise SimulatorApiError(
                "A máquina não pertence à fazenda configurada para este simulador."
            )
        return context

    def validate_location(self, latitude: float, longitude: float):
        response = self._request(
            "POST",
            f"/api/v1/simulator/machines/{self.config.machine_id}/validate-location",
            {"latitude": latitude, "longitude": longitude},
        )
        result = response.get("data")
        if not isinstance(result, dict) or result.get("valid") is not True:
            raise SimulatorApiError("A API não confirmou a validade da posição simulada.")

    def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {
            "Authorization": f"Bearer {self.config.api_token}",
            "X-Farm-Id": str(self.config.farm_id),
            "Accept": "application/json",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(
            f"{self.config.api_base_url}{path}",
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            try:
                error_body = json.loads(exc.read().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                error_body = {}
            detail = (
                error_body.get("detail", "erro não detalhado pela API")
                if isinstance(error_body, dict)
                else "erro não detalhado pela API"
            )
            if isinstance(detail, dict):
                detail = detail.get("message", detail)
            raise SimulatorApiError(
                f"Validação da API falhou (HTTP {exc.code}): {detail}"
            ) from exc
        except URLError as exc:
            raise SimulatorApiError(f"Não foi possível validar com a API TeleDis: {exc.reason}") from exc
        if not isinstance(data, dict) or data.get("success") is not True:
            raise SimulatorApiError("A API TeleDis retornou uma resposta inválida.")
        return data


def display_reading(
    config: SimulatorConfig,
    reading: MachineReading,
    published: bool,
    simulator_state: str,
):
    state = "mensagens publicadas" if published else "aguardando/reconectando ao broker"
    print(
        f"[{datetime.now().strftime('%H:%M:%S')}] Máquina {config.machine_id} - {config.machine_name}\n"
        f"Estado operacional: {simulator_state}\n"
        f"Temperatura: {reading.temperature:.1f} °C\n"
        f"Velocidade: {reading.speed:.1f} km/h\n"
        f"RPM: {reading.rpm}\n"
        f"Combustível: {reading.fuel:.1f}%\n"
        f"Horímetro: {reading.engine_hours:.4f} h\n"
        f"GPS: {reading.latitude:.6f}, {reading.longitude:.6f}\n"
        f"Origem: DADO SIMULADO\n"
        f"MQTT: {state}\n",
        flush=True,
    )


def run():
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    config = SimulatorConfig.from_environment()
    api_client = TeleDisApiClient(config)
    context = api_client.resolve_context()
    logger.info(
        "Contexto validado: máquina=%s fazenda=%s estado=%s operação=%s",
        config.machine_id,
        config.farm_id,
        context["simulator_state"],
        context["operation_state"],
    )
    machine = AgriculturalMachine(config)
    publisher = MqttPublisher(config, boundary_validator=api_client)
    engine = SimulationEngine(config, machine, publisher)
    publisher.connect()
    engine.start()

    logger.info(
        "Simulador iniciado para máquina %s (%s), velocidade física %.1f km/h, "
        "intervalo %.1fs, fator de tempo %sx; pressione Ctrl+C para parar",
        config.machine_id,
        config.machine_name,
        config.speed_kmh,
        config.interval,
        config.time_multiplier,
    )
    last_logged_state = None
    try:
        while True:
            try:
                context = api_client.resolve_context()
                simulator_state = engine.sync_context(context)
                if not machine.has_position:
                    logger.warning(
                        "Nenhuma posição real ou base configurada para a máquina %s; "
                        "nenhuma coordenada será publicada.",
                        config.machine_id,
                    )
                    time.sleep(config.interval)
                    continue
                reading, published = engine.step()
            except SimulatorApiError as exc:
                logger.error("Simulador interrompido por erro de contexto/validação: %s", exc)
                break
            if simulator_state != last_logged_state:
                logger.info(
                    "Estado operacional atualizado: máquina=%s estado=%s motivo=%s",
                    config.machine_id,
                    simulator_state,
                    context.get("state_reason", "não informado"),
                )
                last_logged_state = simulator_state
            display_reading(config, reading, published, simulator_state)
            time.sleep(config.interval)
    except KeyboardInterrupt:
        logger.info("Encerrando simulador")
    finally:
        engine.stop()
        publisher.disconnect()


if __name__ == "__main__":
    run()