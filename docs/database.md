# Banco de dados

## Banco escolhido

PostgreSQL foi escolhido por oferecer:
- suporte a dados relacionais;
- conformidade com regras de integridade;
- bons índices para queries de telemetria;
- maturidade para produção.

## Estrutura conceitual

- `roles`: perfis de acesso
- `users`: usuários do sistema
- `brands`: marcas de máquinas
- `models`: modelos de máquinas
- `machines`: máquinas agrícolas
- `measurement_types`: tipos de medição e unidade
- `telemetry_readings`: leituras de telemetria
- `machine_locations`: pontos GPS por máquina, com latitude, longitude e timestamp
- `route_plans`: rotas ideais
- `route_locations`: localizações de rota

## Importante

A separação entre cadastro e leitura é essencial para permitir diferentes tipos de sensores. A tabela de medição representa a definição, e a leitura armazena o valor em um momento específico.

## Migrações

As migrações iniciais estão em:
- `database/migrations/001_init.sql`
- `database/migrations/002_machine_locations.sql`
- `database/migrations/003_postgis_extension.sql`
- `database/migrations/004_fields.sql`
- `database/migrations/005_structures.sql`
- `database/migrations/006_roads.sql`
- `database/migrations/007_road_problems.sql`
- `database/migrations/008_route_network.sql`
- `database/migrations/009_farms_rbac.sql`
- `database/migrations/010_operational_cycle.sql`

`telemetry_readings` continua genérica: temperatura, velocidade, RPM, combustível, horímetro e futuras métricas compartilham a tabela e são distinguidas por `measurement_types`. Pontos GPS são armazenados separadamente em `machine_locations` e não usam latitude como um valor numérico substituto.

Para banco já inicializado, aplique `002_machine_locations.sql` explicitamente, por exemplo com `docker exec teledis-postgres psql -U teledis -d teledis -f /docker-entrypoint-initdb.d/002_machine_locations.sql`. A migration é aditiva e preserva tabelas/leitura existentes. Leituras antigas com métrica `localizacao` permanecem em `telemetry_readings`; como não incluem longitude, não são convertidas para pontos GPS incompletos ou inventados.

PostGIS é habilitado por `003_postgis_extension.sql`. A migration `004_fields.sql` cria a tabela `fields` com polígonos `geometry(Polygon, 4326)` e índice GiST. Para banco já inicializado, aplique-a explicitamente sem recriar o volume: `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U teledis -d teledis -f /docker-entrypoint-initdb.d/004_fields.sql`. A API calcula `area_ha` com `ST_Area(geometry::geography) / 10000`; valores enviados pelo frontend não são aceitos como fonte de área.

A migration `005_structures.sql` cria `structures` com pontos `geometry(Point, 4326)`, índice GiST e tipos controlados: `OFICINA`, `GALPAO`, `ABASTECIMENTO`, `SEDE`, `ALMOXARIFADO`, `APOIO` e `OUTRO`. Para banco já inicializado, aplique-a sem recriar o volume: `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U teledis -d teledis -f /docker-entrypoint-initdb.d/005_structures.sql`. A API oferece `POST /api/v1/structures`, `GET /api/v1/structures` e `GET /api/v1/structures/{id}`; a geometria de entrada e saída usa GeoJSON Point em ordem `[longitude, latitude]`.

A migration `006_roads.sql` cria `roads` com `geometry(LineString, 4326)`, restrições para linhas válidas com comprimento positivo e índice espacial GiST. Os tipos permitidos são `PRINCIPAL`, `SECUNDARIA`, `ACESSO`, `SERVICO` e `OUTRA`. Em um banco já inicializado, aplique-a sem recriar o volume: `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U teledis -d teledis -f /docker-entrypoint-initdb.d/006_roads.sql`. A API oferece `POST /api/v1/roads`, `GET /api/v1/roads` e `GET /api/v1/roads/{id}`; o GeoJSON LineString usa pares `[longitude, latitude]`. O comprimento oficial retornado por `comprimento_m` é calculado dinamicamente com `ST_Length(geometry::geography)` e não é enviado nem armazenado pelo frontend.

