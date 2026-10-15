#!/bin/sh
set -eu

: "${MQTT_USERNAME:?MQTT_USERNAME must be set}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD must be set}"

umask 077
password_file=/mosquitto/config/passwd
if [ -f "$password_file" ]; then
	chown root:root "$password_file"
	chmod 0600 "$password_file"
	mosquitto_passwd -b "$password_file" "$MQTT_USERNAME" "$MQTT_PASSWORD"
else
	mosquitto_passwd -b -c "$password_file" "$MQTT_USERNAME" "$MQTT_PASSWORD"
fi
chown mosquitto:mosquitto "$password_file"
chmod 0600 "$password_file"

exec /docker-entrypoint.sh mosquitto -c /mosquitto/config/mosquitto.conf