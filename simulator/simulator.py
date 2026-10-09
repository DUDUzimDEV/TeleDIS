import json
import logging
import math
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping

import paho.mqtt.client as mqtt
from dotenv import dotenv_values


logger = logging.getLogger("teledis.simulator")


@dataclass(frozen=True)
class SimulatorConfig:
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_username: str = ""
    mqtt_password: str = field(default="", repr=False)
    mqtt_client_id: str = "teledis-simulator-machine-1"
    machine_id: int = 1
    machine_name: str = "MF 4270"
    interval: float = 5.0
    latitude: float = -23.5012
    longitude: float = -47.4521

    @classmethod
    def from_environment(cls, environ: Mapping[str, str] | None = None):
        dotenv_config = {}
        if environ is None:
            dotenv_config = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
            environ = os.environ

        config = cls(
            mqtt_host=environ.get("MQTT_HOST", "localhost"),
            mqtt_port=int(environ.get("MQTT_PORT", "1883")),
            mqtt_username=environ.get("MQTT_USERNAME", dotenv_config.get("MQTT_USERNAME") or ""),
            mqtt_password=environ.get("MQTT_PASSWORD", dotenv_config.get("MQTT_PASSWORD") or ""),
            mqtt_client_id=environ.get(
                "SIMULATOR_MQTT_CLIENT_ID",
                "teledis-simulator-machine-1",
            ),
            machine_id=1,
            machine_name=environ.get("SIMULATOR_NAME", "MF 4270"),
            interval=float(environ.get("SIMULATOR_INTERVAL", "5")),
            latitude=float(environ.get("SIMULATOR_LATITUDE", "-23.5012")),
            longitude=float(environ.get("SIMULATOR_LONGITUDE", "-47.4521")),
        )
        config.validate()
        return config

    def validate(self):
        if not self.mqtt_host.strip():
            raise ValueError("MQTT_HOST não pode ser vazio")
        if not 1 <= self.mqtt_port <= 65535:
            raise ValueError("MQTT_PORT deve estar entre 1 e 65535")
        if self.machine_id <= 0:
            raise ValueError("machine_id deve ser maior que zero")
        if self.interval <= 0:
            raise ValueError("SIMULATOR_INTERVAL deve ser maior que zero")
        if not -90 <= self.latitude <= 90:
            raise ValueError("SIMULATOR_LATITUDE deve estar entre -90 e 90")
        if not -180 <= self.longitude <= 180:
            raise ValueError("SIMULATOR_LONGITUDE deve estar entre -180 e 180")


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


def build_payloads(machine_id: int, reading: MachineReading) -> dict[str, dict]:
    common = {
        "maquina_id": machine_id,
        "timestamp": reading.timestamp,
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
        self.latitude = config.latitude
        self.longitude = config.longitude
        self.speed = 4.0
        self.fuel = 74.8
        self.engine_hours = 0.0
        self.cycle = 0

    def next_reading(self, now: datetime | None = None) -> MachineReading:
        self.cycle += 1
        target_speed = 6.5 + 2.0 * math.sin(self.cycle / 8.0)
        self.speed += (target_speed - self.speed) * 0.22
        self.speed = max(0.0, min(self.speed, 12.0))

        rpm = round(950 + self.speed * 145)
        temperature = 74.0 + self.speed * 1.55 + 0.7 * math.sin(self.cycle / 5.0)
        self.fuel = max(0.0, self.fuel - 0.012 * (self.speed / 6.0))
        self.engine_hours += self.config.interval / 3600

        distance_m = self.speed * 1000 / 3600 * self.config.interval
        heading = math.radians(35)
        self.latitude += distance_m * math.cos(heading) / 111_320
        longitude_scale = 111_320 * math.cos(math.radians(self.latitude))
        self.longitude += distance_m * math.sin(heading) / longitude_scale

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
    def __init__(self, config: SimulatorConfig, client=None):
        self.config = config
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


def display_reading(config: SimulatorConfig, reading: MachineReading, published: bool):
    state = "mensagens publicadas" if published else "aguardando/reconectando ao broker"
    print(
        f"[{datetime.now().strftime('%H:%M:%S')}] Máquina {config.machine_id} - {config.machine_name}\n"
        f"Temperatura: {reading.temperature:.1f} °C\n"
        f"Velocidade: {reading.speed:.1f} km/h\n"
        f"RPM: {reading.rpm}\n"
        f"Combustível: {reading.fuel:.1f}%\n"
        f"Horímetro: {reading.engine_hours:.4f} h\n"
        f"GPS: {reading.latitude:.6f}, {reading.longitude:.6f}\n"
        f"MQTT: {state}\n",
        flush=True,
    )


def run():
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    config = SimulatorConfig.from_environment()
    machine = AgriculturalMachine(config)
    publisher = MqttPublisher(config)
    publisher.connect()

    logger.info(
        "Simulador iniciado para máquina %s (%s), intervalo %.1fs; pressione Ctrl+C para parar",
        config.machine_id,
        config.machine_name,
        config.interval,
    )
    try:
        while True:
            reading = machine.next_reading()
            published = publisher.publish_reading(reading)
            display_reading(config, reading, published)
            time.sleep(config.interval)
    except KeyboardInterrupt:
        logger.info("Encerrando simulador")
    finally:
        publisher.disconnect()


if __name__ == "__main__":
    run()