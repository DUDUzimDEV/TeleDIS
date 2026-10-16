# Fundação do simulador de máquinas

## Escopo desta etapa

O simulador é uma fonte controlada de telemetria sintética. Ele não contém IA,
previsões, recomendações, decisões de rota ou transições de operação. O ciclo
operacional real continua sendo responsabilidade do módulo de operações.

O código executável fica em `simulator/simulator.py`:

- `SimulatorConfig` carrega e valida as opções de conexão, máquina, intervalo e
  multiplicador;
- `AgriculturalMachine` gera amostras coerentes de telemetria;
- `SimulationState` e `SimulationEngine` controlam somente o processo local do
  simulador (`STOPPED`/`RUNNING`/`PAUSED`), não o estado operacional da máquina;
- `SimulationClock` avança o relógio simulado conforme o multiplicador;
- `MqttPublisher` publica no contrato MQTT já consumido pelo backend.

O simulador não cria uma trajetória padrão nem usa coordenadas fictícias. A cada
ciclo consulta o contexto autenticado e só se desloca quando o estado oficial
da operação indica `TRAVELING` ou o contexto indica `RETURNING_TO_BASE`. O
primeiro caso segue a rota persistida da operação até a localização real do
talhão; o segundo usa a rota calculada pelo serviço de rotas até a estrutura-base
da máquina. Estados pendentes e interrompidos não iniciam deslocamento, e a
máquina fica parada dentro do talhão, na base ou sem rota operacional
disponível. O simulador não altera o ciclo oficial da operação nem o
planejamento persistido.

Antes de cada amostra, o publisher solicita à API autenticada uma validação
PostGIS da posição candidata. Se a API recusar a posição ou estiver
indisponível, o ciclo para com erro explícito e não publica a amostra. A ingestão
revalida localizações simuladas antes de persistir. Restrições únicas parciais
no banco tornam as entregas MQTT QoS 1 idempotentes para o mesmo timestamp,
máquina e métrica; uma repetição idêntica retorna o registro existente, e um
payload diferente com a mesma identidade é registrado como conflito.

## Resolução do contexto operacional

`GET /api/v1/simulator/machines/{machine_id}/context` exige JWT, permissão
`machines.view`, fazenda ativa e o escopo da máquina permitido ao perfil. O
serviço filtra cada leitura por `farm_id` e retorna cadastro da máquina,
fazenda/área operacional, GPS mais recente, operação associada, estado oficial
e histórico de estados, talhão, rota planejada e estado calculado do simulador.

O estado oficial nunca é atualizado pelo resolver. As traduções implementadas
são:

- sem operação, posição ausente ou máquina já na base → `AT_BASE`;
- sem operação sem base configurada → `NO_BASE_CONFIGURED`;
- operação planejada/atribuída/aceita sem planejamento suficiente →
  `OPERATION_NOT_READY`;
- operação planejada/atribuída/aceita com talhão + rota + base disponíveis →
  `READY_FOR_OPERATION`;
- `INTERROMPIDA` → `PAUSED`;
- `EM_EXECUCAO` e localização dentro do talhão → `EXECUTING_OPERATION`;
- `EM_EXECUCAO`, posição fora do talhão e dentro da rota planejada (ou próxima
  do início, dentro da tolerância de conexão à rede) → `TRAVELING`;
- operação concluída/cancelada, sem operação ativa e máquina afastada da base,
  com rota de retorno disponível → `RETURNING_TO_BASE`;
- falta de localização, talhão/rota necessária ou posição sem evidência
  compatível → `ERROR`;
- operação terminal sem base registrada → `AT_BASE` quando a máquina possui base
  válida, ou `NO_BASE_CONFIGURED` quando a associação não existe.

A base operacional fica em `machines.base_structure_id` e deve apontar para uma
estrutura da mesma fazenda. A rota planejada fornece geometria GeoJSON; a rota
de retorno é calculada com o serviço de rotas existente. Sem rota, o contexto
retorna `planned_route: null`, e uma operação em execução sem evidência de
campo/rota não recebe uma classificação inventada.

