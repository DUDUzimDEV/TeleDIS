import React, { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Clock3,
  MapPinned,
  RadioTower,
  Route,
  Tractor,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import EntityMap from '../components/map/EntityMap';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime } from '../utils/geoData';
import { getCommunicationStatus, getLatestTimestamp } from '../utils/liveStatus';

const asList = (value) => Array.isArray(value) ? value : [];
const normalizeStatus = (value) => String(value || '').toUpperCase();
const activeOperationStatuses = new Set(['ATRIBUIDA', 'ACEITA', 'EM_EXECUCAO', 'INTERROMPIDA']);
const isActiveMachine = (machine) => /ativo|active|operando/i.test(String(machine.status || ''));
const openProblemStatuses = new Set(['RESOLVIDO', 'INATIVO']);
const severityOrder = { CRITICA: 0, CRÍTICA: 0, ALTA: 1, MEDIA: 2, MÉDIA: 2, BAIXA: 3 };
const LIVE_REFRESH_INTERVAL_MS = 5000;

function greetingForHour(hour) {
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function MetricCard({ icon: Icon, label, value, detail, href, tone = 'green', loading, error }) {
  const content = (
    <>
      <span className={`dashboard-metric-icon tone-${tone}`}><Icon size={19} aria-hidden="true" /></span>
      <span className="dashboard-metric-label">{label}</span>
      <strong className="dashboard-metric-value">{loading || error ? '—' : value}</strong>
      <span className="dashboard-metric-detail">
        {error ? 'Dados indisponíveis' : loading ? 'Consultando fonte operacional' : detail}
      </span>
      {href ? <ArrowRight className="dashboard-metric-arrow" size={16} aria-hidden="true" /> : null}
    </>
  );

  return href ? (
    <Link className="dashboard-metric-card" to={href} aria-label={`${label}: ${loading || error ? 'dados indisponíveis' : value}`}>
      {content}
    </Link>
  ) : (
    <article className="dashboard-metric-card">{content}</article>
  );
}

function SectionHeader({ eyebrow, title, link, linkLabel }) {
  return (
    <header className="dashboard-section-heading">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {link ? <Link className="dashboard-section-link" to={link}>{linkLabel}<ArrowRight size={15} aria-hidden="true" /></Link> : null}
    </header>
  );
}

export default function DashboardPage() {
  const { activeFarm, activeFarmId, can, role, user } = useAuth();
  const machinesResource = useApiResource('/api/v1/machines', 0, {
    enabled: can('machines.view'),
    pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
  });
  const locationsResource = useApiResource('/api/v1/locations?limit=1000', 0, {
    enabled: can('machines.view'),
    pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
  });
  const fieldsResource = useApiResource('/api/v1/fields', 0, { enabled: can('fields.view') });
  const structuresResource = useApiResource('/api/v1/structures', 0, { enabled: can('structures.view') });
  const roadsResource = useApiResource('/api/v1/roads', 0, { enabled: can('roads.view') });
  const problemsResource = useApiResource('/api/v1/road-problems', 0, { enabled: can('road_problems.view') });
  const telemetryResource = useApiResource('/api/v1/telemetry', 0, {
    enabled: can('telemetry.view'),
    pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
  });
  const operationsResource = useApiResource('/api/v1/operations', 0, {
    enabled: can('operations.view'),
    pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
  });
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
  const operations = asList(operationsResource.data);

  const latestLocations = useMemo(() => {
    const latestByMachine = new Map();
    [...locations]
      .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
      .forEach((location) => {
        const machineKey = String(location.maquina_id);
        if (!latestByMachine.has(machineKey)) {
          const machine = machines.find((item) => String(item.id) === machineKey);
          latestByMachine.set(machineKey, {
            ...location,
            nome: machine?.nome,
            code: machine?.code,
            status: machine?.status,
          });
        }
      });
    return [...latestByMachine.values()];
  }, [locations, machines]);

  const operationsInProgress = operations.filter(
    (operation) => normalizeStatus(operation.status) === 'EM_EXECUCAO',
  );
  const activeOperations = operations.filter(
    (operation) => activeOperationStatuses.has(normalizeStatus(operation.status)),
  );
  const leadOperation = activeOperations.find((operation) => (
    operation.machine_id != null
    && ['EM_EXECUCAO', 'INTERROMPIDA'].includes(normalizeStatus(operation.status))
  ));
  const leadOperationContextResource = useApiResource(
    leadOperation?.machine_id
      ? `/api/v1/simulator/machines/${leadOperation.machine_id}/context`
      : '',
    0,
    {
      enabled: Boolean(leadOperation?.machine_id && can('machines.view')),
      pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
    },
  );
  const communicationByMachine = new Map(machines.map((machine) => {
    const location = latestLocations.find((item) => String(item.maquina_id) === String(machine.id));
    const reading = telemetry
      .filter((item) => String(item.maquina_id) === String(machine.id))
      .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0];
    const timestamp = getLatestTimestamp(location?.timestamp, reading?.timestamp);
    const locationTimestamp = getLatestTimestamp(location?.timestamp);
    return [String(machine.id), {
      status: getCommunicationStatus(timestamp),
      timestamp,
      source: (timestamp === locationTimestamp ? location?.source : reading?.source)
        || reading?.source
        || location?.source,
    }];
  }));
  const communicationCounts = [...communicationByMachine.values()].reduce((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, {});
  const openProblems = problems
    .filter((problem) => !openProblemStatuses.has(normalizeStatus(problem.status)))
    .sort((left, right) => (
      (severityOrder[normalizeStatus(left.gravidade)] ?? 4)
      - (severityOrder[normalizeStatus(right.gravidade)] ?? 4)
    ));

  const recentActivity = useMemo(() => {
    const telemetryEvents = telemetry.map((reading) => ({
      id: `telemetry-${reading.id}`,
      at: reading.timestamp,
      title: /alert|alarme/i.test(String(reading.metric || ''))
        ? 'Sinal de alerta recebido'
        : 'Leitura de telemetria recebida',
      detail: `Máquina ${reading.maquina_id} · ${reading.metric || 'Leitura'} · ${reading.valor ?? '—'} ${reading.unidade || ''}`.trim(),
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
    const operationEvents = [...operations]
      .filter((operation) => operation.updated_at)
      .sort((left, right) => new Date(right.updated_at) - new Date(left.updated_at))
      .slice(0, 5)
      .map((operation) => ({
        id: `operation-${operation.id}`,
        at: operation.updated_at,
        title: 'Operação atualizada',
        detail: `${operation.name || operation.code} · ${operation.status}`,
        kind: 'operation',
      }));

    return [...telemetryEvents, ...problemEvents, ...locationEvents, ...operationEvents]
      .filter((event) => event.at)
      .sort((left, right) => new Date(right.at) - new Date(left.at))
      .slice(0, 6);
  }, [latestLocations, operations, problems, telemetry]);

  const now = new Date();
  const userName = user?.full_name || user?.username || 'equipe';
  const firstName = userName.split(/\s+/)[0];
  const hasMapAccess = can('fields.view') || can('structures.view') || can('roads.view')
    || can('road_problems.view') || can('machines.view');
  const hasMapData = fields.length + structures.length + roads.length + problems.length
    + latestLocations.length > 0;
  const latestActivity = recentActivity[0]?.at;
  const operationStatusText = can('operations.view')
    ? operationsResource.loading
      ? 'Consultando as operações da fazenda.'
      : operationsResource.error
        ? 'O estado das operações não está disponível.'
        : operationsInProgress.length
          ? `${operationsInProgress.length} operação${operationsInProgress.length === 1 ? '' : 'ões'} em execução agora.`
          : 'Nenhuma operação em execução no momento.'
    : 'Acompanhe os ativos e ocorrências da fazenda selecionada.';
  const operationByMachine = new Map(
    activeOperations
      .filter((operation) => operation.machine_id != null)
      .map((operation) => [String(operation.machine_id), operation]),
  );

  const metrics = [
    can('machines.view') && {
      icon: Tractor,
      label: 'Máquinas',
      value: machines.length,
      detail: machines.length
        ? `${machines.filter(isActiveMachine).length} com status ativo`
        : 'Nenhuma máquina cadastrada',
      href: role === 'OPERATOR' ? '/minha-maquina' : '/maquinas',
      tone: 'green',
      loading: machinesResource.loading,
      error: machinesResource.error,
    },
    can('machines.view') && {
      icon: RadioTower,
      label: 'Máquinas online',
      value: communicationCounts.ONLINE || 0,
      detail: `${communicationCounts.STALE || 0} desatualizadas · ${communicationCounts.NO_DATA || 0} sem dados`,
      href: '/mapa',
      tone: 'blue',
      loading: machinesResource.loading || locationsResource.loading,
      error: machinesResource.error || locationsResource.error,
    },
    can('operations.view') && {
      icon: ClipboardList,
      label: 'Operações em execução',
      value: operationsInProgress.length,
      detail: operations.length ? `${operations.length} operações visíveis nesta fazenda` : 'Nenhuma operação cadastrada',
      href: '/operacoes',
      tone: 'blue',
      loading: operationsResource.loading,
      error: operationsResource.error,
    },
    can('road_problems.view') && {
      icon: AlertTriangle,
      label: 'Ocorrências em vias',
      value: openProblems.length,
      detail: openProblems.length ? 'Registros não resolvidos' : 'Nenhuma ocorrência aberta',
      href: '/problemas-vias',
      tone: openProblems.some((problem) => /critica|crítica|alta/i.test(problem.gravidade)) ? 'red' : 'amber',
      loading: problemsResource.loading,
      error: problemsResource.error,
    },
    can('telemetry.view') && {
      icon: RadioTower,
      label: 'Leituras recentes',
      value: telemetry.length,
      detail: 'Registros retornados pela API de telemetria',
      href: '/alertas',
      tone: 'violet',
      loading: telemetryResource.loading,
      error: telemetryResource.error,
    },
  ].filter(Boolean);

  return (
    <div className="dashboard-screen dashboard-command-center">
      <PageHeading
        eyebrow="CENTRO DE OPERAÇÃO"
        title={`${greetingForHour(now.getHours())}, ${firstName}.`}
        description={`Visão operacional da ${activeFarm?.name || 'fazenda selecionada'}`}
        className="dashboard-heading dashboard-welcome"
        actions={(
          <div className="dashboard-context-meta">
            <span><CalendarDays size={15} aria-hidden="true" />{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(now)}</span>
            <span><Clock3 size={15} aria-hidden="true" />Atualizado {formatDateTime(latestActivity)}</span>
          </div>
        )}
      />

      <section className="dashboard-operation-status" aria-label="Estado atual da operação">
        <span className={`dashboard-operation-pulse${operationsInProgress.length ? ' is-running' : ''}`} />
        <div>
          <strong>{activeFarm?.name || 'Contexto de fazenda'}</strong>
          <span>{operationStatusText}</span>
        </div>
        {can('operations.view') ? <Link to="/operacoes">Acompanhar operações<ArrowRight size={15} aria-hidden="true" /></Link> : null}
      </section>

      {can('farm.update') && !operationalAreaResource.loading && !operationalAreaResource.error
        && operationalAreaResource.data && !operationalAreaResource.data.configured ? (
          <div className="operational-area-notice dashboard-area-notice" role="status">
            <span>Configure a área operacional para validar talhões, estruturas e estradas desta fazenda.</span>
            <Link to={`/fazendas/${activeFarmId}/area-operacional`}>Configurar área</Link>
          </div>
        ) : null}
      {can('farm.update') && operationalAreaResource.error ? (
        <ErrorState message="Não foi possível verificar a área operacional desta fazenda." onRetry={operationalAreaResource.reload} />
      ) : null}

      {metrics.length ? (
        <section className="dashboard-metrics-grid" aria-label="Indicadores da fazenda ativa">
          {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
        </section>
      ) : (
        <section className="dashboard-no-metrics">
          <p>Seu perfil não possui permissão para visualizar indicadores operacionais nesta fazenda.</p>
        </section>
      )}

      <section className="dashboard-work-grid">
        {can('operations.view') ? (
          <article className="dashboard-panel dashboard-operations-panel">
            <SectionHeader eyebrow="CICLO OPERACIONAL" title="Operações em andamento" link="/operacoes" linkLabel="Ver operações" />
            {operationsResource.error ? <ErrorState message="Não foi possível carregar as operações." onRetry={operationsResource.reload} /> : null}
            {leadOperationContextResource.error ? (
              <ErrorState message={leadOperationContextResource.error} onRetry={leadOperationContextResource.reload} />
            ) : null}
            {operationsResource.loading ? <LoadingState label="Consultando operações da fazenda..." /> : null}
            {!operationsResource.loading && !operationsResource.error && activeOperations.length ? (
              <div className="dashboard-operation-list">
                {activeOperations.slice(0, 5).map((operation) => (
                  <Link className="dashboard-operation-row" key={operation.id} to={`/operacoes/${operation.id}`}>
                    <span className="dashboard-row-icon"><ClipboardList size={17} aria-hidden="true" /></span>
                    <span className="dashboard-row-main">
                      <strong>{operation.name || operation.code}</strong>
                      <small>
                        {[operation.machine_name, operation.operator_name || operation.team_name, operation.field_name]
                          .filter(Boolean).join(' · ') || 'Máquina, equipe ou talhão não associado'}
                      </small>
                    </span>
                    <span className="dashboard-row-meta">
                      <StatusBadge>{operation.status.replaceAll('_', ' ')}</StatusBadge>
                      {String(operation.id) === String(leadOperation?.id)
                        && leadOperationContextResource.data?.route_progress != null
                        && Number.isFinite(Number(leadOperationContextResource.data?.route_progress))
                        ? <small>Rota: {Math.max(0, Math.min(100, Number(leadOperationContextResource.data.route_progress) * 100)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</small>
                        : null}
                      <small>{formatDateTime(operation.started_at || operation.scheduled_start)}</small>
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
            {!operationsResource.loading && !operationsResource.error && !activeOperations.length ? (
              <EmptyState
                title="Nenhuma operação em andamento"
                description={operations.length
                  ? 'Não há operações atribuídas, aceitas, em execução ou interrompidas nesta fazenda.'
                  : 'Ainda não há operações cadastradas para esta fazenda.'}
                icon={ClipboardList}
              />
            ) : null}
          </article>
        ) : null}

        {can('machines.view') ? (
          <article className="dashboard-panel dashboard-machines-panel">
            <SectionHeader eyebrow="FROTA" title="Máquinas" link={role === 'OPERATOR' ? '/minha-maquina' : '/maquinas'} linkLabel="Ver máquinas" />
            {machinesResource.error ? <ErrorState message="Não foi possível carregar a frota." onRetry={machinesResource.reload} /> : null}
            {machinesResource.loading ? <LoadingState label="Consultando máquinas..." /> : null}
            {!machinesResource.loading && !machinesResource.error && machines.length ? (
              <div className="dashboard-machine-list">
                {machines.slice(0, 5).map((machine) => {
                  const location = latestLocations.find((item) => String(item.maquina_id) === String(machine.id));
                  const operation = operationByMachine.get(String(machine.id));
                  const communication = communicationByMachine.get(String(machine.id));
                  return (
                    <div className="dashboard-machine-row" key={machine.id}>
                      <span className="dashboard-row-icon"><Tractor size={17} aria-hidden="true" /></span>
                      <span className="dashboard-row-main">
                        <strong>{machine.nome || `Máquina ${machine.id}`}</strong>
                        <small>{machine.code || machine.tipo || `ID ${machine.id}`}</small>
                      </span>
                      <span className="dashboard-row-meta">
                        <StatusBadge>{machine.status}</StatusBadge>
                        <StatusBadge tone={communication?.status === 'ONLINE' ? 'success' : communication?.status === 'STALE' ? 'warning' : 'neutral'}>
                          {communication?.status === 'ONLINE' ? 'ONLINE' : communication?.status === 'STALE' ? 'DESATUALIZADA' : 'SEM DADOS'}
                        </StatusBadge>
                        <small>{operation?.name || 'Sem operação associada'}</small>
                        <small>
                          {communication?.timestamp ? formatDateTime(communication.timestamp) : 'Sem atualização registrada'}
                          {communication?.source ? ` · ${communication.source === 'SIMULATED' ? 'DADO SIMULADO' : 'DADO REAL'}` : ''}
                        </small>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {!machinesResource.loading && !machinesResource.error && !machines.length ? (
              <EmptyState
                title="Nenhuma máquina cadastrada"
                description={can('machines.create') ? 'Cadastre a primeira máquina para começar a acompanhar a frota.' : 'Não há máquinas disponíveis nesta fazenda.'}
                icon={Tractor}
              />
            ) : null}
          </article>
        ) : null}
      </section>

      <section className="dashboard-detail-grid">
        {hasMapAccess ? (
          <article className="dashboard-panel dashboard-map-panel">
            <SectionHeader
              eyebrow="TERRITÓRIO"
              title="Mapa operacional"
              link={can('fields.view') ? '/mapa' : null}
              linkLabel="Abrir mapa"
            />
            {[
              ['machines', machinesResource],
              ['locations', locationsResource],
              ['fields', fieldsResource],
              ['structures', structuresResource],
              ['roads', roadsResource],
              ['problems', problemsResource],
            ].filter(([key]) => (
              (['machines', 'locations'].includes(key) && can('machines.view'))
              || (key === 'fields' && can('fields.view'))
              || (key === 'structures' && can('structures.view'))
              || (key === 'roads' && can('roads.view'))
              || (key === 'problems' && can('road_problems.view'))
            )).map(([key, resource]) => (
              resource.error ? <ErrorState key={key} message="Não foi possível carregar uma camada do mapa." onRetry={resource.reload} /> : null
            ))}
            {hasMapData ? (
              <EntityMap
                fields={fields}
                structures={structures}
                roads={roads}
                roadProblems={problems}
                machines={latestLocations}
                visibleLayers={{
                  fields: can('fields.view'),
                  structures: can('structures.view'),
                  roads: can('roads.view'),
                  problems: can('road_problems.view'),
                  machines: can('machines.view'),
                }}
                className="dashboard-entity-map"
              />
            ) : machinesResource.loading || locationsResource.loading || fieldsResource.loading
              || structuresResource.loading || roadsResource.loading || problemsResource.loading ? (
                <LoadingState label="Preparando as camadas geográficas..." />
              ) : (
                <EmptyState
                  title="Sem dados geográficos"
                  description="O mapa será preenchido conforme talhões, estruturas, estradas ou localizações forem registrados."
                  icon={MapPinned}
                />
              )}
            <div className="dashboard-map-legend" aria-label="Legenda do mapa">
              <span><i className="legend-dot legend-machine" />Máquinas</span>
              <span><i className="legend-dot legend-field" />Talhões</span>
              <span><i className="legend-dot legend-problem" />Ocorrências</span>
              <span><i className="legend-line" />Estradas</span>
            </div>
          </article>
        ) : null}

        <div className="dashboard-side-stack">
          {can('road_problems.view') ? (
            <article className="dashboard-panel dashboard-issues-panel">
              <SectionHeader eyebrow="SEGURANÇA DE CAMPO" title="Ocorrências em vias" link="/problemas-vias" linkLabel="Ver ocorrências" />
              {problemsResource.error ? <ErrorState message="Não foi possível carregar as ocorrências." onRetry={problemsResource.reload} /> : null}
              {problemsResource.loading ? <LoadingState label="Consultando ocorrências..." /> : null}
              {!problemsResource.loading && !problemsResource.error && openProblems.length ? (
                <div className="dashboard-issue-list">
                  {openProblems.slice(0, 4).map((problem) => (
                    <div className="dashboard-issue-row" key={problem.id}>
                      <span className="dashboard-issue-icon"><AlertTriangle size={16} aria-hidden="true" /></span>
                      <span className="dashboard-row-main">
                        <strong>{problem.road_nome || `Estrada ${problem.road_id}`}</strong>
                        <small>{problem.tipo} · {formatDateTime(problem.created_at)}</small>
                      </span>
                      <StatusBadge>{problem.gravidade}</StatusBadge>
                    </div>
                  ))}
                </div>
              ) : null}
              {!problemsResource.loading && !problemsResource.error && !openProblems.length ? (
                <EmptyState title="Nenhuma ocorrência aberta" description="Não há registros de vias pendentes nesta fazenda." icon={AlertTriangle} />
              ) : null}
            </article>
          ) : null}

          <article className="dashboard-panel dashboard-quick-panel">
            <SectionHeader eyebrow="ATALHOS" title="Acessos rápidos" />
            <nav className="dashboard-quick-links" aria-label="Acessos rápidos">
              {can('operations.create') && can('operations.view') ? <Link to="/operacoes"><ClipboardList size={17} aria-hidden="true" /><span>Nova operação</span><ArrowRight size={15} aria-hidden="true" /></Link> : null}
              {can('machines.view') && role !== 'OPERATOR' ? <Link to="/maquinas"><Tractor size={17} aria-hidden="true" /><span>Frota de máquinas</span><ArrowRight size={15} aria-hidden="true" /></Link> : null}
              {can('fields.view') ? <Link to="/mapa"><MapPinned size={17} aria-hidden="true" /><span>Mapa operacional</span><ArrowRight size={15} aria-hidden="true" /></Link> : null}
              {can('routes.view') ? <Link to={role === 'OPERATOR' ? '/minha-rota' : '/rotas'}><Route size={17} aria-hidden="true" /><span>Rotas</span><ArrowRight size={15} aria-hidden="true" /></Link> : null}
              {can('alerts.view') && can('telemetry.view') ? <Link to="/alertas"><Activity size={17} aria-hidden="true" /><span>Central de eventos</span><ArrowRight size={15} aria-hidden="true" /></Link> : null}
              {!(can('operations.create') && can('operations.view')) && !can('machines.view') && !can('fields.view')
                && !can('routes.view') && !(can('alerts.view') && can('telemetry.view')) ? (
                  <EmptyState title="Sem atalhos disponíveis" description="Os atalhos aparecem de acordo com as permissões desta fazenda." />
                ) : null}
            </nav>
          </article>

          {(can('telemetry.view') || can('operations.view') || can('road_problems.view')) ? (
            <article className="dashboard-panel dashboard-activity-panel">
              <SectionHeader eyebrow="REGISTROS DA API" title="Atividade recente" />
              {[
                ['telemetry', telemetryResource, can('telemetry.view')],
                ['operations', operationsResource, can('operations.view')],
                ['problems', problemsResource, can('road_problems.view')],
              ].filter(([, , enabled]) => enabled).some(([, resource]) => resource.error) ? (
                <ErrorState
                  message="Algumas fontes de atividade não puderam ser consultadas."
                  onRetry={() => {
                    if (can('telemetry.view')) telemetryResource.reload();
                    if (can('operations.view')) operationsResource.reload();
                    if (can('road_problems.view')) problemsResource.reload();
                  }}
                />
              ) : null}
              {[
                ['telemetry', telemetryResource, can('telemetry.view')],
                ['operations', operationsResource, can('operations.view')],
                ['problems', problemsResource, can('road_problems.view')],
              ].filter(([, , enabled]) => enabled).some(([, resource]) => resource.loading) ? (
                <LoadingState label="Carregando atividade..." />
              ) : null}
              {recentActivity.length ? (
                <ol className="dashboard-activity-list">
                  {recentActivity.map((event) => (
                    <li key={event.id}>
                      <span className={`dashboard-activity-icon event-${event.kind}`}>
                        {event.kind === 'problem' ? <AlertTriangle size={15} aria-hidden="true" />
                          : event.kind === 'operation' ? <ClipboardList size={15} aria-hidden="true" />
                            : event.kind === 'location' ? <MapPinned size={15} aria-hidden="true" />
                              : <RadioTower size={15} aria-hidden="true" />}
                      </span>
                      <span><strong>{event.title}</strong><small>{event.detail}</small></span>
                      <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                    </li>
                  ))}
                </ol>
              ) : !telemetryResource.loading && !operationsResource.loading && !problemsResource.loading ? (
                <EmptyState title="Nenhuma atividade registrada recentemente" description="As APIs disponíveis não retornaram registros recentes para esta fazenda." icon={Activity} />
              ) : null}
            </article>
          ) : null}
        </div>
      </section>
    </div>
  );
}
