import json
import logging

import paho.mqtt.client as mqtt

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()
logger.setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))


class MqttClient:
    def __init__(self):
        self.host = settings.mqtt_host
        self.port = settings.mqtt_port
        self.client_id = settings.mqtt_client_id
        self.username = settings.mqtt_username
        self.password = settings.mqtt_password
        self._message_callback = None
        self._subscriptions = []
        self._connected = False
        self._subscription_mids = {}

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=self.client_id)
        if self.username:
            self.client.username_pw_set(self.username, self.password)

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message
        self.client.on_subscribe = self._on_subscribe

    def set_message_callback(self, callback):
        self._message_callback = callback

    def build_topic(self, machine_id: int, metric: str) -> str:
        return f"teledis/maquina/{machine_id}/{metric}"

    def parse_payload(self, raw_message: str | bytes) -> dict:
        if isinstance(raw_message, (bytes, bytearray)):
            raw_message = raw_message.decode("utf-8")

        message = (raw_message or "").strip()
        if not message:
            raise ValueError("Mensagem MQTT vazia")

        try:
            data = json.loads(message)
            if isinstance(data, dict):
                return data
            return {"valor": data}
        except json.JSONDecodeError:
            try:
                return {"valor": float(message)}
            except ValueError as exc:
                raise ValueError("Payload MQTT inválido") from exc

    def connect(self):
        logger.info(
            "MQTT: conectando ao broker host=%s port=%s client_id=%s",
            self.host,
            self.port,
            self.client_id,
        )
        try:
            self.client.connect(self.host, self.port, keepalive=60)
            self.client.loop_start()
            return self.client
        except Exception as exc:
            logger.exception("MQTT: falha ao conectar ao broker %s:%s: %s", self.host, self.port, exc)
            raise

    def subscribe(self, topics):
        if isinstance(topics, str):
            topics = [topics]

        self._subscriptions = list(topics)
        if self._connected:
            self._subscribe_topics()
        else:
            logger.info("MQTT: tópicos registrados; subscribe será enviado após conexão estabelecida")

        return self._subscriptions

    def _subscribe_topics(self):
        for topic in self._subscriptions:
            result, message_id = self.client.subscribe(topic, qos=0)
            if result != mqtt.MQTT_ERR_SUCCESS:
                logger.error("MQTT: falha ao enviar subscribe tópico=%s resultado=%s", topic, result)
                continue

            self._subscription_mids[message_id] = topic
            logger.info("MQTT: subscribe realizado tópico=%s qos=0", topic)

    def disconnect(self):
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            logger.warning("Erro ao encerrar conexão MQTT.", exc_info=True)
        finally:
            self._connected = False

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code.is_failure:
            logger.error("MQTT: conexão recusada pelo broker motivo=%s", reason_code)
            return

        self._connected = True
        logger.info("MQTT: conexão estabelecida host=%s port=%s", self.host, self.port)
        self._subscribe_topics()

    def _on_subscribe(self, client, userdata, message_id, reason_codes, properties=None):
        topic = self._subscription_mids.pop(message_id, "desconhecido")
        logger.info("MQTT: broker confirmou subscribe tópico=%s resultado=%s", topic, reason_codes)

    def _on_disconnect(self, client, userdata, rc, properties=None):
        self._connected = False
        logger.warning("Desconectado do broker MQTT: %s", rc)

    def _on_message(self, client, userdata, message):
        if self._message_callback is None:
            logger.error("MQTT: mensagem ignorada; callback de processamento não configurado")
            return

        payload = message.payload.decode("utf-8", errors="replace")
        logger.info("MQTT: mensagem recebida tópico=%s bytes=%s", message.topic, len(message.payload))
        self._message_callback(message.topic, payload)
