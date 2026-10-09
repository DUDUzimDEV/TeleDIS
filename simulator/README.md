# TeleDis Machine Simulator

Standalone development simulator for machine `1` (`MF 4270`). It publishes to the running TeleDis Mosquitto broker and never creates or modifies machine records.

## Compatibility with the current backend

The backend subscribes to `temperatura`, `velocidade`, `rpm`, `combustivel`, `horimetro`, `localizacao`, and `alerta`. Numeric metric payloads contain `valor`, `maquina_id`, `timestamp`, and `unidade`.

This simulator publishes five numeric readings and one GPS point each cycle:

- `teledis/maquina/1/temperatura`
- `teledis/maquina/1/velocidade`
- `teledis/maquina/1/rpm`
- `teledis/maquina/1/combustivel`
- `teledis/maquina/1/horimetro`
- `teledis/maquina/1/localizacao`

RPM varies with speed, fuel decreases gradually, and the hour meter increases by elapsed engine time. Location payloads contain `maquina_id`, `timestamp`, `latitude`, and `longitude`; unlike numeric metrics, they have no scalar `valor` field and are persisted in the separate GPS table.

The simulator defaults to machine ID `1`, display name `MF 4270`, and initial GPS coordinates `-23.5012, -47.4521`. The configured name is only a local display label; the simulator does not rename the existing database record.

## Setup and run

From the repository root, install the isolated simulator dependencies:

```powershell
py -3.12 -m pip install -r simulator/requirements.txt
```

The simulator loads MQTT variables from the repository root `.env` when present. Set credentials through environment variables or that ignored `.env` file; no password is stored in simulator source. When running directly on Windows, the broker host defaults to `localhost`. The hostname `mqtt` is only for a simulator attached to the Compose Docker network.

Start the stack and run the simulator in a separate terminal:

```powershell
docker compose up -d
py -3.12 simulator/simulator.py
```

Press `Ctrl+C` to stop. Connection failures are reported without printing credentials, and Paho retries automatically with increasing delays.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MQTT_HOST` | `localhost` | Broker hostname (`mqtt` only inside the Docker network) |
| `MQTT_PORT` | `1883` | Broker port |
| `MQTT_USERNAME` | empty | Broker username |
| `MQTT_PASSWORD` | empty | Broker password |
| `SIMULATOR_MQTT_CLIENT_ID` | `teledis-simulator-machine-1` | Unique simulator client ID (must differ from backend `MQTT_CLIENT_ID`) |
| `SIMULATOR_NAME` | `MF 4270` | Terminal display name only |
| `SIMULATOR_INTERVAL` | `5` | Seconds between cycles |
| `SIMULATOR_LATITUDE` | `-23.5012` | Initial latitude |
| `SIMULATOR_LONGITUDE` | `-47.4521` | Initial longitude |

## Example output

```text
[12:00:00] Máquina 1 - MF 4270
Temperatura: 83.1 °C
Velocidade: 4.6 km/h
RPM: 1617
Combustível: 74.8%
GPS: -23.501250, -47.452080
MQTT: mensagens publicadas
```

## Tests

From the repository root:

```powershell
py -3.12 -m pytest -q tests/unit/test_simulator.py
```