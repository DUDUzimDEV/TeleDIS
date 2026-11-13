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
ACTIVE_OP_STATUSES = {"ATRIBUIDA", "ACEITA", "EM_EXECUCAO", "INTERROMPIDA"}


class LocationBoundaryValidator(Protocol):
    def validate_location(self, latitude: float, longitude: float) -> None:
        ...


def _parse_bool(value: str | bool | None, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"0", "false", "no", "nao", "off", ""}


def _parse_iso_datetime(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def point_in_polygon(lat: float, lng: float, ring: list[list[float]] | list[tuple[float, float]]) -> bool:
    """Pure-Python ray-casting point-in-polygon for GeoJSON [lng, lat] rings."""
    if not ring or len(ring) < 3:
        return False
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = float(ring[i][0]), float(ring[i][1])
        xj, yj = float(ring[j][0]), float(ring[j][1])
        # Check if point is on horizontal span of edge
        if ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) if (yj - yi) != 0 else 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def point_in_geojson_polygon(lat: float, lng: float, geometry: dict | None) -> bool:
    """Checks whether (lat, lng) is inside a GeoJSON Polygon, MultiPolygon, or Feature."""
    if not isinstance(geometry, dict):
        return False
    if geometry.get("type") == "Feature":
        geometry = geometry.get("geometry")
    if not isinstance(geometry, dict):
        return False
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if not isinstance(coords, list):
        return False
    if geom_type == "Polygon":
        if not coords or not point_in_polygon(lat, lng, coords[0]):
            return False
        for hole in coords[1:]:
            if point_in_polygon(lat, lng, hole):
                return False
        return True
    if geom_type == "MultiPolygon":
        for poly in coords:
            if isinstance(poly, list) and poly and point_in_polygon(lat, lng, poly[0]):
                if not any(point_in_polygon(lat, lng, hole) for hole in poly[1:]):
                    return True
        return False
    return False


