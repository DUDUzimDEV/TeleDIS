# Ciclo operacional: roteiro de validação

## Pré-requisitos

- Backend, frontend, PostgreSQL/PostGIS e rede de estradas da fazenda ativos.
- Usuário autenticado com fazenda ativa e permissões compatíveis com a ação.
- Talhão cadastrado, máquina ativa com posição GPS recente, e equipe contendo operador e supervisor vinculados à mesma fazenda.
- Para testar o perfil de operador, a máquina da operação também deve ser a máquina atribuída ao vínculo do operador naquela fazenda.

Não é necessário criar dados de demonstração para abrir as telas. A API retorna estados vazios até que o fluxo oficial cadastre dados operacionais.

## Planejar e atribuir

1. Entre com um coordenador, administrador ou proprietário e confirme a fazenda ativa no topo.
2. Acesse **Equipes** e confirme uma equipe com operador e supervisor membros.
3. Em **Operações**, crie uma operação usando um talhão existente.
4. Atribua a máquina ativa, o operador e a equipe.
5. Calcule a rota Dijkstra. Se não houver rede conectada entre a posição da máquina e o destino operacional, a API deve informar o erro sem salvar uma rota bem-sucedida.
6. Abra **Abrir detalhe completo** ou diretamente `/operacoes/{id}`. Confira estado, equipe, máquina, rota planejada, talhão, estradas e problemas abertos visíveis àquele perfil.

## Executar como operador

1. Entre com o operador associado à máquina e à operação.
2. Em **Minha Operação**, aceite a atribuição e inicie a execução.
3. Confirme que o detalhe mostra rota planejada e que a linha GPS passa a atualizar enquanto a operação está em execução.
4. Registre uma ocorrência permitida (problema na via, máquina, parada, desvio ou outra); confira-a na timeline do detalhe.
5. Teste **Informar parada** e depois **Retomar operação**. Uma operação concluída não deve voltar a executar.
6. Finalize a operação e confira o histórico de estados, versões de rota e ocorrências no detalhe, além dos totais do Dashboard.

Uma ocorrência só pode ser registrada durante uma operação em execução ou interrompida. Cancelamento é permitido para estados planejado, atribuído, aceito e interrompido, sujeito à permissão do perfil ou ao vínculo de operador.

## Métricas e limites

- A distância realizada é o comprimento geodésico (PostGIS `geography`) da trilha GPS no intervalo da operação.
- Cada amostra é comparada à linha da última rota planejada. A aderência é a proporção de amostras dentro de `ROUTE_DEVIATION_TOLERANCE_METERS` (padrão: 25 m); também são retornados quantidade de pontos fora da tolerância e desvio máximo.
- A trajetória desenhada no mapa usa no máximo 1.500 pontos distribuídos ao longo do percurso; as métricas usam todas as amostras encontradas no intervalo.
- Com uma amostra é possível exibir a posição e calcular aderência se houver rota, mas não distância percorrida. Sem rota ou amostras, a interface declara dados insuficientes em vez de inventar valores.
- `machine_locations` não fornece velocidade nem direção por amostra. A telemetria geral pode exibir leituras disponíveis separadamente; não deve ser apresentada como velocidade GPS sincronizada com cada ponto.
- Ocorrências operacionais registradas não possuem estado aberto/resolvido. O Dashboard conta registros, não os rotula como ocorrências abertas.

## Isolamento e validação automatizada

As consultas e gravações usam a fazenda ativa do JWT/contexto e verificam a visibilidade da operação no backend. Para executar o teste integrado que cria dados, configure `TELEDIS_REAL_DB_TESTS=1` somente apontando `DATABASE_URL` para um banco PostgreSQL/PostGIS isolado. O teste integrado não deve ser habilitado contra o banco de desenvolvimento compartilhado ou produção.
