# Motor de rotas operacionais

## Modelo e decisão sobre as tabelas existentes

`route_plans` e `route_locations`, definidas na migration `001_init.sql`, representam um plano associado a uma máquina e uma sequência de coordenadas. Não há código que as utilize além dos modelos SQLAlchemy nem endpoints, schemas, repositories, services ou testes ativos para elas. Essas tabelas não representam conectividade topológica nem custos de segmentos; permanecem intactas.

O grafo usa duas tabelas independentes:

- `network_nodes`: pontos `geometry(Point, 4326)`.
- `network_segments`: liga dois nós, mantém a `road_id` de origem, `geometry(LineString, 4326)`, comprimento em metros, custo base e o estado bloqueado observado no último rebuild.

A migration aditiva é `database/migrations/008_route_network.sql`. Em banco existente, aplicá-la manualmente:

```powershell
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U teledis -d teledis -f /docker-entrypoint-initdb.d/008_route_network.sql
```

## Construção e topologia

`POST /api/v1/routes/network/rebuild` reconstrói o grafo em uma transação: apaga apenas nós/segmentos derivados, noda a união das geometrias de `roads` com PostGIS (`ST_UnaryUnion` e `ST_Node`), obtém os trechos lineares resultantes, associa cada trecho à estrada original que o cobre e cria um nó em cada extremo. A união de linhas noda cruzamentos mesmo quando não há vértice desenhado no cruzamento. Extremidades ou cruzamentos geometricamente coincidentes compartilham o mesmo nó. Não há tolerância de proximidade para conectar vias: linhas próximas, mas sem interseção real, permanecem desconectadas.

Segmentos podem ser percorridos nos dois sentidos. Nenhuma direção obrigatória é inferida. Comprimento oficial e custo base são `ST_Length(geometry::geography)`; o frontend não fornece esses valores.

## Problemas e custos

Os problemas existentes de `road_problems` são associados a segmentos da mesma `road_id` quando PostGIS identifica distância geográfica inferior à tolerância configurada (`ROUTE_PROBLEM_SEGMENT_TOLERANCE_M`, padrão 1 m). Só `ABERTO` e `EM_ANALISE` participam do roteamento. `RESOLVIDO` e `INATIVO` são ignorados.

O custo base é o comprimento em metros. Um problema ativo multiplica o custo conforme a maior gravidade ativa no segmento:

| Gravidade | Fator padrão |
|---|---:|
| `BAIXA` | 1.10 |
| `MEDIA` | 1.30 |
| `ALTA` | 1.70 |
| `CRITICA` | 3.00 |

Os fatores são valores iniciais de projeto, não constantes científicas, e podem ser configurados por `ROUTE_PENALTY_LOW`, `ROUTE_PENALTY_MEDIUM`, `ROUTE_PENALTY_HIGH` e `ROUTE_PENALTY_CRITICAL`. Havendo múltiplos problemas no mesmo segmento, utiliza-se o maior fator, sem multiplicação cumulativa.

Um `VIA_BLOQUEADA` ativo torna o segmento indisponível. A associação e os custos efetivos são recalculados ao consultar/calcular uma rota; a coluna `is_blocked` no grafo registra o estado observado durante o último rebuild. Após uma mudança de geometria das estradas, o rebuild é necessário; alterações de status dos problemas são consultadas dinamicamente.

## Origem, destino e Dijkstra

O motor encontra o segmento mais próximo e projeta cada ponto na linha com PostGIS. A distância máxima de snapping é configurável por `ROUTE_SNAP_MAX_DISTANCE_M` (padrão 100 m). Distância/rota são obtidas em segmentos parcialmente percorridos entre a projeção e os nós, sem criar nós permanentes para cada consulta. Em caso de origem ou destino mais distante que o limite, a API retorna erro controlado.

O algoritmo Dijkstra fica em `backend/app/services/route_algorithm.py`, separado dos routers e dos repositories. Ele recebe o grafo e os pontos projetados, considera segmentos bidirecionais, custos determinísticos e ignora segmentos bloqueados. A resposta inclui distância percorrida, custo ponderado, IDs dos nós e segmentos percorridos, problemas ativos na rota, segmentos bloqueados presentes na rede e uma GeoJSON Feature LineString em ordem `[longitude, latitude]`.

O custo pode ser maior que a distância: é um peso comparativo para penalização de problemas, não uma unidade física de tempo ou consumo. O algoritmo não usa velocidade, carga, telemetria, previsão ou IA.

## API

- `POST /api/v1/routes/network/rebuild`: reconstrói nós e segmentos; requer o Bearer JWT existente.
- `GET /api/v1/routes/nodes`: lista nós GeoJSON.
- `GET /api/v1/routes/segments`: lista segmentos, custos e problemas ativos associados.
- `POST /api/v1/routes/calculate`: calcula rota entre coordenadas.
- `POST /api/v1/routes/machine/{machine_id}/to-structure/{structure_id}`: usa a localização mais recente de `machine_locations` e a geometria da estrutura existente.

Exemplo de cálculo entre coordenadas:

```json
{
  "origin": {"latitude": -21.0, "longitude": -50.0},
  "destination": {"latitude": -21.01, "longitude": -50.01}
}
```

Ausência de rede, pontos distantes e inexistência de caminho retornam HTTP 422 com mensagem legível. Máquina/estrutura inexistente retorna 404; máquina sem posição GPS retorna 422.

## Interface

No Mapa Operacional, **Calcular rota** permite escolher os dois pontos pelo mapa ou selecionar uma máquina e uma estrutura. O painel de planejamento também permite reconstruir a rede informando um token JWT obtido pelo login existente. A camada da rota calculada e os marcadores de origem/destino são desenhados separadamente das camadas atuais de estradas, talhões, estruturas, problemas e máquinas.

## Limitações

- A conectividade depende de cruzamentos geométricos exatos; vias próximas não são automaticamente conectadas nem existe uma tolerância de snap topológico.
- `ST_UnaryUnion` dissolve linework coincidente; quando trechos totalmente sobrepostos são atribuídos a múltiplas estradas, o rebuild escolhe deterministicamente a menor `road_id` para cada trecho dissolvido.
- O grafo é derivado e não mantém histórico de versões/rebuilds.
- A atualização de geometria de uma estrada exige rebuild; os segmentos existentes não são atualizados automaticamente.
- Não há mão única, restrições por máquina, tempo, consumo, condição dinâmica, tráfego ou histórico de navegação.
- A posição GPS da máquina e o destino estrutura são encaixados à rede de forma independente; não existe caminho off-road entre o veículo e o ponto projetado.
- Os fatores de gravidade são regras explícitas de projeto, não valores validados empiricamente.

O motor atual utiliza regras determinísticas e Dijkstra. Ele ainda não utiliza inteligência artificial.
