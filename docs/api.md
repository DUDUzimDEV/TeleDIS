# Documentação da API

## Base

- Prefixo: `/api/v1`
- Base URL: `http://localhost:8000`
- APIs autenticadas: `Authorization: Bearer <JWT>`
- Contexto multi-fazenda: `X-Farm-Id: <id da fazenda ativa>`

O cabeçalho de fazenda é validado contra os vínculos ativos do usuário. Usuários com uma única fazenda podem omitir `X-Farm-Id`; usuários com várias fazendas devem selecionar uma. A ausência de permissão resulta em `403`; recurso fora do contexto ativo não é retornado.

## Endpoints iniciais

### Health

- `GET /health`
- `GET /health/database`
- `GET /health/mqtt`

### Autenticação

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

O login aceita nome de usuário ou e-mail. A resposta inclui os vínculos de fazenda; `GET /auth/me` retorna a fazenda ativa e as permissões efetivas.

### Fazendas e RBAC

- `GET /api/v1/farms` — fazendas ativas vinculadas ao usuário, permissões e status do perímetro operacional
- `POST /api/v1/farms` — criar fazenda e vínculo de proprietário; aceita `operational_area` opcional com `geometry` e `proximity_radius_m`
- `GET /api/v1/farms/{farm_id}` e `PATCH /api/v1/farms/{farm_id}` — consultar/alterar a fazenda ativa; no PATCH, omitir `operational_area` preserva a área, um objeto atualiza-a, e `null` solicita remoção
- `GET /api/v1/users` e `POST /api/v1/users`
- `GET /api/v1/users/{user_id}` e `PATCH /api/v1/users/{user_id}`
- `GET /api/v1/users/{user_id}/permissions` e `PUT /api/v1/users/{user_id}/permissions`
- `GET /api/v1/roles` — perfis e permissões de perfil
- `GET /api/v1/roles/permissions` — catálogo de permissões, requer `users.permissions`
- `GET /api/v1/audit-logs` — logs da fazenda ativa; aceita `action`, `user_id`, `since`, `until` e `limit`

As alterações de usuários, permissões e fazendas requerem as permissões correspondentes. `OWNER` não pode ser atribuído pelo endpoint comum de edição de usuário.

#### Área operacional

- `GET /api/v1/farms/{farm_id}/operational-area` — geometria, zona de proximidade e centro, requer `farm.view`
- `POST /api/v1/farms/{farm_id}/operational-area/preview` — validar alteração e retornar recursos incompatíveis, requer `farm.update`
- `PUT /api/v1/farms/{farm_id}/operational-area` — salvar geometria GeoJSON Polygon/MultiPolygon e raio em metros, requer `farm.update`
- `DELETE /api/v1/farms/{farm_id}/operational-area` — remover somente quando não houver recursos espaciais, requer `farm.update`
- `POST /api/v1/farms/{farm_id}/operational-area/validate-resource` — validar Polygon de talhão, Point de estrutura ou LineString de estrada em rascunho, requer permissão de criação correspondente

Todas as rotas exigem JWT e `farm_id` igual à fazenda ativa. PostGIS valida a geometria e calcula a zona de proximidade; o raio aceita de 0 até o limite configurado (teto de 10.000 m). Sem área configurada, novas criações de talhões, estruturas e estradas são recusadas com `409 OPERATIONAL_AREA_NOT_CONFIGURED`. Talhões e estruturas devem ficar inteiramente dentro da área; cada estrada deve ficar inteiramente dentro da área ou da zona de proximidade. A pré-validação visual no mapa não substitui a validação backend, executada novamente no cadastro.

Ao criar ou editar uma fazenda pela interface, o perímetro pode ser desenhado/editado no próprio formulário. O POST/PATCH aplica dados cadastrais, geometria e raio dentro da mesma transação; uma rejeição espacial desfaz toda a alteração. A propriedade permanece em `farms.operational_area` (SRID 4326) e `farms.proximity_radius_m`; nenhuma migration adicional é necessária.

### Máquinas

- `GET /api/v1/machines`
- `GET /api/v1/machines/{machine_id}`

### Localizações

- `GET /api/v1/locations`
- `GET /api/v1/locations/{machine_id}`

Para operadores, máquinas, localizações e histórico de telemetria são limitados à máquina atribuída na fazenda ativa.