def generate_field_work_path(
    geometry: dict | None,
    *,
    start_point: tuple[float, float] | None = None,
    num_swaths: int = 6,
) -> list[tuple[float, float]]:
    """Generates back-and-forth parallel work swaths strictly inside a field polygon."""
    if not isinstance(geometry, dict):
        return []
    geom = geometry.get("geometry") if geometry.get("type") == "Feature" else geometry
    if not isinstance(geom, dict):
        return []
    geom_type = geom.get("type")
    coords = geom.get("coordinates")
    if not isinstance(coords, list) or not coords:
        return []

    rings: list[list] = []
    if geom_type == "Polygon":
        rings = [coords[0]]
    elif geom_type == "MultiPolygon":
        rings = [poly[0] for poly in coords if isinstance(poly, list) and poly]
    else:
        return []

    outer = rings[0]
    if len(outer) < 3:
        return []

    lngs = [float(pt[0]) for pt in outer]
    lats = [float(pt[1]) for pt in outer]
    min_lat, max_lat = min(lats), max(lats)
    if max_lat - min_lat <= 1e-8:
        return []

    waypoints: list[tuple[float, float]] = []
    if start_point is not None and point_in_geojson_polygon(start_point[0], start_point[1], geom):
        waypoints.append((float(start_point[0]), float(start_point[1])))

    swath_count = max(2, int(num_swaths))
    for step in range(swath_count):
        fraction = (step + 0.5) / swath_count
        scan_lat = min_lat + (max_lat - min_lat) * fraction
        intersections: list[float] = []
        for ring in rings:
            n = len(ring)
            for idx in range(n):
                x1, y1 = float(ring[idx][0]), float(ring[idx][1])
                x2, y2 = float(ring[(idx + 1) % n][0]), float(ring[(idx + 1) % n][1])
                if (y1 <= scan_lat < y2) or (y2 <= scan_lat < y1):
                    x_int = x1 + (scan_lat - y1) * (x2 - x1) / (y2 - y1)
                    intersections.append(x_int)
        intersections.sort()
        if len(intersections) < 2:
            continue
        # Pair entry/exit intersections and inset slightly so points lie strictly inside
        pairs = list(zip(intersections[0::2], intersections[1::2]))
        if step % 2 == 1:
            pairs = list(reversed(pairs))
        for left_lng, right_lng in pairs:
            span = right_lng - left_lng
            if span <= 1e-8:
                continue
            inset = span * 0.05
            p_a = (scan_lat, left_lng + inset)
            p_b = (scan_lat, right_lng - inset)
            ordered = (p_a, p_b) if step % 2 == 0 else (p_b, p_a)
            for cand in ordered:
                if point_in_geojson_polygon(cand[0], cand[1], geom):
                    if not waypoints or AgriculturalMachine._haversine_distance_m(waypoints[-1], cand) > 0.5:
                        waypoints.append(cand)

    return waypoints


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
    all_machines: bool = False
    machine_name: str = "MF 4270"
    interval: float = 5.0
    time_multiplier: int = 1
    speed_kmh: float = 8.0
    auto_operate: bool = True
    work_duration_seconds: float = 75.0
    fleet_refresh_interval: float = 30.0

    @classmethod
    def from_environment(cls, environ: Mapping[str, str] | None = None):
        dotenv_config = {}
        if environ is None:
            dotenv_config = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
            environ = os.environ

        raw_machine_id = str(
            environ.get("SIMULATOR_MACHINE_ID", dotenv_config.get("SIMULATOR_MACHINE_ID", "ALL")) or "ALL"
        ).strip()
        if raw_machine_id.upper() == "ALL":
            all_machines = True
            machine_id = 1
        else:
            all_machines = False
            machine_id = int(raw_machine_id)

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
            mqtt_host=environ.get("MQTT_HOST", dotenv_config.get("MQTT_HOST") or "localhost"),
            mqtt_port=int(environ.get("MQTT_PORT", dotenv_config.get("MQTT_PORT") or "1883")),
            mqtt_username=environ.get("MQTT_USERNAME", dotenv_config.get("MQTT_USERNAME") or ""),
            mqtt_password=environ.get("MQTT_PASSWORD", dotenv_config.get("MQTT_PASSWORD") or ""),
            mqtt_client_id=environ.get(
                "SIMULATOR_MQTT_CLIENT_ID",
                "teledis-simulator-fleet" if all_machines else f"teledis-simulator-machine-{machine_id}",
            ),
            machine_id=machine_id,
            all_machines=all_machines,
            machine_name=environ.get("SIMULATOR_NAME", "MF 4270"),
            interval=float(environ.get("SIMULATOR_INTERVAL", "5")),
            time_multiplier=int(environ.get("SIMULATOR_TIME_MULTIPLIER", "1")),
            speed_kmh=float(environ.get("SIMULATOR_SPEED_KMH", "8")),
            auto_operate=_parse_bool(environ.get("SIMULATOR_AUTO_OPERATE", "true"), default=True),
            work_duration_seconds=float(environ.get("SIMULATOR_WORK_DURATION_SECONDS", "75")),
            fleet_refresh_interval=float(environ.get("SIMULATOR_FLEET_REFRESH_INTERVAL", "30")),
        )
        config.validate()
        return config

    def for_machine(self, machine_id: int, machine_name: str | None = None) -> "SimulatorConfig":
        return SimulatorConfig(
            api_base_url=self.api_base_url,
            api_token=self.api_token,
            farm_id=self.farm_id,
            mqtt_host=self.mqtt_host,
            mqtt_port=self.mqtt_port,
            mqtt_username=self.mqtt_username,
            mqtt_password=self.mqtt_password,
            mqtt_client_id=f"teledis-simulator-machine-{machine_id}",
            machine_id=int(machine_id),
            all_machines=False,
            machine_name=machine_name or f"Máquina {machine_id}",
            interval=self.interval,
            time_multiplier=self.time_multiplier,
            speed_kmh=self.speed_kmh,
            auto_operate=self.auto_operate,
            work_duration_seconds=self.work_duration_seconds,
            fleet_refresh_interval=self.fleet_refresh_interval,
        )

    def validate(self):
        if not self.mqtt_host.strip():
            raise ValueError("MQTT_HOST não pode ser vazio")
        if not self.api_base_url.strip():
            raise ValueError("SIMULATOR_API_URL não pode ser vazio")
        if self.farm_id is not None and self.farm_id <= 0:
            raise ValueError("SIMULATOR_FARM_ID deve ser maior que zero")
        if not 1 <= self.mqtt_port <= 65535:
            raise ValueError("MQTT_PORT deve estar entre 1 e 65535")
        if not self.all_machines and self.machine_id <= 0:
            raise ValueError("SIMULATOR_MACHINE_ID deve ser maior que zero")
        if self.interval <= 0:
            raise ValueError("SIMULATOR_INTERVAL deve ser maior que zero")
        if self.time_multiplier not in TIME_MULTIPLIERS:
            raise ValueError(
                "SIMULATOR_TIME_MULTIPLIER deve ser 1, 5, 10, 20 ou 50"
            )
        if not 0 < self.speed_kmh <= 40:
            raise ValueError("SIMULATOR_SPEED_KMH deve ser maior que zero e no máximo 40")
        if self.work_duration_seconds <= 0:
            raise ValueError("SIMULATOR_WORK_DURATION_SECONDS deve ser maior que zero")


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
    operation_id: int | None = None


