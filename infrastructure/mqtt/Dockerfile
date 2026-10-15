FROM eclipse-mosquitto:2

USER root

COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY docker-entrypoint-mqtt.sh /usr/local/bin/docker-entrypoint-mqtt.sh

RUN chmod 0755 /usr/local/bin/docker-entrypoint-mqtt.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint-mqtt.sh"]