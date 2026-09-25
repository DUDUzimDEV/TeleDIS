# Arquitetura do TeleDis

## Visão geral

A arquitetura do TeleDis foi organizada em camadas para separar responsabilidades e permitir crescimento sem reescrever a aplicação.

```text
Internet
  │
  ▼
Nginx
  │
  ▼
Frontend
  │
  ▼
Backend API
  │
  ▼
Services / regras de negócio
  │
  ▼
Banco de dados PostgreSQL
```

## Fluxo principal

```text
Máquinas / sensores
  │
  ▼
MQTT Broker (Mosquitto)
  │
  ▼
Processamento MQTT
  │
  ▼
Backend / Services
  │
  ▼
Banco de dados
  │
  ▼
Frontend / Dashboard
```

## Responsabilidades por camada

### Frontend
- Exibe dashboards, alertas e indicadores;
- Consome a API via HTTP/HTTPS;
- Não acessa diretamente o banco.

### API
- Recebe requisições do frontend;
- Valida entradas;
- Aplica autenticação e autorização;
- Exposição de endpoints REST.

### Services
- Regras de negócio;
- Processamento de telemetria;
- Geração de alertas;
- Lógica de rota e operação.

### Banco de dados
- Persistência relacional;
- Estrutura normalizada para máquinas, sensores e telemetria.

### MQTT
- Recebimento dos dados em tempo real;
- Publicação e assinatura de tópicos;
- Processamento e persistência de mensagens.

## Projeto inicial

A estrutura atual implementa uma base real para as próximas etapas, com endpoints, autenticação inicial, documentação e ambiente Docker.