A migration `007_road_problems.sql` cria `road_problems`, relacionando cada ocorrência obrigatoriamente a `roads.id` por FK e guardando sua posição em `geometry(Point, 4326)` com índice GiST. Tipos: `BURACO`, `LAMA`, `ALAGAMENTO`, `VIA_BLOQUEADA`, `PONTE_PROBLEMA`, `DESLIZAMENTO`, `OUTRO`; gravidades: `BAIXA`, `MEDIA`, `ALTA`, `CRITICA`; status: `ABERTO`, `EM_ANALISE`, `RESOLVIDO`, `INATIVO` (novos registros iniciam como `ABERTO`). Para banco existente, aplique sem remover o volume: `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U teledis -d teledis -f /docker-entrypoint-initdb.d/007_road_problems.sql`. A API oferece `POST /api/v1/road-problems`, `GET /api/v1/road-problems` e `GET /api/v1/road-problems/{id}`; o ponto usa GeoJSON `[longitude, latitude]`.

No registro do problema, o mapa projeta o clique para o ponto mais próximo da estrada selecionada e só abre o formulário quando o clique estiver a até 30 m. O backend repete o ajuste com `ST_ClosestPoint` sobre `geography`, valida a distância geográfica com PostGIS e persiste o ponto resultante da estrada; pontos enviados a mais de 30 m são rejeitados.

A migration `008_route_network.sql` adiciona `network_nodes` (`Point, 4326`) e `network_segments` (`LineString, 4326`) para o grafo de navegação. Ambas as geometrias têm índice GiST; os segmentos também têm índices para estrada e nós de conexão. A migration não altera `route_plans` nem `route_locations`. Em bancos já inicializados, aplique-a explicitamente sem remover o volume:

```powershell
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U teledis -d teledis -f /docker-entrypoint-initdb.d/008_route_network.sql
```

Depois da migration, reconstrua o grafo com `POST /api/v1/routes/network/rebuild` (requer JWT). A construção usa `ST_Node`/`ST_UnaryUnion` para dividir as linhas nos cruzamentos geométricos reais; coordenadas coincidentes são um único nó, enquanto vias apenas próximas não são conectadas. Comprimento do segmento e custo base são calculados no PostGIS em metros. Veja [routes.md](./routes.md) para parâmetros, API e limitações.

### Fazendas, usuários e isolamento multi-tenant

A migration `009_farms_rbac.sql` cria a fazenda `Fazenda Dev/Teste TeleDis` (`DEV-TEST-001`), vínculos de usuários, permissões, associações perfil-permissão, exceções individuais e logs de auditoria. Ela adiciona `farm_id` aos recursos operacionais, associa os registros legados à fazenda de desenvolvimento/teste e estabelece chaves estrangeiras para impedir relações entre fazendas. Os dados existentes não são apagados.

**Pré-condição de segurança:** o backfill atribui máquinas, talhões, estruturas e estradas legadas à fazenda `DEV-TEST-001`; recursos relacionados herdam a fazenda pela máquina, estrada ou rota. A decisão de negócio para o banco de desenvolvimento confirma que todos os registros atuais pertencem à fazenda especial de desenvolvimento/teste. Não use esse backfill como prova de propriedade de dados em outro ambiente. Nós da rede sem associação única herdável fazem a restrição `NOT NULL` falhar; a transação reverte integralmente.

Em banco já inicializado, aplique a migration uma única vez, após confirmar essa pré-condição e um backup:

```powershell
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U teledis -d teledis -f /docker-entrypoint-initdb.d/009_farms_rbac.sql
```

Não remova o volume do PostgreSQL. A migration não é um mecanismo de atualização automática para volumes existentes e não deve ser reaplicada depois de concluída. Em banco novo, os arquivos montados em `/docker-entrypoint-initdb.d` são processados pelo entrypoint oficial do PostgreSQL.

No primeiro início do backend, o bootstrap cria ou vincula o usuário `admin` como proprietário da fazenda inicial. A senha é a variável `DEFAULT_ADMIN_PASSWORD`; o e-mail inicial configurável é `INITIAL_ADMIN_EMAIL`. O serviço falha explicitamente se a migration ou o perfil `OWNER` ainda não estiverem presentes. O contexto de fazenda das requisições é informado no cabeçalho `X-Farm-Id`; usuários vinculados a apenas uma fazenda podem omiti-lo.

