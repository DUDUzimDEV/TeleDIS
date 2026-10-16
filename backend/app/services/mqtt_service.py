import logging
import re
from datetime import datetime, timezone

from app.config import get_settings
from app.mqtt.client import MqttClient
from app.repositories.telemetry_repository import TelemetryRepository
from app.services.telemetry_service import TelemetryService
from app.services.spatial_validation_service import SpatialValidationError

logger = logging.getLogger(__name__)
settings = get_settings()
logger.setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))


class MqttService:
    def __init__(self):
        self.client_id = settings.mqtt_client_id
        self.host = settings.mqtt_host
        self.port = settings.mqtt_port
        self.repository = TelemetryRepository()
        self.telemetry_service = TelemetryService(self.repository)
        self.client = MqttClient()
        self.client.set_message_callback(self.handle_message)
        self._started = False

    def subscribe_topics(self):
        return [
            "teledis/maquina/+/temperatura",
            "teledis/maquina/+/velocidade",
            "teledis/maquina/+/rpm",
            "teledis/maquina/+/combustivel",
            "teledis/maquina/+/horimetro",
            "teledis/maquina/+/localizacao",
            "teledis/maquina/+/alerta",
        ]

    def extract_machine_id(self, topic: str) -> int | None:
        match = re.match(r"^teledis/maquina/(\d+)/(.+)$", topic)
        if not match:
            return None
        return int(match.group(1))

    def extract_metric(self, topic: str) -> str | None:
        match = re.match(r"^teledis/maquina/\d+/(.+)$", topic)
        if not match:
            return None
        return match.group(1)

    def parse_message(self, topic: str, raw_message: str) -> dict:
        machine_id = self.extract_machine_id(topic)
        metric = self.extract_metric(topic) or "temperatura"

        payload = self.client.parse_payload(raw_message)
        if not isinstance(payload, dict):
            payload = {"valor": payload}

        payload.setdefault("maquina_id", machine_id)
        payload.setdefault("metric", metric)
        payload.setdefault("timestamp", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))

        units = {
            "temperatura": "C",
            "velocidade": "km/h",
            "rpm": "rpm",
            "combustivel": "%",
            "horimetro": "h",
        }
        if metric in units:
            payload.setdefault("unidade", units[metric])

        valor = payload.get("valor")
        if valor is not None and isinstance(valor, str):
            try:
                payload["valor"] = float(valor)
            except ValueError:
                payload["valor"] = valor

        if machine_id is not None and payload.get("maquina_id") is None:
            payload["maquina_id"] = machine_id

        return payload

    def handle_message(self, topic: str, raw_message: str):
        try:
            payload = self.parse_message(topic, raw_message)
            if payload.get("metric") == "localizacao":
                if not self.telemetry_service.validate_location_payload(payload):
                    logger.warning("MQTT: payload de localização inválido tópico=%s", topic)
                    return None

                logger.info(
                    "MQTT: localização validada maquina_id=%s latitude=%s longitude=%s",
                    payload["maquina_id"],
                    payload["latitude"],
                    payload["longitude"],
                )
                record = self.telemetry_service.process_location(payload)
                logger.info(
                    "MQTT: localização persistida id=%s maquina_id=%s latitude=%s longitude=%s",
                    record["id"],
                    record["maquina_id"],
                    record["latitude"],
                    record["longitude"],
                )
                return record

            if not self.telemetry_service.validate_payload(payload):
                logger.warning("MQTT: payload inválido tópico=%s", topic)
                return None

            logger.info(
                "MQTT: payload validado maquina_id=%s metric=%s",
                payload["maquina_id"],
                payload["metric"],
            )
            record = self.telemetry_service.process_measurement(payload)
            logger.info(
                "MQTT: telemetria persistida id=%s maquina_id=%s metric=%s valor=%s",
                record["id"],
                record["maquina_id"],
                record["metric"],
                record["valor"],
            )
            return record
        except SpatialValidationError as exc:
            logger.warning(
                "MQTT: localização simulada rejeitada tópico=%s código=%s motivo=%s",
                topic,
                exc.code,
                exc,
            )
            return None
        except Exception:
            logger.exception("MQTT: erro ao processar mensagem tópico=%s", topic)
            return None

    def start(self):
        if self._started:
            return self

        try:
            self.client.subscribe(self.subscribe_topics())
            self.client.connect()
            self._started = True
            logger.info("MQTT: subscriber iniciado aguardando conexão; tópicos=%s", self.subscribe_topics())
        except Exception:
            logger.exception("MQTT: subscriber não iniciou; backend continuará sem broker conectado")
            self._started = False

        return self

    def stop(self):
        if not self._started:
            return

        try:
            self.client.disconnect()
        except Exception:
            logger.warning("Erro ao parar cliente MQTT.", exc_info=True)
        finally:
            self._started = False