### Recursos geográficos

- `/api/v1/fields` — talhões
- `/api/v1/structures` — estruturas
- `/api/v1/roads` — estradas
- `/api/v1/road-problems` — problemas nas vias

As operações de leitura e escrita usam o escopo `X-Farm-Id`; os detalhes de geometria permanecem em GeoJSON/PostGIS.

### Telemetria

- `GET /api/v1/telemetry`
- `GET /api/v1/telemetry/{machine_id}`

### Rede viária e rotas

- `POST /api/v1/routes/network/rebuild` (JWT obrigatório)
- `GET /api/v1/routes/nodes`
- `GET /api/v1/routes/segments`
- `POST /api/v1/routes/calculate`
- `POST /api/v1/routes/machine/{machine_id}/to-structure/{structure_id}`

Parâmetros, payloads, custos, respostas e erros estão descritos em [routes.md](./routes.md).

### Equipes e ciclo operacional

Todas as rotas abaixo usam JWT e o contexto `X-Farm-Id`; `farm_id` enviado no corpo não é aceito como substituto do contexto autorizado.

- `GET /api/v1/teams` e `GET /api/v1/teams/{team_id}` — consultar equipes (`teams.view`)
- `POST /api/v1/teams` e `PATCH /api/v1/teams/{team_id}` — gerenciar equipes (`teams.manage`)
- `GET/POST /api/v1/teams/{team_id}/members` e `DELETE /api/v1/teams/{team_id}/members/{user_id}` — consultar e gerenciar membros
- `GET /api/v1/teams/{team_id}/machines` — histórico de máquinas atribuídas à equipe
- `POST /api/v1/teams/{team_id}/machines/{machine_id}/assignments` — atribuir máquina/equipe e, opcionalmente, operador
- `GET/POST /api/v1/operations` — consultar e planejar operações (`operations.view` / `operations.create`)
- `GET /api/v1/operations/summary` — indicadores agregados das operações visíveis ao usuário da fazenda ativa
- `GET/PATCH /api/v1/operations/{operation_id}` — consultar e alterar planejamento
- `POST /api/v1/operations/{operation_id}/assign` — atribuir máquina, operador, equipe e supervisor
- `POST /api/v1/operations/{operation_id}/route` — calcular e versionar trajeto pelo Dijkstra existente
- `POST /api/v1/operations/{operation_id}/{accept,start,interrupt,resume,complete,cancel}` — transições controladas de estado
- `GET /api/v1/operations/{operation_id}/history` — histórico de estados e versões de rota
- `GET /api/v1/operations/{operation_id}/locations` — GPS real da execução e comparação quando houver dados
- `GET/POST /api/v1/operations/{operation_id}/occurrences` — consultar e registrar ocorrências da operação

O recurso de localizações retorna a posição atual e amostras GPS limitadas ao intervalo da operação, além das métricas disponíveis. A distância realizada é calculada como o comprimento geodésico da linha formada pelas amostras; aderência é a porcentagem de amostras a até `ROUTE_DEVIATION_TOLERANCE_METERS` da rota planejada, e o máximo desvio é a maior distância geodésica observada até essa linha. Esses indicadores são aproximados pela frequência de amostragem GPS e são nulos quando os dados necessários não existem. O mapa recebe até 1.500 amostras distribuídas no percurso; os cálculos de distância e aderência consideram todas as amostras no intervalo. O armazenamento atual de posições não inclui velocidade nem direção por amostra; esses valores não são inferidos. O Dashboard consome o resumo agregado e respeita o escopo de operações visíveis do perfil e da fazenda ativa.

Os estados válidos são `PLANEJADA`, `ATRIBUIDA`, `ACEITA`, `EM_EXECUCAO`, `INTERROMPIDA`, `CONCLUIDA` e `CANCELADA`. O operador só altera a operação que lhe foi atribuída; supervisores ficam limitados às operações sob sua supervisão. Dados GPS insuficientes são reportados sem fabricar distâncias ou durações.

## Exemplo de login

```json
{
  "username": "admin",
  "password": "Admin@123"
}
```

## Exemplo de resposta

```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "user": {
    "username": "admin",
    "role": "admin"
  }
}
```

## Padrão de erros

```json
{
  "detail": "Credenciais inválidas"
}
```