As migrations 001–009 e os testes de isolamento entre fazendas foram validados em uma base PostgreSQL/PostGIS descartável. No banco de desenvolvimento, a migration 009 deve ser aplicada uma única vez após backup e confirmação da decisão de negócio acima.

### Ciclo operacional

A migration `010_operational_cycle.sql` acrescenta equipes, membros, histórico de atribuições de máquinas, operações, transições de status, versões de rotas e ocorrências. Ela amplia `route_plans` e reutiliza `route_locations`; não cria uma segunda estrutura de rotas. As chaves estrangeiras compostas mantêm as relações no mesmo `farm_id`. As rotas das operações são calculadas pelo serviço Dijkstra existente usando a posição GPS real da máquina e o centroide PostGIS do talhão.

Em bancos já inicializados com a migration 009, faça backup e valide a migration em uma cópia isolada antes de aplicá-la uma única vez:

```powershell
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U teledis -d teledis -f /docker-entrypoint-initdb.d/010_operational_cycle.sql
```

Não remova o volume nem reaplique a migration 010. Comparações de trajeto usam pontos GPS persistidos dentro do intervalo da operação; distância e duração permanecem indisponíveis quando não há amostras suficientes ou a operação ainda não foi concluída.

### Área operacional da fazenda

A migration aditiva `011_farm_operational_area.sql` acrescenta `farms.operational_area` (`geometry(Geometry, 4326)`), `farms.proximity_radius_m` (padrão de 500 m e limite de banco de 0 a 10.000 m) e índice GiST parcial. Ela não cria tabela nem altera geometria ou dados de recursos existentes. Confirme primeiro que 011 ainda não foi aplicada no banco alvo e faça backup; aplique-a uma única vez, somente após validação em uma cópia isolada:

```powershell
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U teledis -d teledis -f /docker-entrypoint-initdb.d/011_farm_operational_area.sql
```

A configuração fica disponível na criação/edição da Fazenda e em `/api/v1/farms/{farm_id}/operational-area`; alteração requer `farm.update` e leitura requer `farm.view`. O ID precisa corresponder à fazenda ativa (`X-Farm-Id`), e o backend valida permissão e escopo em cada chamada. Criar/editar dados cadastrais junto com o perímetro usa uma única transação: geometria inválida ou incompatível desfaz o conjunto. A tela de área operacional continua disponível e o preview usa PostGIS antes de salvar, impedindo nova área que deixe recursos atuais incompatíveis. Talhões e estruturas devem estar inteiramente dentro do polígono; cada estrada deve estar inteiramente dentro da área ou da zona geodésica de proximidade configurada. A API rejeita cadastro espacial quando a fazenda ainda não possui área configurada, sem remover ou migrar registros existentes.

O editor permite desenhar vértices, arrastá-los, inserir pontos clicando nos pontos médios dos segmentos e remover vértices sem ficar abaixo do mínimo de três. O cliente verifica coordenadas, área degenerada e auto-interseções para feedback; PostGIS permanece a validação autoritativa. Fazenda sem perímetro permanece explicitamente sem geometria: não se infere limite a partir de talhões, estradas, estruturas, GPS ou bounding box. A tela de fazendas informa se o perímetro está cadastrado. Remover o perímetro requer confirmação e é recusado enquanto existirem recursos espaciais vinculados; nenhum desses recursos é apagado.

A remoção da área é bloqueada enquanto houver talhões, estruturas, estradas ou problemas associados; nenhum recurso é apagado. Problemas viários continuam vinculados à estrada e conservam a tolerância de encaixe de 30 m. Localizações de máquinas e ingestão MQTT não são filtradas nem bloqueadas pela área operacional. O raio padrão/máximo também pode ser configurado pelas variáveis `OPERATIONAL_PROXIMITY_DEFAULT_METERS` e `OPERATIONAL_PROXIMITY_MAX_METERS`, respeitando o teto do banco de 10.000 m.

## Índices sugeridos

- usuários por username/email
- máquinas por código
- telemetria por máquina e hora
- pontos GPS por máquina e hora
- localizações por rota
