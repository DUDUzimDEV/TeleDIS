import React, { useMemo } from 'react';
import { Activity, AlertTriangle, CalendarDays, Clock3, MapPinned, Route, Tractor } from 'lucide-react';
import { Link } from 'react-router-dom';

import EntityMap from '../components/map/EntityMap';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime } from '../utils/geoData';

const asList = (value) => Array.isArray(value) ? value : [];
const normalizeStatus = (value) => String(value || '').toLowerCase();
const isActiveMachine = (machine) => /ativo|active|operando/.test(normalizeStatus(machine.status));

export default function DashboardPage() {
  const { activeFarmId, can, role } = useAuth();
  const machinesResource = useApiResource('/api/v1/machines', 0, { enabled: can('machines.view') });
  const locationsResource = useApiResource('/api/v1/locations', 0, { enabled: can('machines.view') });
  const fieldsResource = useApiResource('/api/v1/fields', 0, { enabled: can('fields.view') });
  const structuresResource = useApiResource('/api/v1/structures', 0, { enabled: can('structures.view') });
  const roadsResource = useApiResource('/api/v1/roads', 0, { enabled: can('roads.view') });
  const problemsResource = useApiResource('/api/v1/road-problems', 0, { enabled: can('road_problems.view') });
  const telemetryResource = useApiResource('/api/v1/telemetry', 0, { enabled: can('telemetry.view') });
  const routeSegmentsResource = useApiResource('/api/v1/routes/segments', 0, { enabled: can('routes.view') });
  const operationsSummaryResource = useApiResource(
    '/api/v1/operations/summary',
    0,
    { enabled: can('operations.view') },
  );
  const operationalAreaResource = useApiResource(
    activeFarmId ? `/api/v1/farms/${activeFarmId}/operational-area` : '',
    0,
    { enabled: Boolean(activeFarmId && can('farm.view') && can('farm.update')) },
  );

  const machines = asList(machinesResource.data);
  const locations = asList(locationsResource.data);
  const fields = asList(fieldsResource.data);
  const structures = asList(structuresResource.data);
  const roads = asList(roadsResource.data);
  const problems = asList(problemsResource.data);
  const telemetry = asList(telemetryResource.data);
  const routeSegments = asList(routeSegmentsResource.data);

  const latestLocations = useMemo(() => {
    const latestByMachine = new Map();
    [...locations]
      .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
      .forEach((location) => {
        if (!latestByMachine.has(location.maquina_id)) {
          const machine = machines.find((item) => item.id === location.maquina_id);
          latestByMachine.set(location.maquina_id, {
            ...location,
            nome: machine?.nome,
            status: machine?.status,
          });
        }
      });
    return [...latestByMachine.values()];
  }, [locations, machines]);

  const openProblems = problems.filter((problem) => !['RESOLVIDO', 'INATIVO'].includes(problem.status));
  const stoppedMachines = machines.filter((machine) => !isActiveMachine(machine));
  const activity = useMemo(() => {
    const telemetryEvents = telemetry.map((reading) => ({
      id: `telemetry-${reading.id}`,
      at: reading.timestamp,
      title: `${reading.metric || 'Telemetria'} recebida`,
      detail: `Máquina ${reading.maquina_id}: ${reading.valor ?? '—'} ${reading.unidade || ''}`.trim(),
      kind: 'telemetry',
    }));
    const problemEvents = problems.map((problem) => ({
      id: `problem-${problem.id}`,
      at: problem.created_at,
      title: 'Problema viário registrado',
      detail: `${problem.road_nome || `Estrada ${problem.road_id}`} · ${problem.tipo} · ${problem.gravidade}`,
      kind: 'problem',
    }));
    const locationEvents = latestLocations.map((location) => ({
      id: `location-${location.id}`,
      at: location.timestamp,
      title: 'Localização recebida',
      detail: `${location.nome || `Máquina ${location.maquina_id}`} · ${location.latitude}, ${location.longitude}`,
      kind: 'location',
    }));
    return [...telemetryEvents, ...problemEvents, ...locationEvents]
      .filter((event) => event.at)
      .sort((left, right) => new Date(right.at) - new Date(left.at))
      .slice(0, 8);
  }, [latestLocations, problems, telemetry]);

  const hasMapData = fields.length + structures.length + roads.length + problems.length + latestLocations.length > 0;
  const hasMapAccess = can('fields.view') || can('structures.view') || can('roads.view');
  const visibleResources = [
    can('machines.view') && machinesResource,
    can('machines.view') && locationsResource,
    can('fields.view') && fieldsResource,
    can('structures.view') && structuresResource,
    can('roads.view') && roadsResource,
    can('road_problems.view') && problemsResource,
    can('telemetry.view') && telemetryResource,
    can('routes.view') && routeSegmentsResource,
    can('operations.view') && operationsSummaryResource,
  ].filter(Boolean);
  const loading = visibleResources.some((resource) => resource.loading);
  const errors = [
    ['machines', machinesResource],
    ['locations', locationsResource],
    ['fields', fieldsResource],
    ['structures', structuresResource],
    ['roads', roadsResource],
    ['problems', problemsResource],
    ['route-segments', routeSegmentsResource],
  ].filter(([name, resource]) => resource.error && (
    (name === 'machines' && can('machines.view'))
    || (name === 'locations' && can('machines.view'))
    || (name === 'fields' && can('fields.view'))
    || (name === 'structures' && can('structures.view'))
    || (name === 'roads' && can('roads.view'))
    || (name === 'problems' && can('road_problems.view'))
    || (name === 'route-segments' && can('routes.view'))
  ));
  const lastUpdated = activity[0]?.at;
  const now = new Date();
  const dashboardContent = {
    OWNER: ['Visão geral da fazenda', 'Panorama dos ativos, operações e ocorrências da fazenda ativa.'],
    FARM_ADMIN: ['Administração da fazenda', 'Acompanhe recursos, acessos e a situação operacional desta fazenda.'],
    COORDINATOR: ['Gestão da operação', 'Máquinas, rotas, problemas viários e atividade operacional.'],
    SUPERVISOR: ['Acompanhamento de campo', 'Situação das máquinas e ocorrências informadas na operação.'],
    TECHNICIAN: ['Painel técnico', 'Frota e leituras de telemetria disponíveis para análise técnica.'],
    ANALYST: ['Indicadores e visualização', 'Dados operacionais e geográficos disponíveis em modo de consulta.'],
  }[role] || ['Visão operacional', 'Resumo dos dados operacionais disponíveis nas APIs do TeleDis.'];

  return (
    <div className="dashboard-screen">
      <PageHeading
        eyebrow="Centro de comando"
        title={dashboardContent[0]}
        description={dashboardContent[1]}
        className="dashboard-heading"
        actions={
          <div className="dashboard-dateline">
            <span><CalendarDays size={15} />{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(now)}</span>
            <span><Clock3 size={15} />Dados: {formatDateTime(lastUpdated)}</span>
          </div>
        }
      />

      {errors.map(([resourceName, resource]) => <ErrorState key={resourceName} message={resource.error} onRetry={resource.reload} />)}
      {loading ? <LoadingState label="Consultando operação..." /> : null}
      {can('farm.update') && !operationalAreaResource.loading && !operationalAreaResource.error
        && operationalAreaResource.data && !operationalAreaResource.data.configured ? (
          <div className="operational-area-notice dashboard-area-notice" role="status">
            <span>Configure a área operacional para validar talhões, estruturas e estradas desta fazenda.</span>
            <Link to={`/fazendas/${activeFarmId}/area-operacional`}>Configurar área</Link>
          </div>
        ) : null}

      <section className={`command-metrics dashboard-role-${String(role || '').toLowerCase()}`} aria-label="Indicadores operacionais">
        <article className="command-metric metric-machines">
          <span className="metric-icon"><Tractor size={19} /></span>
          <span className="metric-caption">{role === 'TECHNICIAN' ? 'Máquinas acompanhadas' : 'Máquinas em operação'}</span>
          <strong>{machinesResource.loading ? '—' : machines.filter(isActiveMachine).length}</strong>
          <small>{machinesResource.loading ? 'Carregando frota' : `${machines.length} cadastradas`}</small>
        </article>
        {can('telemetry.view') ? <article className="command-metric metric-stopped">
          <span className="metric-icon"><AlertTriangle size={19} /></span>
          <span className="metric-caption">Leituras recentes</span>
          <strong>{telemetryResource.loading ? '—' : telemetry.length}</strong>
          <small>Telemetria retornada pela API</small>
        </article> : null}
        {can('road_problems.view') ? <article className="command-metric metric-problems">
          <span className="metric-icon"><MapPinned size={19} /></span>
          <span className="metric-caption">Problemas viários abertos</span>
          <strong>{problemsResource.loading ? '—' : openProblems.length}</strong>
          <small>{problemsResource.loading ? 'Carregando ocorrências' : `${problems.length} registros no total`}</small>
        </article> : null}
        {can('machines.view') && !can('telemetry.view') ? <article className="command-metric metric-stopped">
          <span className="metric-icon"><AlertTriangle size={19} /></span>
          <span className="metric-caption">Máquinas fora de operação</span>
          <strong>{machinesResource.loading ? '—' : stoppedMachines.length}</strong>
          <small>Conforme status informado pela API</small>
        </article> : null}
        {can('routes.view') ? <article className="command-metric metric-routes">
          <span className="metric-icon"><Route size={19} /></span>
          <span className="metric-caption">Trechos viários</span>
          <strong>{routeSegmentsResource.loading ? '—' : routeSegments.length}</strong>
          <small>Rede consultada · não representa viagens em andamento</small>
        </article> : null}
      </section>

      {can('operations.view') ? (
        <section className="operation-dashboard-panel" aria-label="Indicadores das operações">
          <header className="section-heading">
            <div><span className="section-overline">Ciclo operacional</span><h2>Operações da fazenda</h2></div>
            <Link to="/operacoes" className="text-link">Abrir operações</Link>
          </header>
          {operationsSummaryResource.error ? <ErrorState message={operationsSummaryResource.error} onRetry={operationsSummaryResource.reload} /> : null}
          {operationsSummaryResource.loading ? <LoadingState label="Consultando operações..." /> : null}
          {!operationsSummaryResource.loading && !operationsSummaryResource.error ? (
            <div className="operation-dashboard-metrics">
              <article><span>Em execução</span><strong>{operationsSummaryResource.data?.operations_by_status?.EM_EXECUCAO ?? 0}</strong></article>
              <article><span>Atribuídas</span><strong>{operationsSummaryResource.data?.operations_by_status?.ATRIBUIDA ?? 0}</strong></article>
              <article><span>Interrompidas</span><strong>{operationsSummaryResource.data?.operations_by_status?.INTERROMPIDA ?? 0}</strong></article>
              <article><span>Máquinas em operações ativas</span><strong>{operationsSummaryResource.data?.machines_in_active_operations ?? 0}</strong></article>
              {operationsSummaryResource.data?.occurrences_recorded != null ? (
                <article><span>Ocorrências registradas</span><strong>{operationsSummaryResource.data.occurrences_recorded}</strong></article>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {hasMapAccess ? <section className="command-main">
        <article className="command-map-panel">
          <header className="section-heading">
            <div>
              <span className="section-overline">Território</span>
              <h2>Mapa da operação</h2>
            </div>
            {can('fields.view') ? <Link to="/mapa" className="text-link">Abrir mapa completo</Link> : null}
          </header>
          {hasMapData ? (
            <EntityMap
              fields={fields}
              structures={structures}
              roads={roads}
              roadProblems={problems}
              machines={latestLocations}
              visibleLayers={{ fields: true, structures: true, roads: true, problems: true, machines: true }}
            />
          ) : !loading ? (
            <EmptyState title="Sem dados geográficos" description="O mapa será exibido quando houver entidades cadastradas." icon={MapPinned} />
          ) : null}
          <div className="map-legend" aria-label="Legenda do mapa">
            <span><i className="legend-dot legend-machine" />Máquinas</span>
            <span><i className="legend-dot legend-field" />Talhões</span>
            <span><i className="legend-dot legend-problem" />Problemas</span>
            <span><i className="legend-line" />Estradas</span>
          </div>
        </article>

        <aside className="situation-panel">
          <header className="section-heading">
            <div>
              <span className="section-overline">Acompanhamento</span>
              <h2>Situação operacional</h2>
            </div>
          </header>
          <div className="situation-list">
            {stoppedMachines.map((machine) => (
              <div className="situation-row" key={`machine-${machine.id}`}>
                <span className="situation-mark warning-mark"><Tractor size={16} /></span>
                <div><strong>{machine.nome || `Máquina ${machine.id}`}</strong><small>Frota · {machine.tipo || 'Tipo não informado'}</small></div>
                <StatusBadge>{machine.status}</StatusBadge>
              </div>
            ))}
            {openProblems.map((problem) => (
              <div className="situation-row" key={`problem-${problem.id}`}>
                <span className="situation-mark danger-mark"><AlertTriangle size={16} /></span>
                <div><strong>{problem.road_nome || `Estrada ${problem.road_id}`}</strong><small>{problem.tipo} · {problem.gravidade}</small></div>
                <StatusBadge>{problem.status}</StatusBadge>
              </div>
            ))}
            {!machinesResource.loading && !problemsResource.loading && !stoppedMachines.length && !openProblems.length ? (
              <EmptyState title="Sem ocorrências abertas" description="Nenhum problema ou máquina fora de operação retornado pelas APIs." />
            ) : null}
          </div>
          {can('fields.view') || can('structures.view') || can('routes.view') ? <div className="network-summary">
            {can('fields.view') ? <div><span>Talhões</span><strong>{fieldsResource.loading ? '—' : fields.length}</strong></div> : null}
            {can('structures.view') ? <div><span>Estruturas</span><strong>{structuresResource.loading ? '—' : structures.length}</strong></div> : null}
            {can('routes.view') ? <div><span>Trechos de rede</span><strong>{routeSegmentsResource.loading ? '—' : routeSegments.length}</strong></div> : null}
          </div> : null}
        </aside>
      </section> : null}

      <section className="activity-panel">
        <header className="section-heading">
          <div>
            <span className="section-overline">Registro recebido</span>
            <h2>Atividade recente</h2>
          </div>
          <Activity size={19} aria-hidden="true" />
        </header>
        {telemetryResource.error ? <ErrorState message={telemetryResource.error} onRetry={telemetryResource.reload} /> : null}
        {activity.length ? (
          <ol className="activity-timeline">
            {activity.map((event) => (
              <li key={event.id} className={`activity-event event-${event.kind}`}>
                <span className="activity-marker" />
                <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                <div><strong>{event.title}</strong><span>{event.detail}</span></div>
              </li>
            ))}
          </ol>
        ) : !telemetryResource.loading && !loading ? (
          <EmptyState title="Sem atividade recente" description="As APIs não retornaram leituras ou ocorrências com data para compor a linha do tempo." icon={Activity} />
        ) : null}
      </section>
    </div>
  );
}
