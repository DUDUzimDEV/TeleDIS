# Documentação MQTT

## Broker

O broker MQTT escolhido para a base do sistema é o Mosquitto, por ser leve, estável e compatível com ambientes de desenvolvimento e produção.

## Estrutura de tópicos

```text
teledis/maquina/{id}/temperatura
teledis/maquina/{id}/velocidade
teledis/maquina/{id}/combustivel
teledis/maquina/{id}/rpm
teledis/maquina/{id}/horimetro
teledis/maquina/{id}/localizacao
teledis/maquina/{id}/rota
teledis/maquina/{id}/status
teledis/maquina/{id}/alerta
```

## Exemplo de payload JSON

```json
{
  "maquina_id": 1,
  "timestamp": "2026-09-25T10:00:00Z",
  "valor": 87.5,
  "unidade": "C",
  "source": "REAL"
}
```

`source` aceita `REAL` ou `SIMULATED`. Mensagens sem esse campo permanecem
compatíveis e são tratadas como `REAL`. O simulador publica explicitamente
`SIMULATED`; os registros persistem essa origem em `telemetry_readings` e
`machine_locations`, retornada pela API.

## Payload de localização GPS

Localização é publicada sem `valor` escalar e é persistida separadamente das medições:

```json
{
  "maquina_id": 1,
  "timestamp": "2026-10-01T14:10:00Z",
  "latitude": -23.500467,
  "longitude": -47.4521,
  "source": "SIMULATED"
}
```

Temperatura, velocidade, RPM, combustível e horímetro usam `telemetry_readings` com `valor` numérico e unidade, definidos por `measurement_types`.

## Validações previstas

- identificação da máquina;
- timestamp válido;
- valor numérico;
- campos obrigatórios;
- rejeição de payloads corrompidos.

## Papel do backend

O backend deve:
1. conectar ao broker;
2. autenticar;
3. assinar tópicos;
4. capturar e validar mensagens;
5. persistir dados quando necessário;
6. disparar alertas conforme regras de negócio.

Localizações declaradas como `SIMULATED` são validadas contra `farms.operational_area`
e seu `proximity_radius_m` geográfico antes de serem persistidas. Sem uma área
configurada, a localização simulada é recusada. A origem é um atributo
declarativo do payload; o broker atual ainda não possui credenciais ou ACL
isoladas por fazenda/máquina.

O publisher do simulador também valida cada posição candidata pela API
autenticada antes de publicar qualquer métrica daquela amostra. A identidade
vem do JWT, do `X-Farm-Id` permitido pelo usuário e do vínculo cadastrado da
máquina; `source` não autoriza publicação. O fluxo MQTT geral continua com
credencial compartilhada e sem ACL por máquina, portanto credenciais MQTT
independentes por máquina/fazenda continuam sendo uma dependência para
isolamento de publishers no broker.
