# TeleDis

TeleDis é uma base técnica inicial para um sistema de telemetria agrícola, com foco em máquinas, sensores, localizações, indicadores, rotas, alertas e integração MQTT. A arquitetura foi pensada para evoluir de forma segura e modular sem exigir reescrita do sistema.

## Objetivo

- Coletar dados de máquinas e sensores;
- Receber informações por MQTT;
- Persistir telemetria em banco relacional;
- Expor API REST segura;
- Preparar a aplicação para dashboards e operações futuras.

## Stack escolhida

- Frontend: React + Vite
- Backend: FastAPI
- Banco: PostgreSQL
- Broker MQTT: Mosquitto
- Proxy: Nginx
- Infraestrutura: Docker + Docker Compose

## Estrutura principal

- `frontend/`: aplicação web inicial
- `backend/`: API backend e serviços
- `database/`: migrações e scripts do banco
- `infrastructure/`: Nginx, MQTT e configurações de rede
- `docs/`: documentação técnica
- `tests/`: testes unitários e integrais

## Como executar

1. Clone o repositório.
2. Copie o arquivo `.env.example` para `.env`.
3. Ajuste as variáveis sensíveis.
4. Execute:

```bash
docker compose up --build -d
```

## Endpoints iniciais

- `GET /health`
- `GET /health/database`
- `GET /health/mqtt`
- `POST /api/v1/auth/login`
- `GET /api/v1/users/me`
- `GET /api/v1/machines`
- `GET /api/v1/telemetry`

## Acesso

- Frontend: http://localhost:5173
- API: http://localhost:8000
- Nginx: http://localhost
- MQTT: localhost:1883
- PostgreSQL: localhost:5432

## Segurança

- Senhas em hash;
- JWT para autenticação;
- Validação de entrada e permissões;
- CORS e rate limit configurados;
- `.env` não versionado.

## Documentação

Consulte a pasta `docs/` para detalhes de arquitetura, banco, API, MQTT, segurança, deployment e backup.

## Próximos passos

- Implementar autenticação real com usuários e perfis;
- Expandir modelos de telemetria;
- Adicionar rotas e trajetos;
- Criar simulador MQTT de máquinas.