`POST /api/v1/simulator/machines/{machine_id}/validate-location` aplica o mesmo
escopo JWT/RBAC e valida a posição contra a área operacional da fazenda da
máquina. O `farm_id` do corpo não é aceito. Área ausente retorna conflito;
geometria/posição inválida retorna erro de validação.

## Origem dos dados

Cada medição e posição enviada pelo simulador carrega `source: "SIMULATED"`.
Mensagens legadas sem `source` continuam sendo classificadas como `REAL`, e a
API retorna o campo para que telas e consumidores distingam as duas origens.
Valores diferentes de `REAL` e `SIMULATED` são inválidos.

A migration aditiva `database/migrations/012_telemetry_source.sql` adiciona o
campo com default `REAL` e restrição nos registros de `telemetry_readings` e
`machine_locations`. Registros já existentes não são reclassificados como
simulados. Em bancos existentes, aplique a migration sem reset:

```powershell
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U teledis -d teledis -f /docker-entrypoint-initdb.d/012_telemetry_source.sql
```

Para bancos novos, o diretório de migrations já é montado pelo Compose como
scripts de inicialização. O usuário da conexão MQTT deve ser configurado pelo
ambiente; não há credenciais no código do simulador.

Para instalações existentes, aplique também a migration
`database/migrations/014_simulated_telemetry_idempotency.sql` depois da 012 e
da 013. A migration não remove registros: ela interrompe a aplicação se
encontrar eventos simulados duplicados que impeçam a criação dos índices.

```powershell
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U teledis -d teledis -f /docker-entrypoint-initdb.d/014_simulated_telemetry_idempotency.sql
```

## Validação espacial

Localizações `SIMULATED` reutilizam `SpatialValidationService` e a geometria
`farms.operational_area` em SRID 4326. A aceitação considera o polígono e o
buffer geográfico em metros usando `farms.proximity_radius_m`; vias não são
usadas como limite de movimento. Uma fazenda sem área operacional configurada,
com geometria inválida ou com posição além do buffer não aceita a posição.
Telemetria real mantém o comportamento atual e não é sujeita a esse filtro.

Essa verificação ocorre no caminho existente MQTT → backend → banco. Nenhum
endpoint, tabela paralela de área ou gravação direta pelo simulador foi criado.
A conexão ao banco é vinculada à fazenda da máquina cadastrada. O backend não
cria uma máquina automaticamente quando recebe um ID desconhecido.

## Limites e dependências conhecidas

- O simulador de desenvolvimento usa `SIMULATOR_MACHINE_ID` (padrão compatível
  `1`); configure-o com um ID já cadastrado. O nome exibido é local e não
  altera o cadastro. A máquina precisa existir antes do envio.
- O publisher exige `SIMULATOR_API_TOKEN` e `SIMULATOR_FARM_ID`; obtém o
  contexto no endpoint autenticado antes de conectar ao broker e valida cada
  posição candidata antes de publicar a amostra. A API deve estar acessível e
  o token deve ter `machines.view` na fazenda selecionada.
- A posição inicial vem da última localização persistida da máquina ou da
  estrutura-base configurada. Sem ambas, o simulador não publica GPS e aguarda
  contexto válido; não há coordenadas padrão.
- O broker exige autenticação, mas a configuração atual compartilha a mesma
  credencial entre publisher e subscriber e não aplica ACL por fazenda/máquina.
  O campo `source` identifica a origem declarada da mensagem, não é prova
  criptográfica de identidade.
- A ingestão MQTT existente não recebe contexto JWT, fazenda ativa nem
  permissões RBAC. Antes de oferecer controle do simulador a usuários, será
  necessário isolamento de credenciais/tópicos MQTT por máquina ou um fluxo de
  autorização equivalente, sem confiar apenas em `machine_id`/`farm_id` do
  payload.
