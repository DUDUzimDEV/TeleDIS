# TeleDis Machine Simulator

Standalone development simulator for an already registered machine. It publishes to the running TeleDis Mosquitto broker and never creates or modifies machine records. Generated measurements and GPS points are marked `SIMULATED`.

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

Every payload contains `"source": "SIMULATED"`. Before publishing any sample, the simulator calls the authenticated TeleDis API to validate its candidate GPS position against the selected farm's operational area and proximity buffer. If validation fails or the API cannot be reached, no metric or location from that sample is published. The backend checks the location again before persistence. The simulator reads the current operation context before each cycle. It follows the persisted operation route only while the operation is `EM_EXECUCAO` and the machine is traveling to its field, and uses the existing route service to return to its configured base after the operation ends. It remains stationary when no operational route is available, while an operation is pending/interrupted, or once it is inside the field. It never changes the official operation state or route plan.

The simulator defaults to machine ID `1` and display name `MF 4270`, but it does not assume an initial location. It uses the latest persisted machine location or its configured base structure; without either, it waits without publishing GPS or inventing coordinates. The configured name is only a local display label; the simulator does not rename the existing database record.

## Setup and run

From the repository root, install the isolated simulator dependencies:

```powershell
py -3.12 -m pip install -r simulator/requirements.txt
```

The simulator loads MQTT and simulator variables from the repository root `.env` when present. Set credentials through environment variables or that ignored `.env` file; no password or token is stored in simulator source. When running directly on Windows, the broker and API hosts default to `localhost`. The hostname `mqtt` is only for a simulator attached to the Compose Docker network.

Start the stack and run the simulator in a separate terminal:

Provide `SIMULATOR_API_TOKEN` (JWT with `machines.view`) and
`SIMULATOR_FARM_ID` for the selected farm. The simulator resolves context from
`GET /api/v1/simulator/machines/{machine_id}/context` before connecting to
MQTT, then validates each generated position through the API before publishing.

```powershell
docker compose up -d
py -3.12 simulator/simulator.py
```

Press `Ctrl+C` to stop. Connection failures are reported without printing credentials, and Paho retries automatically with increasing delays.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SIMULATOR_API_URL` | `http://localhost:8000` | TeleDis API base URL |
| `SIMULATOR_API_TOKEN` | empty (required) | JWT with access to the selected machine and farm |
| `SIMULATOR_FARM_ID` | unset (required) | Active farm ID authorized by that JWT |
| `MQTT_HOST` | `localhost` | Broker hostname (`mqtt` only inside the Docker network) |
| `MQTT_PORT` | `1883` | Broker port |
| `MQTT_USERNAME` | empty | Broker username |
| `MQTT_PASSWORD` | empty | Broker password |
| `SIMULATOR_MQTT_CLIENT_ID` | `teledis-simulator-machine-1` | Unique simulator client ID (must differ from backend `MQTT_CLIENT_ID`) |
| `SIMULATOR_NAME` | `MF 4270` | Terminal display name only |
| `SIMULATOR_MACHINE_ID` | `1` | ID of an already registered machine |
| `SIMULATOR_INTERVAL` | `5` | Seconds between cycles |
| `SIMULATOR_TIME_MULTIPLIER` | `1` | Simulated time factor: `1`, `5`, `10`, `20`, or `50` |
| `SIMULATOR_SPEED_KMH` | `8` | Physical travel speed, maximum `40 km/h` |

`SIMULATOR_MACHINE_ID` selects the target and defaults to `1` for compatibility;
the chosen machine must already exist. Existing database installations must apply
`database/migrations/012_telemetry_source.sql`, `013_machine_base_structure.sql`
and `014_simulated_telemetry_idempotency.sql` before deploying the new backend
code. Follow [the simulator foundation notes](../docs/simulator.md) for
spatial, authorization, and operation-cycle details.

## Example output

```text
[12:00:00] Máquina 1 - MF 4270
Temperatura: 83.1 °C
Velocidade: 4.6 km/h
RPM: 1617
Combustível: 74.8%
GPS: -23.501250, -47.452080
Origem: DADO SIMULADO
MQTT: mensagens publicadas
```

## Tests

From the repository root:

```powershell
py -3.12 -m pytest -q tests/unit/test_simulator.py
```