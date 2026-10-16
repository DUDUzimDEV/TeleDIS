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
- Lógica de rota e operação;
- O serviço de rede gera nós e segmentos a partir de estradas e o serviço de rotas executa Dijkstra.

### Banco de dados
- Persistência relacional;
- Estrutura normalizada para máquinas, sensores e telemetria.

### MQTT
- Recebimento dos dados em tempo real;
- Publicação e assinatura de tópicos;
- Processamento e persistência de mensagens.

## Projeto inicial

A estrutura atual implementa uma base real para as próximas etapas, com endpoints, autenticação inicial, documentação e ambiente Docker.

O motor operacional de rotas usa tabelas próprias (`network_nodes` e `network_segments`), mantendo separadas as tabelas antigas de planos e pontos de rota (`route_plans` e `route_locations`). Consulte [routes.md](./routes.md) para o fluxo e limitações atuais.

A fundação do simulador, os campos de origem da telemetria e as dependências de
integração com operação, área espacial e MQTT estão descritos em
[simulator.md](./simulator.md).
