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
- `simulator/`: simulador standalone de telemetria MQTT para desenvolvimento
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
- `GET /api/v1/auth/me`
- `GET /api/v1/farms`
- `GET /api/v1/users`
- `GET /api/v1/audit-logs`
- `GET /api/v1/machines`
- `GET /api/v1/telemetry`
- `GET /api/v1/teams`
- `GET /api/v1/operations`
- `GET /api/v1/operations/summary`

As APIs autenticadas usam JWT e contexto de fazenda via `X-Farm-Id`. Em bancos já inicializados, aplique as migrations pendentes sem remover o volume; para o RBAC multi-fazenda, consulte as instruções da migration [009 em docs/database.md](docs/database.md#fazendas-usuários-e-isolamento-multi-tenant).

## Acesso

- Frontend: http://localhost:5173
- API: http://localhost:8000
- Nginx: http://localhost
- MQTT: localhost:1883
- PostgreSQL: localhost:5432

## Simulador MQTT

Com o broker iniciado via Docker Compose, execute em outro terminal:

```powershell
py -3.12 simulator/simulator.py
```

Consulte [simulator/README.md](simulator/README.md) para dependências, variáveis de configuração e limitações dos tópicos/payloads aceitos atualmente.

## Segurança

- Senhas em hash;
- JWT para autenticação;
- Validação de entrada e permissões;
- CORS configurado; rate limiting ainda não implementado (não exponha a API publicamente sem proteção adicional);
- `.env` não versionado.

## Documentação

Consulte a pasta `docs/` para detalhes de arquitetura, banco, API, MQTT, segurança, deployment e backup.

O motor inicial de rotas operacionais usa Dijkstra sobre uma rede derivada das estradas e considera problemas ativos. Consulte [docs/routes.md](docs/routes.md) para aplicar a migration, reconstruir a rede e usar a API/interface. O cálculo é determinístico e ainda não utiliza inteligência artificial.

O ciclo operacional persistente (equipes, atribuição, operação do operador, rotas versionadas e ocorrências) é descrito em [docs/api.md](docs/api.md#equipes-e-ciclo-operacional) e usa a migration incremental [010](database/migrations/010_operational_cycle.sql). Antes de aplicar em banco existente, faça backup e valide a migration em uma cópia isolada.

A área operacional pertence à Fazenda e usa PostGIS e a migration incremental [011](database/migrations/011_farm_operational_area.sql). O perímetro pode ser desenhado na criação/edição da fazenda e seus vértices podem ser ajustados no mapa. Consulte aplicação da migration, isolamento, validações espaciais e limites em [docs/database.md](docs/database.md#área-operacional-da-fazenda) e os endpoints em [docs/api.md](docs/api.md#área-operacional).

## Próximos passos

- Adicionar notificações persistentes para mudanças de estado e ocorrências;
- Evoluir o provisionamento de máquinas MQTT para associar cada máquina a uma fazenda;
- Expandir os fluxos de manutenção usando APIs persistentes;
- Validar o isolamento multi-fazenda em ambiente de integração PostgreSQL/PostGIS.