- Operações possuem `machine_id`, operador, equipe, talhão e estado; a rota da
  operação referencia `route_plans` e mantém histórico de versões. O resolver
  do simulador consome esse estado sem alterá-lo.
- `machine_assignments` associa máquina a usuário/equipe; a base operacional
  passa a ser mantida em `machines.base_structure_id` e deve apontar para uma
  estrutura da mesma fazenda. `GALPAO` é a opção preferencial quando a
  estrutura-base existir. Os tipos de estrutura continuam sendo validos na
  tabela `structures`, mas a associação é controlada por farm_id e por
  integridade na migration `013_machine_base_structure.sql`.
- A rede viária é derivada de estradas e usada pelo planejador atual, mas não
  deve limitar deslocamentos off-road nem a execução dentro de talhões.
- A classificação `TRAVELING` é evidência espacial limitada: localização
  próxima da geometria planejada e fora do talhão. Não substitui sensores de
  execução nem comprova atividade agrícola dentro do talhão.
- A idempotência depende dos índices da migration 014; aplique-a antes de
  executar uma versão nova do backend sobre um banco já existente.

## Multiplicador de tempo

`SIMULATOR_TIME_MULTIPLIER` aceita `1`, `5`, `10`, `20` ou `50` (padrão `1`).
O intervalo de publicação continua sendo definido por
`SIMULATOR_INTERVAL`; o multiplicador avança timestamp simulado, distância,
horímetro e consumo de combustível na proporção configurada. Ele não altera os
timestamps de dados reais.

## Testes

Os testes cobrem configuração e multiplicador, estado inicial do engine,
proveniência da mensagem, validação espacial da localização simulada e rejeição
de máquina não cadastrada. O runner `scripts/teledis_e2e.py` também executa um
cenário descartável contra os serviços locais reais, sem mocks:

```powershell
.\.venv\Scripts\python.exe scripts\teledis_e2e.py prepare
.\.venv\Scripts\python.exe scripts\teledis_e2e.py run
```

O ambiente precisa estar em `API_ENV=development`, com API, MQTT e PostgreSQL
PostGIS locais saudáveis e migrations 012–014 aplicadas. `prepare` reutiliza a
fazenda, estrada, talhão e usuário já existentes; cria ou reutiliza somente os
recursos marcados `E2E-TELEDIS-*`, calcula a rota pelos endpoints oficiais e
não grava telemetria diretamente. `run` prepara o cenário quando necessário,
executa os processos reais do simulador e retorna um JSON com o resultado de
cada etapa, contagens MQTT/banco e verificações negativas.

Após uma execução concluída, a operação fica em estado terminal e o cenário é
preservado para inspeção na interface. Para repetir ou remover os registros do
cenário, execute a limpeza somente quando desejar descartá-los:

```powershell
.\.venv\Scripts\python.exe scripts\teledis_e2e.py cleanup --confirm
```

A limpeza exige essa confirmação explícita e remove apenas os recursos e dados
identificados pelo cenário E2E; fazenda, usuários, RBAC, estradas, talhões e
logs de auditoria são preservados.

Na execução de referência em desenvolvimento, a máquina A percorreu a rota
persistida de 1.051,71 m até o talhão e retornou à base. Foram capturados 232
eventos MQTT; persistiram 38 localizações e 191 leituras simuladas nas duas
máquinas. A rota manteve desvio máximo medido de 0,066 m. A pausa impediu
movimento, a segunda instância da máquina A foi bloqueada, a parada da máquina
B cessou novas localizações, a reentrega QoS 1 manteve uma única medição, uma
localização fora da área recebeu HTTP 422 e o pedido com fazenda alheia recebeu
HTTP 403. O estado final da operação foi `CONCLUIDA` e o simulador terminou em
`AT_BASE`.

O contrato broker → backend também é coberto pelos testes de ingestão
existentes. A configuração de usuário/ACL por máquina continua pendente.
