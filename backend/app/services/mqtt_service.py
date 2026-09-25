from app.config import get_settings

settings = get_settings()


class MqttService:
    def __init__(self):
        self.client_id = settings.mqtt_client_id
        self.host = settings.mqtt_host
        self.port = settings.mqtt_port

    def subscribe_topics(self):
        return [
            "teledis/maquina/+/temperatura",
            "teledis/maquina/+/velocidade",
            "teledis/maquina/+/localizacao",
            "teledis/maquina/+/alerta",
        ]
