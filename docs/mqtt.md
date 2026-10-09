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
  "unidade": "C"
}
```

## Payload de localização GPS

Localização é publicada sem `valor` escalar e é persistida separadamente das medições:

```json
{
  "maquina_id": 1,
  "timestamp": "2026-10-01T14:10:00Z",
  "latitude": -23.500467,
  "longitude": -47.4521
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
