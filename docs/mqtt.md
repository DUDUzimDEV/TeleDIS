# Documentação MQTT

## Broker

O broker MQTT escolhido para a base do sistema é o Mosquitto, por ser leve, estável e compatível com ambientes de desenvolvimento e produção.

## Estrutura de tópicos

```text
teledis/maquina/{id}/temperatura
teledis/maquina/{id}/velocidade
teledis/maquina/{id}/combustivel
teledis/maquina/{id}/rpm
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