def build_payloads(machine_id: int, reading: MachineReading) -> dict[str, dict]:
    common = {
        "maquina_id": machine_id,
        "timestamp": reading.timestamp,
        "source": reading.source,
    }
    if reading.operation_id is not None:
        common["operation_id"] = reading.operation_id
    payloads = {
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
    if reading.fuel < 20.0:
        payloads["alerta"] = {
            **common,
            "metric": "alerta_combustivel_baixo",
            "valor": reading.fuel,
            "unidade": "%",
        }
    return payloads


class AgriculturalMachine:
    def __init__(self, config: SimulatorConfig):
        self.config = config
        self.latitude: float | None = None
        self.longitude: float | None = None
        self.operation_id: int | None = None
        self.speed = 0.0
        self.fuel = 74.8
        self.engine_hours = 0.0
        self.cycle = 0
        self.route_points: list[tuple[float, float]] = []
        self.route_index = 0
        self._moving = False
        self.regime = "IDLE"
        self.machine_type: str | None = None
        self.operation_type: str | None = None

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

    def set_route(
        self,
        points: list[tuple[float, float]] | list[dict] | None,
        *,
        speed_kmh: float | None = None,
        regime: str | None = None,
    ):
        if points is None:
            self.route_points = []
            self.route_index = 0
            self._moving = False
            self.speed = 0.0
            self.regime = regime or "IDLE"
            return
        normalized_points: list[tuple[float, float]] = []
        for point in points:
            if isinstance(point, dict):
                normalized_points.append((float(point["latitude"]), float(point["longitude"])))
            else:
                normalized_points.append((float(point[0]), float(point[1])))
        if len(normalized_points) < 2:
            self.set_route(None, regime=regime)
            return
        if not self.has_position:
            self.set_position(*normalized_points[0])
        current_position = (self.latitude, self.longitude)
        if self._haversine_distance_m(current_position, normalized_points[0]) > 0.5:
            normalized_points.insert(0, current_position)
        self.route_points = normalized_points
        self.route_index = 0
        self._moving = True
        self.regime = regime or "TRAVELING"
        self.speed = self.config.speed_kmh if speed_kmh is None else max(0.0, float(speed_kmh))
        if self.speed == 0:
            self.set_route(None, regime=regime)

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
            if self.regime == "WORKING":
                rpm = round(1400 + self.speed * 80)
                temperature = 78.0 + self.speed * 1.4 + 0.8 * math.sin(simulated_cycle / 5.0)
            else:
                rpm = round(950 + self.speed * 145)
                temperature = 74.0 + self.speed * 1.55 + 0.7 * math.sin(simulated_cycle / 5.0)
        elif self.regime == "BASE":
            self.speed = 0.0
            rpm = 850
            temperature = 71.0 + 0.4 * math.sin(simulated_cycle / 5.0)
        else:
            self.speed = 0.0
            rpm = 950
            temperature = 74.0 + 0.7 * math.sin(simulated_cycle / 5.0)

        fuel_factor = 0.018 if self.regime == "WORKING" else 0.012
        fuel_used = (
            0.001 + fuel_factor * (self.speed / 6.0) if self._moving else 0.001
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
            operation_id=self.operation_id,
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
        self._working_operation_id: int | None = None
        self._work_started = False
        self._work_completed = False
        self._handled_road_problem_keys: set[tuple] = set()

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

    def _maybe_auto_advance_operation(self, context: dict, api_client) -> dict:
        if api_client is None or not self.config.auto_operate:
            return context
        operation = context.get("operation") or context.get("active_operation") or {}
        if not isinstance(operation, dict) or operation.get("id") is None:
            return context
        op_id = int(operation["id"])
        op_status = operation.get("status")
        if op_status == "ATRIBUIDA":
            logger.info("Auto-operando: aceitando operação #%s (máquina %s)", op_id, self.config.machine_id)
            api_client.transition_operation(op_id, "accept")
            if context.get("planned_route") is None:
                api_client.calculate_operation_route(op_id)
            api_client.transition_operation(op_id, "start")
            return api_client.resolve_context()
        if op_status == "ACEITA":
            logger.info("Auto-operando: iniciando operação #%s (máquina %s)", op_id, self.config.machine_id)
            if context.get("planned_route") is None:
                api_client.calculate_operation_route(op_id)
            api_client.transition_operation(op_id, "start")
            return api_client.resolve_context()
        if op_status == "EM_EXECUCAO" and context.get("planned_route") is None and context.get("simulator_state") != "EXECUTING_OPERATION":
            logger.info("Auto-operando: calculando rota faltante da operação #%s", op_id)
            api_client.calculate_operation_route(op_id)
            return api_client.resolve_context()
        return context

    def _maybe_reroute_on_road_problem(
        self,
        context: dict,
        api_client,
        road_problems: list[dict] | None,
    ) -> dict:
        if api_client is None or not road_problems:
            return context
        planned_route = context.get("planned_route")
        operation = context.get("active_operation") or context.get("operation") or {}
        if not isinstance(planned_route, dict) or operation.get("id") is None:
            return context
        route_ts = _parse_iso_datetime(planned_route.get("calculated_at"))
        if route_ts is None:
            return context
        op_id = int(operation["id"])
        for problem in road_problems:
            if not isinstance(problem, dict):
                continue
            status = problem.get("status")
            severity = problem.get("gravidade")
            tipo = problem.get("tipo")
            if status not in {"ABERTO", "EM_ANALISE"}:
                continue
            if severity not in {"ALTA", "CRITICA"} and tipo != "VIA_BLOQUEADA":
                continue
            problem_ts = _parse_iso_datetime(problem.get("updated_at") or problem.get("created_at"))
            if problem_ts is None or problem_ts <= route_ts:
                continue
            problem_key = (op_id, problem.get("id"), problem_ts.isoformat())
            if problem_key in self._handled_road_problem_keys:
                continue
            self._handled_road_problem_keys.add(problem_key)
            logger.info(
                "Problema viário detectado (%s/%s); recalculando rota da operação #%s via Dijkstra",
                tipo,
                severity,
                op_id,
            )
            api_client.calculate_operation_route(op_id)
            self._route_context_key = None
            return api_client.resolve_context()
        return context

    def sync_context(
        self,
        context: dict,
        *,
        api_client=None,
        road_problems: list[dict] | None = None,
    ) -> str:
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

        self.machine.machine_type = machine.get("tipo")
        context = self._maybe_auto_advance_operation(context, api_client)

        if str(context.get("simulator_state") or "") == "TRAVELING":
            context = self._maybe_reroute_on_road_problem(context, api_client, road_problems)

        active_operation = context.get("active_operation") or context.get("operation") or {}
        operation_id = None
        if isinstance(active_operation, dict):
            self.machine.operation_type = active_operation.get("operation_type")
            try:
                operation_id = int(active_operation.get("id"))
            except (TypeError, ValueError):
                operation_id = None
        self.machine.operation_id = operation_id

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

        if self.context_state == "AT_BASE":
            if self.machine.fuel < 95.0:
                self.machine.fuel = 95.0
            self._working_operation_id = None
            self._work_started = False
            self._work_completed = False
            self.machine.set_route(None, regime="BASE")
            self._route_context_key = None
            return self.context_state

        if self.context_state == "EXECUTING_OPERATION":
            field_geometry = (context.get("field") or {}).get("geometry")
            if self._working_operation_id == operation_id and self._work_started:
                if not self.machine.is_moving and not self._work_completed:
                    self._work_completed = True
                    if api_client is not None and self.config.auto_operate and operation_id is not None:
                        logger.info("Varredura concluída; finalizando operação #%s", operation_id)
                        api_client.transition_operation(
                            operation_id,
                            "complete",
                            "Varredura do talhão concluída pelo simulador.",
                        )
                        refreshed = api_client.resolve_context()
                        self.context_state = str(refreshed.get("simulator_state") or "AT_BASE")
                return self.context_state

            work_points = generate_field_work_path(
                field_geometry,
                start_point=(self.machine.latitude, self.machine.longitude) if self.machine.has_position else None,
            )
            if len(work_points) >= 2:
                total_m = sum(
                    AgriculturalMachine._haversine_distance_m(a, b)
                    for a, b in zip(work_points, work_points[1:])
                )
                calibrated_kmh = (total_m / self.config.work_duration_seconds) * 3.6
                work_speed = max(4.0, min(14.0, calibrated_kmh))
                self.machine.set_route(work_points, speed_kmh=work_speed, regime="WORKING")
                self._working_operation_id = operation_id
                self._work_started = True
                self._work_completed = False
                self._route_context_key = ("work", operation_id)
                return self.context_state

            self.machine.set_route(None, regime="WORKING")
            self._route_context_key = None
            return self.context_state

        route = None
        route_key = None
        if self.context_state == "TRAVELING":
            route = context.get("planned_route")
            route_key = ("operation", (route or {}).get("id"), (route or {}).get("calculated_at"))
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
                self.machine.set_route(points, speed_kmh=self.config.speed_kmh, regime="TRAVELING")
                self._route_context_key = route_key
        else:
            self.machine.set_route(None, regime="IDLE")
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

    def step(self, now: datetime | None = None) -> tuple[MachineReading, bool]:
        if self.state.run_status is not SimulationRunStatus.RUNNING or self.clock is None:
            raise RuntimeError("O simulador precisa estar em execução para avançar.")
        advanced_clock = self.clock.advance(self.config.interval)
        reading = self.machine.next_reading(now or advanced_clock)
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


class SimulatorConnectionError(SimulatorApiError):
    pass


class TeleDisApiClient:
    def __init__(self, config: SimulatorConfig):
        self.config = config
        if not config.api_token.strip():
            raise SimulatorApiError("SIMULATOR_API_TOKEN é obrigatório para validar o contexto.")
        if config.farm_id is None:
            raise SimulatorApiError("SIMULATOR_FARM_ID é obrigatório para validar a fazenda ativa.")

    def list_machines(self) -> list[dict]:
        response = self._request("GET", "/api/v1/machines")
        data = response.get("data")
        return data if isinstance(data, list) else []

    def list_road_problems(self) -> list[dict]:
        response = self._request("GET", "/api/v1/road-problems")
        data = response.get("data")
        return data if isinstance(data, list) else []

    def calculate_operation_route(self, operation_id: int) -> dict:
        response = self._request(
            "POST",
            f"/api/v1/operations/{operation_id}/route",
            {"reason": "Rota recalculada automaticamente pelo simulador operacional."},
        )
        return response.get("data") or {}

    def transition_operation(self, operation_id: int, action: str, reason: str | None = None) -> dict:
        response = self._request(
            "POST",
            f"/api/v1/simulator/operations/{operation_id}/transition",
            {"action": action, "reason": reason},
        )
        return response.get("data") or {}

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
            raise SimulatorConnectionError(
                f"Não foi possível conectar à API TeleDis: {exc.reason}"
            ) from exc
        except TimeoutError as exc:
            raise SimulatorConnectionError(
                "A API TeleDis excedeu o tempo limite de resposta."
            ) from exc
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


class _MachineRunner:
    def __init__(self, config: SimulatorConfig):
        self.config = config
        self.api_client = TeleDisApiClient(config)
        self.machine = AgriculturalMachine(config)
        self.publisher = MqttPublisher(config, boundary_validator=self.api_client)
        self.engine = SimulationEngine(config, self.machine, self.publisher)
        self.last_logged_state: str | None = None

    def start(self):
        self.publisher.connect()
        self.engine.start()

    def stop(self):
        self.engine.stop()
        self.publisher.disconnect()


def _discover_active_machines(base_config: SimulatorConfig, fleet_client: TeleDisApiClient) -> list[SimulatorConfig]:
    if not base_config.all_machines:
        return [base_config]
    machines = fleet_client.list_machines()
    configs: list[SimulatorConfig] = []
    for item in machines:
        if not isinstance(item, dict) or item.get("id") is None:
            continue
        if str(item.get("status") or "").lower() != "active":
            continue
        configs.append(base_config.for_machine(int(item["id"]), item.get("nome") or item.get("code")))
    return configs


def run():
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    base_config = SimulatorConfig.from_environment()
    fleet_client = TeleDisApiClient(base_config)
    runners: dict[int, _MachineRunner] = {}
    last_fleet_refresh = 0.0

    def sync_runners():
        nonlocal last_fleet_refresh
        now_mono = time.monotonic()
        if runners and base_config.all_machines and (now_mono - last_fleet_refresh) < base_config.fleet_refresh_interval:
            return
        target_configs = _discover_active_machines(base_config, fleet_client)
        last_fleet_refresh = now_mono
        target_ids = {cfg.machine_id for cfg in target_configs}
        for obsolete_id in [mid for mid in runners if mid not in target_ids]:
            runners.pop(obsolete_id).stop()
        for cfg in target_configs:
            if cfg.machine_id not in runners:
                runner = _MachineRunner(cfg)
                runner.start()
                runners[cfg.machine_id] = runner
                logger.info(
                    "Runner iniciado para máquina %s (%s), intervalo %.1fs, multiplicador %sx",
                    cfg.machine_id,
                    cfg.machine_name,
                    cfg.interval,
                    cfg.time_multiplier,
                )

    try:
        while True:
            try:
                sync_runners()
            except SimulatorConnectionError as exc:
                logger.warning("Falha temporária ao descobrir frota: %s", exc)
                time.sleep(base_config.interval)
                continue

            if not runners:
                logger.info("Nenhuma máquina ativa encontrada na fazenda %s; aguardando...", base_config.farm_id)
                time.sleep(base_config.interval)
                continue

            try:
                road_problems = fleet_client.list_road_problems()
            except SimulatorApiError:
                road_problems = []

            for runner in list(runners.values()):
                try:
                    context = runner.api_client.resolve_context()
                    simulator_state = runner.engine.sync_context(
                        context,
                        api_client=runner.api_client,
                        road_problems=road_problems,
                    )
                    if not runner.machine.has_position:
                        logger.warning(
                            "Nenhuma posição real ou base configurada para a máquina %s; aguardando.",
                            runner.config.machine_id,
                        )
                        continue
                    reading, published = runner.engine.step(now=datetime.now(timezone.utc))
                except SimulatorConnectionError as exc:
                    logger.warning(
                        "Conexão indisponível para máquina %s; ciclo sem publicação: %s",
                        runner.config.machine_id,
                        exc,
                    )
                    continue
                except SimulatorApiError as exc:
                    logger.error("Erro de contexto/validação na máquina %s: %s", runner.config.machine_id, exc)
                    continue

                if simulator_state != runner.last_logged_state:
                    logger.info(
                        "Estado operacional atualizado: máquina=%s estado=%s motivo=%s",
                        runner.config.machine_id,
                        simulator_state,
                        context.get("state_reason", "não informado"),
                    )
                    runner.last_logged_state = simulator_state
                display_reading(runner.config, reading, published, simulator_state)

            time.sleep(base_config.interval)
    except KeyboardInterrupt:
        logger.info("Encerrando simulador")
    finally:
        for runner in list(runners.values()):
            runner.stop()


if __name__ == "__main__":
    run()
