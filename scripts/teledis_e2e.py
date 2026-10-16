from __future__ import annotations

import argparse
import json
import math
import os
import signal
import sys
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import paho.mqtt.client as mqtt
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from app.config import get_settings
from app.core.security import create_access_token
import app.database as database
from app.models.user import Farm, Role, User, UserFarm
from simulator.simulator import SimulatorConfig

SessionLocal = database.SessionLocal


SCENARIO_BASE_NAME = "E2E TeleDis - Base"
SCENARIO_TEAM_CODE = "E2E-TELEDIS-001"
SCENARIO_OPERATION_NAME = "E2E TeleDis - Colheita"
SCENARIO_MACHINES = (
    ("E2E TeleDis - Máquina A", "E2E-TELEDIS-MACHINE-A"),
    ("E2E TeleDis - Máquina B", "E2E-TELEDIS-MACHINE-B"),
)
ACTIVE_OPERATION_STATES = {"ATRIBUIDA", "ACEITA", "EM_EXECUCAO", "INTERROMPIDA"}


class ScenarioError(RuntimeError):
    pass


def _require_development_environment():
    settings = get_settings()
    if settings.api_env.lower() != "development":
        raise ScenarioError("Este cenário só pode ser preparado em API_ENV=development.")
    return settings


def _configure_local_database():
    global SessionLocal
    settings = _require_development_environment()
    database_url = make_url(settings.database_url)
    if database_url.host in {"postgres", "teledis-postgres"}:
        database_url = database_url.set(host="localhost")
        engine = create_engine(database_url, pool_pre_ping=True)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        database.engine = engine
        database.SessionLocal = SessionLocal


def _issue_local_token(username: str, farm_id: int) -> tuple[str, dict]:
    with SessionLocal() as db:
        row = (
            db.query(User, UserFarm, Role)
            .join(UserFarm, UserFarm.user_id == User.id)
            .join(Role, Role.id == UserFarm.role_id)
            .filter(
                User.username == username,
                User.is_active.is_(True),
                UserFarm.farm_id == farm_id,
                UserFarm.status == "active",
            )
            .one_or_none()
        )
        if row is None:
            raise ScenarioError(f"Usuário {username!r} não tem acesso ativo à fazenda {farm_id}.")
        user, membership, role = row
        token = create_access_token(
            str(user.id),
            username=user.username,
            token_version=user.auth_version,
        )
        return token, {
            "id": user.id,
            "username": user.username,
            "role": role.name,
            "assigned_machine_id": membership.assigned_machine_id,
        }


class Api:
    def __init__(self, base_url: str, farm_id: int, token: str):
        self.base_url = base_url.rstrip("/")
        self.farm_id = farm_id
        self.token = token

    def request(self, method: str, path: str, payload=None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {
            "Authorization": f"Bearer {self.token}",
            "X-Farm-Id": str(self.farm_id),
            "Accept": "application/json",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(
            f"{self.base_url}/api/v1{path}",
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=10) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            try:
                details = json.loads(exc.read().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                details = {}
            message = details.get("detail", "erro sem detalhe") if isinstance(details, dict) else details
            raise ScenarioError(f"{method} {path} falhou (HTTP {exc.code}): {message}") from exc
        except URLError as exc:
            raise ScenarioError(f"API TeleDis indisponível em {self.base_url}: {exc.reason}") from exc
        return result

    def collection(self, path: str):
        response = self.request("GET", path)
        return response.get("data", response) if isinstance(response, dict) else response

    def data(self, method: str, path: str, payload=None):
        response = self.request(method, path, payload)
        return response.get("data", response) if isinstance(response, dict) else response


def _local_xy(longitude: float, latitude: float, reference_latitude: float):
    return (
        longitude * 111_320.0 * math.cos(math.radians(reference_latitude)),
        latitude * 110_540.0,
    )


def _polygon_centroid(geometry: dict) -> tuple[float, float]:
    rings = geometry.get("coordinates")
    if geometry.get("type") != "Polygon" or not rings or len(rings[0]) < 4:
        raise ScenarioError("Um talhão candidato não possui um polígono GeoJSON válido.")
    ring = rings[0]
    cross_sum = 0.0
    longitude_sum = 0.0
    latitude_sum = 0.0
    for start, end in zip(ring, ring[1:]):
        cross = start[0] * end[1] - end[0] * start[1]
        cross_sum += cross
        longitude_sum += (start[0] + end[0]) * cross
        latitude_sum += (start[1] + end[1]) * cross
    if abs(cross_sum) < 1e-12:
        raise ScenarioError("Um talhão candidato possui área nula.")
    return longitude_sum / (3.0 * cross_sum), latitude_sum / (3.0 * cross_sum)


def _select_base_and_field(roads: list[dict], fields: list[dict], snap_limit_m: float):
    candidates = []
    for road in roads:
        geometry = road.get("geometry") or {}
        coordinates = geometry.get("coordinates")
        if geometry.get("type") != "LineString" or not coordinates or len(coordinates) < 2:
            continue
        for field in fields:
            centroid = _polygon_centroid(field.get("geometry") or {})
            reference_latitude = centroid[1]
            point_x, point_y = _local_xy(*centroid, reference_latitude)
            for route_line in (coordinates, list(reversed(coordinates))):
                travelled = 0.0
                closest = None
                for index, (start, end) in enumerate(zip(route_line, route_line[1:])):
                    start_x, start_y = _local_xy(*start, reference_latitude)
                    end_x, end_y = _local_xy(*end, reference_latitude)
                    delta_x, delta_y = end_x - start_x, end_y - start_y
                    length_squared = delta_x * delta_x + delta_y * delta_y
                    fraction = 0.0 if length_squared == 0 else max(
                        0.0,
                        min(
                            1.0,
                            ((point_x - start_x) * delta_x + (point_y - start_y) * delta_y)
                            / length_squared,
                        ),
                    )
                    projected_x = start_x + fraction * delta_x
                    projected_y = start_y + fraction * delta_y
                    distance = math.hypot(point_x - projected_x, point_y - projected_y)
                    segment_length = math.sqrt(length_squared)
                    route_distance = travelled + fraction * segment_length
                    if closest is None or distance < closest["distance_m"]:
                        closest = {
                            "distance_m": distance,
                            "route_distance_m": route_distance,
                            "segment_index": index,
                            "projected": (
                                start[0] + fraction * (end[0] - start[0]),
                                start[1] + fraction * (end[1] - start[1]),
                            ),
                        }
                    travelled += segment_length
                if closest is None or closest["distance_m"] > snap_limit_m:
                    continue
                route_coordinates = [route_line[0]]
                for index in range(1, len(route_line) - 1):
                    if index <= closest["segment_index"]:
                        route_coordinates.append(route_line[index])
                route_coordinates.append(list(closest["projected"]))
                deduplicated = [
                    point for index, point in enumerate(route_coordinates)
                    if index == 0 or point != route_coordinates[index - 1]
                ]
                candidates.append({
                    "road": road,
                    "field": field,
                    "base": route_line[0],
                    "route_distance_m": closest["route_distance_m"],
                    "snap_distance_m": closest["distance_m"],
                    "route_point_count": len(deduplicated),
                })
    if not candidates:
        raise ScenarioError(
            "Não há par estrada/talhão existente dentro da tolerância de snap configurada."
        )
    candidates.sort(
        key=lambda candidate: (
            candidate["route_point_count"] >= 5,
            candidate["route_point_count"],
            candidate["route_distance_m"],
        ),
        reverse=True,
    )
    return candidates[0]


def _get_or_create_structure(api: Api, candidate: dict):
    structures = api.collection("/structures")
    existing = next(
        (item for item in structures if item.get("nome") == SCENARIO_BASE_NAME),
        None,
    )
    if existing is not None:
        return existing
    longitude, latitude = candidate["base"]
    return api.data("POST", "/structures", {
        "nome": SCENARIO_BASE_NAME,
        "tipo": "GALPAO",
        "descricao": "Estrutura descartável do cenário E2E de desenvolvimento TeleDis.",
        "geometry": {
            "type": "Point",
            "coordinates": [longitude, latitude],
        },
    })


def _get_or_create_machine(api: Api, name: str, code: str, base_structure_id: int):
    machines = api.collection("/machines")
    existing = next((machine for machine in machines if machine.get("code") == code), None)
    if existing is None:
        return api.data("POST", "/machines", {
            "name": name,
            "code": code,
            "status": "active",
            "base_structure_id": base_structure_id,
        })
    if existing.get("base_structure_id") not in (None, base_structure_id):
        raise ScenarioError(f"A máquina E2E {code} já aponta para outra estrutura-base.")
    if existing.get("base_structure_id") is None:
        existing = api.data("PATCH", f"/machines/{existing['id']}", {
            "base_structure_id": base_structure_id,
        })
    return existing


def prepare(api_base_url: str, farm_id: int):
    admin_token, admin = _issue_local_token("admin", farm_id)
    if admin["role"] != "OWNER":
        raise ScenarioError("A preparação requer o perfil OWNER da fazenda de desenvolvimento.")
    operator_candidates = [
        user for user in Api(api_base_url, farm_id, admin_token).collection("/users")
        if user.get("role") == "OPERATOR" and user.get("status") == "active"
    ]
    if not operator_candidates:
        raise ScenarioError("Não existe operador ativo para associar à operação E2E.")
    operator = operator_candidates[0]
    admin_api = Api(api_base_url, farm_id, admin_token)
    existing_machines = admin_api.collection("/machines")
    existing_machine_a = next(
        (item for item in existing_machines if item.get("code") == SCENARIO_MACHINES[0][1]),
        None,
    )
    if (
        operator.get("assigned_machine_id") is not None
        and (
            existing_machine_a is None
            or operator["assigned_machine_id"] != existing_machine_a["id"]
        )
    ):
        raise ScenarioError(
            f"O operador {operator['id']} já está atribuído à máquina "
            f"{operator['assigned_machine_id']}; nenhum vínculo existente foi alterado."
        )
    roads = admin_api.collection("/roads")
    fields = admin_api.collection("/fields")
    if not roads or not fields:
        raise ScenarioError("A fazenda precisa ter ao menos uma estrada e um talhão existentes.")
    snap_limit_m = get_settings().route_snap_max_distance_m
    candidate = _select_base_and_field(roads, fields, snap_limit_m)

    # Rebuild only the existing derived road graph through its API.
    network = admin_api.data("POST", "/routes/network/rebuild")
    structure = _get_or_create_structure(admin_api, candidate)
    machine_a, machine_b = [
        _get_or_create_machine(admin_api, name, code, structure["id"])
        for name, code in SCENARIO_MACHINES
    ]

    teams = admin_api.collection("/teams")
    team = next((item for item in teams if item.get("code") == SCENARIO_TEAM_CODE), None)
    if team is None:
        supervisors = [
            user for user in admin_api.collection("/users")
            if user.get("role") == "SUPERVISOR" and user.get("status") == "active"
        ]
        team = admin_api.data("POST", "/teams", {
            "name": "E2E TeleDis - Equipe",
            "code": SCENARIO_TEAM_CODE,
            "description": "Equipe descartável do cenário E2E de desenvolvimento.",
            "supervisor_id": supervisors[0]["id"] if supervisors else None,
        })
    members = admin_api.collection(f"/teams/{team['id']}/members")
    if not any(member.get("user_id") == operator["id"] for member in members):
        admin_api.data("POST", f"/teams/{team['id']}/members", {
            "user_id": operator["id"],
            "team_role": "OPERATOR",
        })

    operations = admin_api.collection("/operations")
    operation = next(
        (item for item in operations if item.get("name") == SCENARIO_OPERATION_NAME),
        None,
    )
    if operation is not None and operation.get("status") in {"CONCLUIDA", "CANCELADA"}:
        raise ScenarioError(
            "A operação E2E anterior é terminal. Execute `cleanup --confirm` antes de preparar outra."
        )
    if operation is None:
        operation = admin_api.data("POST", "/operations", {
            "operation_type": "COLHEITA",
            "name": SCENARIO_OPERATION_NAME,
            "description": "Operação de validação E2E; usa talhão e recursos reais da fazenda.",
            "field_id": candidate["field"]["id"],
            "priority": "NORMAL",
        })
    if operation.get("status") == "PLANEJADA":
        operation = admin_api.data("POST", f"/operations/{operation['id']}/assign", {
            "machine_id": machine_a["id"],
            "operator_id": operator["id"],
            "team_id": team["id"],
        })
    elif (
        operation.get("machine_id") != machine_a["id"]
        or operation.get("operator_id") != operator["id"]
        or operation.get("team_id") != team["id"]
    ):
        raise ScenarioError("A operação E2E existente aponta para vínculos diferentes.")

    return {
        "farm_id": farm_id,
        "operator_id": operator["id"],
        "team_id": team["id"],
        "base_structure_id": structure["id"],
        "machine_a_id": machine_a["id"],
        "machine_b_id": machine_b["id"],
        "field_id": candidate["field"]["id"],
        "operation_id": operation["id"],
        "operation_status": operation["status"],
        "road_id": candidate["road"]["id"],
        "base_coordinates_from_road": candidate["base"],
        "field_snap_distance_m": round(candidate["snap_distance_m"], 2),
        "estimated_route_distance_m": round(candidate["route_distance_m"], 2),
        "estimated_route_locations": candidate["route_point_count"],
        "network": network,
        "next": "Execute `python scripts/teledis_e2e.py run` para rodar o fluxo E2E completo.",
    }


def cleanup(farm_id: int, confirm: bool):
    if not confirm:
        raise ScenarioError("A limpeza exige a confirmação explícita `cleanup --confirm`.")
    _require_development_environment()
    with SessionLocal.begin() as db:
        machine_codes = [code for _, code in SCENARIO_MACHINES]
        machines = db.execute(
            text("""
            SELECT id FROM machines
            WHERE farm_id = :farm_id AND code = ANY(:codes)
            """),
            {"farm_id": farm_id, "codes": machine_codes},
        ).scalars().all()
        machine_ids = list(machines)
        team_id = db.execute(
            text("""
            SELECT id FROM teams
            WHERE farm_id = :farm_id AND code = :code
            """),
            {"farm_id": farm_id, "code": SCENARIO_TEAM_CODE},
        ).scalar_one_or_none()
        structure_id = db.execute(
            text("""
            SELECT id FROM structures
            WHERE farm_id = :farm_id AND nome = :name
            """),
            {"farm_id": farm_id, "name": SCENARIO_BASE_NAME},
        ).scalar_one_or_none()
        operations = db.execute(
            text("""
            SELECT id, status FROM operations
            WHERE farm_id = :farm_id AND name = :name
            """),
            {"farm_id": farm_id, "name": SCENARIO_OPERATION_NAME},
        ).all()
        if any(operation.status in ACTIVE_OPERATION_STATES for operation in operations):
            raise ScenarioError("Pare/interrompa a operação E2E antes da limpeza.")
        operation_ids = [operation.id for operation in operations]
        route_ids = db.execute(
            text("""
            SELECT id FROM route_plans
            WHERE farm_id = :farm_id
              AND (
                id IN (
                    SELECT route_plan_id FROM operations
                    WHERE farm_id = :farm_id AND id = ANY(:operation_ids)
                    UNION
                    SELECT route_plan_id FROM operation_route_history
                    WHERE farm_id = :farm_id AND operation_id = ANY(:operation_ids)
                )
              )
            """),
            {
                "farm_id": farm_id,
                "operation_ids": operation_ids or [-1],
            },
        ).scalars().all()

        if structure_id is not None:
            other_machines = db.execute(
                text("""
                SELECT id FROM machines
                WHERE farm_id = :farm_id AND base_structure_id = :structure_id
                  AND id != ALL(:machine_ids)
                """),
                {
                    "farm_id": farm_id,
                    "structure_id": structure_id,
                    "machine_ids": machine_ids or [-1],
                },
            ).scalars().all()
            if other_machines:
                raise ScenarioError(
                    f"A estrutura E2E é usada por máquinas não pertencentes ao cenário: {other_machines}."
                )

        if route_ids:
            db.execute(
                text("DELETE FROM route_locations WHERE farm_id = :farm_id AND route_id = ANY(:ids)"),
                {"farm_id": farm_id, "ids": route_ids},
            )
        if operation_ids:
            db.execute(
                text("DELETE FROM operation_occurrences WHERE farm_id = :farm_id AND operation_id = ANY(:ids)"),
                {"farm_id": farm_id, "ids": operation_ids},
            )
            db.execute(
                text("DELETE FROM operation_status_history WHERE farm_id = :farm_id AND operation_id = ANY(:ids)"),
                {"farm_id": farm_id, "ids": operation_ids},
            )
            db.execute(
                text("DELETE FROM operation_route_history WHERE farm_id = :farm_id AND operation_id = ANY(:ids)"),
                {"farm_id": farm_id, "ids": operation_ids},
            )
            db.execute(
                text("DELETE FROM operations WHERE farm_id = :farm_id AND id = ANY(:ids)"),
                {"farm_id": farm_id, "ids": operation_ids},
            )
        if route_ids:
            db.execute(
                text("DELETE FROM route_plans WHERE farm_id = :farm_id AND id = ANY(:ids)"),
                {"farm_id": farm_id, "ids": route_ids},
            )
        if team_id is not None:
            db.execute(
                text("DELETE FROM machine_assignments WHERE farm_id = :farm_id AND team_id = :team_id"),
                {"farm_id": farm_id, "team_id": team_id},
            )
            db.execute(
                text("DELETE FROM team_members WHERE farm_id = :farm_id AND team_id = :team_id"),
                {"farm_id": farm_id, "team_id": team_id},
            )
        if machine_ids:
            db.execute(
                text("""
                UPDATE user_farms SET assigned_machine_id = NULL
                WHERE farm_id = :farm_id AND assigned_machine_id = ANY(:ids)
                """),
                {"farm_id": farm_id, "ids": machine_ids},
            )
            db.execute(
                text("DELETE FROM machine_assignments WHERE farm_id = :farm_id AND machine_id = ANY(:ids)"),
                {"farm_id": farm_id, "ids": machine_ids},
            )
            db.execute(
                text("DELETE FROM telemetry_readings WHERE farm_id = :farm_id AND machine_id = ANY(:ids) AND source = 'SIMULATED'"),
                {"farm_id": farm_id, "ids": machine_ids},
            )
            db.execute(
                text("DELETE FROM machine_locations WHERE farm_id = :farm_id AND machine_id = ANY(:ids) AND source = 'SIMULATED'"),
                {"farm_id": farm_id, "ids": machine_ids},
            )
            db.execute(
                text("DELETE FROM machines WHERE farm_id = :farm_id AND id = ANY(:ids)"),
                {"farm_id": farm_id, "ids": machine_ids},
            )
        if team_id is not None:
            db.execute(
                text("DELETE FROM teams WHERE farm_id = :farm_id AND id = :team_id"),
                {"farm_id": farm_id, "team_id": team_id},
            )
        if structure_id is not None:
            db.execute(
                text("DELETE FROM structures WHERE farm_id = :farm_id AND id = :structure_id"),
                {"farm_id": farm_id, "structure_id": structure_id},
            )
    return {
        "farm_id": farm_id,
        "removed_machine_ids": machine_ids,
        "removed_operation_ids": operation_ids,
        "removed_route_plan_ids": route_ids,
        "removed_team_id": team_id,
        "removed_base_structure_id": structure_id,
        "preserved": ["users", "roles", "permissions", "farm", "existing fields and roads", "audit logs"],
    }


class MqttCapture:
    def __init__(self, config, machine_ids: list[int]):
        self.messages = []
        self._lock = threading.Lock()
        self._connected = threading.Event()
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"teledis-e2e-capture-{os.getpid()}",
        )
        def on_connect(client, userdata, flags, reason_code, properties):
            if reason_code.is_failure:
                return
            for machine_id in machine_ids:
                client.subscribe(f"teledis/maquina/{machine_id}/#", qos=1)
            self._connected.set()

        def on_message(client, userdata, message):
            try:
                payload = json.loads(message.payload.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                payload = None
            with self._lock:
                self.messages.append({
                    "topic": message.topic,
                    "qos": message.qos,
                    "payload": payload,
                })

        self.client.on_connect = on_connect
        self.client.on_message = on_message
        if config.mqtt_username:
            self.client.username_pw_set(config.mqtt_username, config.mqtt_password)
        self.client.connect(config.mqtt_host, config.mqtt_port, keepalive=60)
        self.client.loop_start()
        if not self._connected.wait(timeout=10):
            self.close()
            raise ScenarioError("O subscriber E2E não conectou ao broker MQTT.")

    def snapshot(self):
        with self._lock:
            return list(self.messages)

    def publish(self, topic: str, payload: dict):
        result = self.client.publish(topic, json.dumps(payload), qos=1)
        result.wait_for_publish(timeout=10)
        if not result.is_published():
            raise ScenarioError(f"Broker não confirmou PUBACK para {topic}.")

    def close(self):
        self.client.disconnect()
        self.client.loop_stop()


class SimulatorProcess:
    def __init__(
        self,
        machine_id: int,
        farm_id: int,
        token: str,
        log_path: Path,
        *,
        client_suffix: str,
    ):
        self.log_path = log_path
        self._log = log_path.open("w", encoding="utf-8")
        env = os.environ.copy()
        env.update({
            "SIMULATOR_API_URL": "http://localhost:8000",
            "SIMULATOR_API_TOKEN": token,
            "SIMULATOR_FARM_ID": str(farm_id),
            "SIMULATOR_MACHINE_ID": str(machine_id),
            "SIMULATOR_INTERVAL": "1",
            "SIMULATOR_TIME_MULTIPLIER": "10",
            "SIMULATOR_SPEED_KMH": "40",
            "SIMULATOR_MQTT_CLIENT_ID": f"teledis-e2e-{machine_id}-{client_suffix}",
            "PYTHONIOENCODING": "utf-8",
        })
        creation_flags = (
            subprocess.CREATE_NEW_PROCESS_GROUP
            if os.name == "nt"
            else 0
        )
        self.process = subprocess.Popen(
            [sys.executable, str(ROOT / "simulator" / "simulator.py")],
            cwd=ROOT,
            env=env,
            stdout=self._log,
            stderr=subprocess.STDOUT,
            creationflags=creation_flags,
        )

    def ensure_running(self):
        time.sleep(1.5)
        if self.process.poll() is not None:
            raise ScenarioError(
                f"Simulador {self.process.pid} encerrou inesperadamente:\n{self.output()}"
            )

    def stop(self):
        if self.process.poll() is None:
            try:
                if os.name == "nt":
                    self.process.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    self.process.send_signal(signal.SIGINT)
                self.process.wait(timeout=8)
            except (OSError, subprocess.TimeoutExpired):
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
        self._log.close()

    def output(self):
        try:
            if not self._log.closed:
                self._log.flush()
            return self.log_path.read_text(encoding="utf-8", errors="replace")[-6000:]
        except OSError:
            return ""


def _db_rows(query: str, parameters: dict):
    with SessionLocal() as db:
        return db.execute(text(query), parameters).mappings().all()


def _read_scenario_counts(machine_ids: list[int], farm_id: int):
    return _db_rows(
        """
        SELECT machine_id,
               COUNT(*) FILTER (WHERE record_kind = 'location') AS locations,
               COUNT(*) FILTER (WHERE record_kind = 'reading') AS readings,
               COUNT(*) FILTER (WHERE record_kind = 'simulated_location') AS simulated_locations,
               COUNT(*) FILTER (WHERE record_kind = 'simulated_reading') AS simulated_readings
        FROM (
            SELECT machine_id, farm_id, 'location' AS record_kind
            FROM machine_locations
            UNION ALL
            SELECT machine_id, farm_id, 'simulated_location' AS record_kind
            FROM machine_locations WHERE source = 'SIMULATED'
            UNION ALL
            SELECT machine_id, farm_id, 'reading' AS record_kind
            FROM telemetry_readings
            UNION ALL
            SELECT machine_id, farm_id, 'simulated_reading' AS record_kind
            FROM telemetry_readings WHERE source = 'SIMULATED'
        ) events
        WHERE farm_id = :farm_id AND machine_id = ANY(:machine_ids)
        GROUP BY machine_id ORDER BY machine_id
        """,
        {"farm_id": farm_id, "machine_ids": machine_ids},
    )


def _latest_position(machine_id: int, farm_id: int):
    rows = _db_rows(
        """
        SELECT id, recorded_at, latitude, longitude, source
        FROM machine_locations
        WHERE machine_id = :machine_id AND farm_id = :farm_id
        ORDER BY recorded_at DESC, id DESC LIMIT 1
        """,
        {"machine_id": machine_id, "farm_id": farm_id},
    )
    return dict(rows[0]) if rows else None


def _latest_speed(machine_id: int, farm_id: int, count: int = 10):
    rows = _db_rows(
        """
        SELECT readings.value, readings.recorded_at
        FROM telemetry_readings AS readings
        JOIN measurement_types AS metrics ON metrics.id = readings.measurement_type_id
        WHERE readings.machine_id = :machine_id
          AND readings.farm_id = :farm_id
          AND readings.source = 'SIMULATED'
          AND metrics.name = 'velocidade'
        ORDER BY readings.recorded_at DESC, readings.id DESC LIMIT :limit
        """,
        {"machine_id": machine_id, "farm_id": farm_id, "limit": count},
    )
    return [dict(row) for row in reversed(rows)]


def _context(api: Api, machine_id: int):
    return api.data("GET", f"/simulator/machines/{machine_id}/context")


def _sleep_and_check(processes: list[SimulatorProcess], seconds: float):
    time.sleep(seconds)
    for process in processes:
        if process.process.poll() is not None:
            raise ScenarioError(
                f"Simulador {process.process.pid} encerrou inesperadamente:\n{process.output()}"
            )


def _wait_for_state(api: Api, machine_id: int, states: set[str], timeout: float):
    deadline = time.monotonic() + timeout
    history = []
    while time.monotonic() < deadline:
        context = _context(api, machine_id)
        state = context.get("simulator_state")
        history.append(state)
        if state in states:
            return context, history
        if state == "ERROR":
            raise ScenarioError(
                f"Máquina {machine_id} entrou em ERROR: {context.get('state_reason')}"
            )
        time.sleep(0.5)
    raise ScenarioError(
        f"Máquina {machine_id} não atingiu {sorted(states)}; estados observados: {history}"
    )


def _http_status(api: Api, method: str, path: str, payload=None, *, farm_id: int | None = None):
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "Authorization": f"Bearer {api.token}",
        "X-Farm-Id": str(api.farm_id if farm_id is None else farm_id),
        "Accept": "application/json",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(
        f"{api.base_url}/api/v1{path}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=10) as response:
            response.read()
            return response.status
    except HTTPError as exc:
        exc.read()
        return exc.code
    except URLError as exc:
        raise ScenarioError(f"API TeleDis indisponível: {exc.reason}") from exc


def _duplicate_mqtt_test(capture: MqttCapture, api: Api, machine_id: int, farm_id: int):
    from datetime import datetime, timezone

    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    topic = f"teledis/maquina/{machine_id}/temperatura"
    base_payload = {
        "maquina_id": machine_id,
        "metric": "temperatura",
        "valor": 31.25,
        "unidade": "C",
        "timestamp": timestamp,
        "source": "SIMULATED",
    }
    capture.publish(topic, base_payload)
    capture.publish(topic, base_payload)
    time.sleep(1)
    rows = _db_rows(
        """
        SELECT readings.id, readings.value, COUNT(*) OVER () AS count
        FROM telemetry_readings AS readings
        JOIN measurement_types AS metrics ON metrics.id = readings.measurement_type_id
        WHERE readings.machine_id = :machine_id
          AND readings.farm_id = :farm_id
          AND readings.recorded_at = :timestamp
          AND readings.source = 'SIMULATED'
          AND metrics.name = 'temperatura'
        """,
        {
            "machine_id": machine_id,
            "farm_id": farm_id,
            "timestamp": timestamp.replace("Z", "+00:00"),
        },
    )
    if len(rows) != 1:
        raise ScenarioError(f"Reentrega MQTT criou {len(rows)} medições simuladas; esperado 1.")
    capture.publish(topic, {**base_payload, "valor": 32.25})
    time.sleep(1)
    after_conflict = _db_rows(
        """
        SELECT COUNT(*) AS count, MIN(value) AS value
        FROM telemetry_readings AS readings
        JOIN measurement_types AS metrics ON metrics.id = readings.measurement_type_id
        WHERE readings.machine_id = :machine_id
          AND readings.farm_id = :farm_id
          AND readings.recorded_at = :timestamp
          AND readings.source = 'SIMULATED'
          AND metrics.name = 'temperatura'
        """,
        {
            "machine_id": machine_id,
            "farm_id": farm_id,
            "timestamp": timestamp.replace("Z", "+00:00"),
        },
    )[0]
    if after_conflict["count"] != 1 or after_conflict["value"] != 31.25:
        raise ScenarioError("Payload conflitante MQTT alterou ou duplicou a medição original.")
    return {
        "topic": topic,
        "timestamp": timestamp,
        "qos": 1,
        "exact_retries": 2,
        "conflicting_retries": 1,
        "persisted_rows": after_conflict["count"],
        "preserved_value": after_conflict["value"],
    }


def run_e2e(api_base_url: str, farm_id: int, work_dir: Path):
    prepared = prepare(api_base_url, farm_id)
    admin_token, _ = _issue_local_token("admin", farm_id)
    operator_token, operator = _issue_local_token(
        next(
            user["username"]
            for user in Api(api_base_url, farm_id, admin_token).collection("/users")
            if user.get("id") == prepared["operator_id"]
        ),
        farm_id,
    )
    admin_api = Api(api_base_url, farm_id, admin_token)
    operator_api = Api(api_base_url, farm_id, operator_token)
    machine_a = prepared["machine_a_id"]
    machine_b = prepared["machine_b_id"]
    operation_id = prepared["operation_id"]
    initial_counts = _read_scenario_counts([machine_a, machine_b], farm_id)
    mqtt_config = SimulatorConfig.from_environment()
    capture = MqttCapture(mqtt_config, [machine_a, machine_b])
    running: dict[int, SimulatorProcess] = {}
    result = {"prepared": prepared, "operator_role": operator["role"]}

    def start(machine_id, token, suffix):
        process = SimulatorProcess(
            machine_id,
            farm_id,
            token,
            work_dir / f"simulator-{machine_id}-{suffix}.log",
            client_suffix=suffix,
        )
        running[machine_id] = process
        process.ensure_running()
        return process

    def stop(machine_id):
        process = running.pop(machine_id, None)
        if process is not None:
            process.stop()
            return process.output()
        return ""

    try:
        stationary_b = start(machine_b, admin_token, "stationary")
        stationary_a = start(machine_a, operator_token, "pending")
        _sleep_and_check([stationary_a, stationary_b], 4)
        context_a = _context(operator_api, machine_a)
        context_b = _context(admin_api, machine_b)
        if context_b["simulator_state"] != "AT_BASE":
            raise ScenarioError(f"Máquina B deveria estar parada na base: {context_b['simulator_state']}")
        if context_a["simulator_state"] != "OPERATION_NOT_READY":
            raise ScenarioError(
                f"Máquina A atribuída sem rota não deveria mover: {context_a['simulator_state']}"
            )
        initial_a = _latest_position(machine_a, farm_id)
        initial_b = _latest_position(machine_b, farm_id)
        if initial_a is None or initial_b is None:
            raise ScenarioError("Os simuladores não persistiram GPS inicial pelo MQTT.")
        stationary_speeds_b = _latest_speed(machine_b, farm_id)
        if not stationary_speeds_b or any(row["value"] != 0 for row in stationary_speeds_b):
            raise ScenarioError("A máquina B sem operação não permaneceu com velocidade zero.")
        result["stationary"] = {
            "machine_a_state_without_route": context_a["simulator_state"],
            "machine_b_state_without_operation": context_b["simulator_state"],
            "machine_a_location": initial_a,
            "machine_b_location": initial_b,
            "machine_b_recent_speeds": [row["value"] for row in stationary_speeds_b],
        }

        route = admin_api.data("POST", f"/operations/{operation_id}/route", {
            "reason": "Cálculo E2E pela rede viária persistida.",
        })
        route_info = _db_rows(
            """
            SELECT plan.id, plan.farm_id, plan.machine_id, plan.distance_m,
                   jsonb_array_length(plan.route_geometry->'geometry'->'coordinates') AS coordinates,
                   (SELECT COUNT(*) FROM route_locations locations WHERE locations.route_id=plan.id) AS route_locations
            FROM route_plans plan WHERE plan.id=:route_plan_id
            """,
            {"route_plan_id": route["route_plan_id"]},
        )[0]
        if route_info["farm_id"] != farm_id or route_info["machine_id"] != machine_a:
            raise ScenarioError("A rota persistida não corresponde à máquina e fazenda do cenário.")
        if route_info["route_locations"] < 5:
            raise ScenarioError(
                f"A rota real persistiu somente {route_info['route_locations']} pontos."
            )
        result["route"] = dict(route_info)
        result["route"]["segments"] = route["route"]["properties"].get("segments", [])

        operator_api.data("POST", f"/operations/{operation_id}/accept", {
            "reason": "Aceite E2E pelo operador atribuído.",
        })
        operator_api.data("POST", f"/operations/{operation_id}/start", {
            "reason": "Início E2E pelo operador atribuído.",
        })
        moving = stationary_a
        _sleep_and_check([moving, stationary_b], 3)
        first_movement = _latest_position(machine_a, farm_id)
        if first_movement is None or (
            first_movement["latitude"] == initial_a["latitude"]
            and first_movement["longitude"] == initial_a["longitude"]
        ):
            raise ScenarioError("A máquina A não avançou após iniciar a operação.")

        duplicate = SimulatorProcess(
            machine_a,
            farm_id,
            operator_token,
            work_dir / f"simulator-{machine_a}-duplicate.log",
            client_suffix="duplicate",
        )
        try:
            deadline = time.monotonic() + 8
            while duplicate.process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.2)
            if duplicate.process.poll() is None:
                raise ScenarioError("A segunda instância simultânea da máquina A não foi bloqueada.")
            duplicate_output = duplicate.output()
        finally:
            duplicate.stop()
        if "simulação ativa" not in duplicate_output.lower():
            raise ScenarioError(f"A segunda instância falhou por motivo inesperado:\n{duplicate_output}")
        result["concurrency"] = {
            "same_machine_second_start": "rejected",
            "different_machine_simultaneous": "running",
            "duplicate_process_exit_code": duplicate.process.returncode,
        }

        stable_b = _latest_position(machine_b, farm_id)
        stop(machine_b)
        time.sleep(1)
        stable_b = _latest_position(machine_b, farm_id)
        time.sleep(2)
        stopped_b = _latest_position(machine_b, farm_id)
        if stable_b is None or stopped_b is None or stable_b["id"] != stopped_b["id"]:
            raise ScenarioError("A máquina B continuou publicando após o stop do simulador.")
        result["stop_machine_b"] = {
            "position_before": stable_b,
            "position_after": stopped_b,
            "new_locations_after_stop": 0,
        }

        operator_api.data("POST", f"/operations/{operation_id}/interrupt", {
            "reason": "Pausa E2E durante deslocamento.",
        })
        pause_context, pause_states = _wait_for_state(
            operator_api, machine_a, {"PAUSED"}, timeout=8
        )
        time.sleep(1)
        paused_start = _latest_position(machine_a, farm_id)
        _sleep_and_check([moving], 3)
        paused_position = _latest_position(machine_a, farm_id)
        if paused_start is None or paused_position is None or (
            paused_position["latitude"] != paused_start["latitude"]
            or paused_position["longitude"] != paused_start["longitude"]
        ):
            raise ScenarioError("A máquina avançou enquanto a operação estava interrompida.")
        result["pause"] = {
            "state": pause_context["simulator_state"],
            "observed_states": pause_states,
            "position_before": paused_start,
            "position_after": paused_position,
        }
        operator_api.data("POST", f"/operations/{operation_id}/resume", {
            "reason": "Retomada E2E pelo operador atribuído.",
        })
        at_field, observed_states = _wait_for_state(
            operator_api, machine_a, {"EXECUTING_OPERATION"}, timeout=45
        )
        at_field_position = _latest_position(machine_a, farm_id)
        result["movement"] = {
            "state_at_field": at_field["simulator_state"],
            "observed_states": observed_states,
            "position": at_field_position,
        }

        operator_api.data("POST", f"/operations/{operation_id}/complete", {
            "reason": "Colheita E2E concluída após chegada ao talhão.",
        })
        at_base, return_states = _wait_for_state(
            admin_api, machine_a, {"AT_BASE"}, timeout=45
        )
        return_log = stop(machine_a)
        time.sleep(1)
        stopped_a = _latest_position(machine_a, farm_id)
        time.sleep(2)
        stable_after_stop = _latest_position(machine_a, farm_id)
        if (
            stopped_a is None
            or stable_after_stop is None
            or stopped_a["id"] != stable_after_stop["id"]
        ):
            raise ScenarioError("Foram persistidas localizações após o stop da máquina A.")
        result["return_to_base"] = {
            "state": at_base["simulator_state"],
            "observed_states": return_states,
            "location": stable_after_stop,
            "simulator_log_tail": return_log[-2000:],
        }

        operation = admin_api.data("GET", f"/operations/{operation_id}")
        if operation["status"] != "CONCLUIDA":
            raise ScenarioError(f"Estado terminal da operação inesperado: {operation['status']}")
        result["operation_final_status"] = operation["status"]

        duplicate_result = _duplicate_mqtt_test(capture, admin_api, machine_a, farm_id)
        result["mqtt_idempotency"] = duplicate_result

        before_invalid = _latest_position(machine_a, farm_id)
        invalid_status = _http_status(
            admin_api,
            "POST",
            f"/simulator/machines/{machine_a}/validate-location",
            {"latitude": 0.0, "longitude": 0.0},
        )
        if invalid_status not in {400, 409, 422}:
            raise ScenarioError(f"A validação espacial retornou HTTP {invalid_status} para 0,0.")
        invalid_timestamp = (
            time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        )
        capture.publish(
            f"teledis/maquina/{machine_a}/localizacao",
            {
                "maquina_id": machine_a,
                "timestamp": invalid_timestamp,
                "latitude": 0.0,
                "longitude": 0.0,
                "source": "SIMULATED",
            },
        )
        time.sleep(1)
        after_invalid = _latest_position(machine_a, farm_id)
        if after_invalid is None or before_invalid is None or after_invalid["id"] != before_invalid["id"]:
            raise ScenarioError("A posição simulada espacialmente inválida foi persistida.")
        result["spatial_negative"] = {
            "api_status": invalid_status,
            "mqtt_invalid_location_persisted": False,
        }

        isolation_status = _http_status(
            operator_api,
            "GET",
            f"/simulator/machines/{machine_a}/context",
            farm_id=999999,
        )
        if isolation_status != 403:
            raise ScenarioError(
                f"O acesso à fazenda alheia deveria retornar 403, recebeu {isolation_status}."
            )
        result["farm_isolation"] = {"cross_farm_status": isolation_status}

        with SessionLocal() as db:
            database_results = db.execute(
                text("""
                    SELECT
                        (SELECT COUNT(*) FROM route_locations WHERE route_id=:route_id) AS route_locations,
                        (SELECT COUNT(*) FROM machine_locations WHERE farm_id=:farm_id
                            AND machine_id=ANY(:machine_ids) AND source='SIMULATED') AS machine_locations,
                        (SELECT COUNT(*) FROM telemetry_readings WHERE farm_id=:farm_id
                            AND machine_id=ANY(:machine_ids) AND source='SIMULATED') AS telemetry_readings,
                        (SELECT COUNT(*) FROM telemetry_readings WHERE farm_id=:farm_id
                            AND machine_id=ANY(:machine_ids) AND source='SIMULATED'
                            AND recorded_at >= :started_at) AS recent_telemetry
                """),
                {
                    "route_id": route["route_plan_id"],
                    "farm_id": farm_id,
                    "machine_ids": [machine_a, machine_b],
                    "started_at": initial_a["recorded_at"],
                },
            ).mappings().one()
            trajectory = db.execute(
                text("""
                    SELECT COUNT(*) AS points,
                           MIN(ST_Distance(
                               ST_SetSRID(ST_GeomFromGeoJSON(:route),4326)::geography,
                               ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography
                           )) AS min_distance_m,
                           MAX(ST_Distance(
                               ST_SetSRID(ST_GeomFromGeoJSON(:route),4326)::geography,
                               ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography
                           )) FILTER (WHERE NOT ST_Covers(
                               (SELECT geometry FROM fields WHERE id=:field_id),
                               ST_SetSRID(ST_MakePoint(longitude,latitude),4326)
                           )) AS max_route_deviation_m
                    FROM machine_locations
                    WHERE farm_id=:farm_id AND machine_id=:machine_id
                      AND source='SIMULATED' AND recorded_at >= :started_at
                """),
                {
                    "route": json.dumps(route["route"]["geometry"]),
                    "farm_id": farm_id,
                    "machine_id": machine_a,
                    "field_id": prepared["field_id"],
                    "started_at": initial_a["recorded_at"],
                },
            ).mappings().one()
        result["database"] = dict(database_results)
        result["trajectory"] = dict(trajectory)
        mqtt_messages = capture.snapshot()
        relevant_messages = [
            message for message in mqtt_messages
            if message["payload"] and message["payload"].get("source") == "SIMULATED"
        ]
        result["mqtt"] = {
            "captured_messages": len(relevant_messages),
            "machine_a_topics": {},
            "machine_b_topics": {},
        }
        for machine_id, target_key in (
            (machine_a, "machine_a_topics"),
            (machine_b, "machine_b_topics"),
        ):
            counts = {}
            for message in relevant_messages:
                if message["topic"].startswith(f"teledis/maquina/{machine_id}/"):
                    metric = message["topic"].rsplit("/", 1)[-1]
                    counts[metric] = counts.get(metric, 0) + 1
            result["mqtt"][target_key] = counts
        final_counts = _read_scenario_counts([machine_a, machine_b], farm_id)
        result["record_counts_before"] = [dict(row) for row in initial_counts]
        result["record_counts_after"] = [dict(row) for row in final_counts]
        result["simulator_final_state_a"] = at_base["simulator_state"]
        return result
    finally:
        for machine_id in list(running):
            stop(machine_id)
        capture.close()


def _resolve_farm_id(requested_id: int | None) -> int:
    settings = _require_development_environment()
    with SessionLocal() as db:
        if requested_id is not None:
            farm = db.get(Farm, requested_id)
            if farm is None or farm.code != settings.initial_farm_code or farm.status != "active":
                raise ScenarioError("Use somente a fazenda de desenvolvimento ativa configurada no backend.")
            return farm.id
        farm = db.query(Farm).filter(
            Farm.code == settings.initial_farm_code,
            Farm.status == "active",
        ).one_or_none()
        if farm is None:
            raise ScenarioError("A fazenda de desenvolvimento configurada não existe ou está inativa.")
        return farm.id


def main():
    parser = argparse.ArgumentParser(
        description="Prepara ou remove com segurança o cenário E2E descartável do TeleDis."
    )
    parser.add_argument("action", choices=("prepare", "run", "cleanup"))
    parser.add_argument("--farm-id", type=int)
    parser.add_argument("--api-url", default="http://localhost:8000")
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    try:
        parsed_url = urlparse(args.api_url)
        if parsed_url.scheme != "http" or parsed_url.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ScenarioError("Por segurança, a URL da API deve apontar para localhost via HTTP.")
        _configure_local_database()
        farm_id = _resolve_farm_id(args.farm_id)
        if args.action == "prepare":
            result = prepare(args.api_url, farm_id)
        elif args.action == "run":
            with tempfile.TemporaryDirectory(prefix="teledis-e2e-") as directory:
                result = run_e2e(args.api_url, farm_id, Path(directory))
        else:
            result = cleanup(farm_id, args.confirm)
        print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    except ScenarioError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
