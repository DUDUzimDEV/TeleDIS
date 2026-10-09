import React, { useEffect, useState } from 'react';
import { Activity, ArrowLeft, MapPinned, RefreshCw, Route as RouteIcon } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { apiFetch } from '../api/apiClient';
import EntityMap from '../components/map/EntityMap';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime, geoLineToLeaflet } from '../utils/geoData';
import { getOperationActions } from '../utils/operationWorkflow';

const asList = (value) => Array.isArray(value) ? value : [];
const activeStatuses = new Set(['EM_EXECUCAO', 'INTERROMPIDA']);
const fieldName = (operation) => operation?.field_name || `Talhão ${operation?.field_id ?? '—'}`;
const formatMeters = (value) => value == null
  ? 'Indisponível'
  : `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m`;
const formatSeconds = (value) => value == null
  ? 'Indisponível'
  : `${Math.round(Number(value) / 60).toLocaleString('pt-BR')} min`;

export default function OperationDetailPage() {
  const { id } = useParams();
  const operationId = Number(id);
  const { can, role } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const [locationRefresh, setLocationRefresh] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [occurrence, setOccurrence] = useState({ occurrence_type: 'PROBLEMA_VIA', description: '' });
  const operationResource = useApiResource(`/api/v1/operations/${operationId}`, refresh);
  const operation = operationResource.data;
  const isExecuting = activeStatuses.has(operation?.status);
  const locationsResource = useApiResource(
    `/api/v1/operations/${operationId}/locations`,
    locationRefresh,
    { enabled: Boolean(operation?.started_at && operation?.machine_id) },
  );
  const historyResource = useApiResource(
    `/api/v1/operations/${operationId}/history`,
    refresh,
    { enabled: Boolean(operation && can('operations.history')) },
  );
  const occurrencesResource = useApiResource(
    `/api/v1/operations/${operationId}/occurrences`,
    refresh,
    { enabled: Boolean(operation && can('operations.history')) },
  );
  const fieldsResource = useApiResource(
    '/api/v1/fields',
    0,
    { enabled: Boolean(operation && can('fields.view')) },
  );
  const roadsResource = useApiResource(
    '/api/v1/roads',
    0,
    { enabled: Boolean(operation && can('roads.view')) },
  );
  const problemsResource = useApiResource(
    '/api/v1/road-problems',
    0,
    { enabled: Boolean(operation && can('road_problems.view')) },
  );

  useEffect(() => {
    if (!isExecuting) return undefined;
    const timer = window.setInterval(() => setLocationRefresh((value) => value + 1), 10000);
    return () => window.clearInterval(timer);
  }, [isExecuting]);

  const fields = asList(fieldsResource.data).filter((field) => Number(field.id) === Number(operation?.field_id));
  const locations = asList(locationsResource.data?.locations);
  const actualRouteCoordinates = locations.map((location) => [
    Number(location.latitude),
    Number(location.longitude),
  ]).filter((point) => point.every(Number.isFinite));
  const currentPosition = locationsResource.data?.current_position;
  const machines = currentPosition ? [{
    ...currentPosition,
    id: operation?.machine_id,
    maquina_id: operation?.machine_id,
    nome: operation?.machine_name || `Máquina ${operation?.machine_id}`,
    status: isExecuting ? 'EM EXECUÇÃO' : operation?.status,
  }] : [];
  const routes = historyResource.data?.routes || [];
  const latestRoute = routes[routes.length - 1];
  const plannedRouteCoordinates = geoLineToLeaflet(latestRoute?.route_geometry?.geometry);
  const roadProblems = asList(problemsResource.data).filter(
    (problem) => !['RESOLVIDO', 'INATIVO'].includes(problem.status),
  );
  const comparison = locationsResource.data?.comparison;
  const permissions = new Set([
    'operations.execute',
    'operations.assign',
  ].filter((permission) => can(permission)));
  const actions = getOperationActions(operation, role, permissions);
  const timeline = [
    ...asList(historyResource.data?.statuses).map((event) => ({
      id: `status-${event.created_at}`,
      at: event.created_at,
      title: `Status: ${String(event.new_status || '').replaceAll('_', ' ')}`,
      detail: event.reason || 'Transição registrada no histórico da operação.',
    })),
    ...asList(occurrencesResource.data).map((event) => ({
      id: `occurrence-${event.id}`,
      at: event.created_at,
      title: `Ocorrência: ${event.occurrence_type}`,
      detail: event.description,
    })),
  ].filter((event) => event.at).sort((left, right) => new Date(right.at) - new Date(left.at));

  async function performAction(action) {
    setSending(true);
    setError('');
    try {
      const response = await apiFetch(`/api/v1/operations/${operationId}/${action.action}`, {
        method: 'POST',
        headers: action.body ? { 'Content-Type': 'application/json' } : undefined,
        body: action.body ? JSON.stringify(action.body) : undefined,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      setRefresh((value) => value + 1);
      setLocationRefresh((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível atualizar a operação.');
    } finally {
      setSending(false);
    }
  }

  async function reportOccurrence(event) {
    event.preventDefault();
    setSending(true);
    setError('');
    try {
      const response = await apiFetch(`/api/v1/operations/${operationId}/occurrences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...occurrence,
          ...(currentPosition ? {
            latitude: Number(currentPosition.latitude),
            longitude: Number(currentPosition.longitude),
          } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      setOccurrence((value) => ({ ...value, description: '' }));
      setRefresh((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível registrar a ocorrência.');
    } finally {
      setSending(false);
    }
  }

  if (operationResource.loading) return <LoadingState label="Carregando detalhes da operação..." />;
  if (operationResource.error) return <ErrorState message={operationResource.error} onRetry={operationResource.reload} />;
  if (!operation) {
    return <EmptyState title="Operação não encontrada" description="A operação solicitada não está disponível nesta fazenda." icon={Activity} />;
  }

  return (
    <div className="operation-detail-screen">
      <PageHeading
        eyebrow={`Operação ${operation.code || `#${operation.id}`}`}
        title={operation.name}
        description={`${operation.operation_type} · ${fieldName(operation)} · prioridade ${operation.priority}`}
        actions={<Link to="/operacoes" className="toolbar-button outline"><ArrowLeft size={16} />Voltar às operações</Link>}
      />

      {error ? <ErrorState message={error} /> : null}

      <section className="operation-overview">
        <div className="operation-overview-heading">
          <div><span className="section-overline">Estado atual</span><h2>{operation.name}</h2></div>
          <StatusBadge>{operation.status.replaceAll('_', ' ')}</StatusBadge>
        </div>
        <dl className="cycle-facts">
          <div><dt>Talhão</dt><dd>{fieldName(operation)}</dd></div>
          <div><dt>Equipe</dt><dd>{operation.team_name || 'Não atribuída'}</dd></div>
          <div><dt>Máquina</dt><dd>{operation.machine_name || 'Não atribuída'}</dd></div>
          <div><dt>Operador</dt><dd>{operation.operator_name || 'Não atribuído'}</dd></div>
          <div><dt>Supervisor</dt><dd>{operation.supervisor_name || '—'}</dd></div>
          <div><dt>Início real</dt><dd>{formatDateTime(operation.started_at)}</dd></div>
        </dl>
        {actions.length ? <div className="operation-detail-actions">
          {actions.map((action) => (
            <button
              key={action.action}
              className={`toolbar-button ${action.primary ? 'primary' : 'outline'}`}
              type="button"
              disabled={sending}
              onClick={() => performAction(action)}
            >{action.label}</button>
          ))}
        </div> : null}
        {can('operations.execute') && ['EM_EXECUCAO', 'INTERROMPIDA'].includes(operation.status) ? (
          <form className="operation-occurrence-form" onSubmit={reportOccurrence}>
            <label>Tipo de ocorrência
              <select value={occurrence.occurrence_type} onChange={(event) => setOccurrence({ ...occurrence, occurrence_type: event.target.value })}>
                <option value="PROBLEMA_VIA">Problema na via</option>
                <option value="MAQUINA">Máquina</option>
                <option value="PARADA">Parada</option>
                <option value="DESVIO">Desvio</option>
                <option value="OUTRO">Outra</option>
              </select>
            </label>
            <label>Descrição<textarea required minLength="2" maxLength="4000" value={occurrence.description} onChange={(event) => setOccurrence({ ...occurrence, description: event.target.value })} /></label>
            <button className="toolbar-button primary" type="submit" disabled={sending}>Registrar ocorrência</button>
          </form>
        ) : null}
      </section>

      <section className="operation-map-panel">
        <header className="section-heading">
          <div><span className="section-overline">Contexto geográfico</span><h2>Rota planejada e execução GPS</h2></div>
          {isExecuting ? <span className="live-indicator"><RefreshCw size={14} />Atualização a cada 10 s</span> : null}
        </header>
        {locationsResource.error ? <ErrorState message={locationsResource.error} onRetry={locationsResource.reload} /> : null}
        {fieldsResource.error ? <ErrorState message={fieldsResource.error} onRetry={fieldsResource.reload} /> : null}
        {roadsResource.error ? <ErrorState message={roadsResource.error} onRetry={roadsResource.reload} /> : null}
        {problemsResource.error ? <ErrorState message={problemsResource.error} onRetry={problemsResource.reload} /> : null}
        <EntityMap
          fields={fields}
          roads={can('roads.view') ? asList(roadsResource.data) : []}
          roadProblems={can('road_problems.view') ? roadProblems : []}
          machines={machines}
          plannedRouteCoordinates={plannedRouteCoordinates}
          actualRouteCoordinates={actualRouteCoordinates}
          visibleLayers={{
            fields: can('fields.view'),
            roads: can('roads.view'),
            structures: false,
            problems: can('road_problems.view'),
            machines: true,
          }}
          zoom={13}
          className="operation-detail-map"
        />
        <div className="operation-map-legend">
          {can('fields.view') ? <span><i className="legend-field" />Talhão</span> : null}
          {can('roads.view') ? <span><i className="legend-line" />Estradas</span> : null}
          {can('road_problems.view') ? <span><i className="legend-dot legend-problem" />Problemas abertos</span> : null}
          <span><i className="operation-legend-planned" />Rota planejada</span>
          <span><i className="operation-legend-actual" />Trajetória GPS</span>
          <span><i className="legend-dot legend-machine" />Última posição</span>
        </div>
        {!plannedRouteCoordinates.length && !actualRouteCoordinates.length ? (
          <p className="operation-data-note">Ainda não há rota calculada nem amostras GPS vinculadas ao intervalo desta operação.</p>
        ) : null}
      </section>

      <section className="operation-comparison-panel">
        <header className="section-heading"><div><span className="section-overline">Planejado × realizado</span><h2>Métricas de execução</h2></div><RouteIcon size={18} /></header>
        {locationsResource.loading ? <LoadingState label="Calculando métricas com as posições GPS disponíveis..." /> : null}
        {locationsResource.error ? null : comparison?.sufficient_data || comparison?.adherence_sufficient_data ? (
          <div className="operation-metrics-grid">
            <Metric label="Distância planejada" value={formatMeters(comparison.planned_distance_m)} />
            <Metric label="Distância observada" value={formatMeters(comparison.actual_distance_m)} />
            <Metric label="Diferença de distância" value={formatMeters(comparison.distance_difference_m)} />
            <Metric label="Duração planejada" value={formatSeconds(comparison.planned_duration_s)} />
            <Metric label="Duração observada" value={formatSeconds(comparison.actual_duration_s)} />
            <Metric label="Aderência aproximada" value={comparison.route_adherence_pct == null ? 'Dados insuficientes' : `${Number(comparison.route_adherence_pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`} />
            <Metric label={`Pontos fora de ${comparison.deviation_tolerance_m} m`} value={comparison.points_outside_tolerance ?? 'Dados insuficientes'} />
            <Metric label="Desvio máximo" value={formatMeters(comparison.max_deviation_m)} />
          </div>
        ) : !locationsResource.loading ? (
          <p className="operation-data-note">Dados insuficientes para comparar. É necessário haver rota planejada e/ou amostras GPS no período da operação.</p>
        ) : null}
        <p className="operation-data-note">Aderência calculada pela distância geodésica de cada amostra GPS à linha planejada, com tolerância configurável de {comparison?.deviation_tolerance_m ?? 25} m e {comparison?.gps_sample_count ?? 0} amostras consideradas. A linha exibida no mapa é limitada a 1.500 pontos distribuídos no percurso; métricas usam todas as amostras. Velocidade e direção por amostra não são fornecidas pelo registro de localização.</p>
      </section>

      <section className="operation-timeline-panel">
        <header className="section-heading"><div><span className="section-overline">Rastreamento operacional</span><h2>Histórico, rotas e ocorrências</h2></div><Activity size={18} /></header>
        {historyResource.error ? <ErrorState message={historyResource.error} onRetry={historyResource.reload} /> : null}
        {occurrencesResource.error ? <ErrorState message={occurrencesResource.error} onRetry={occurrencesResource.reload} /> : null}
        {historyResource.loading ? <LoadingState label="Carregando eventos da operação..." /> : null}
        {routes.length ? <div className="operation-route-history">
          {routes.map((route) => <article key={route.version}><strong>Rota v{route.version}</strong><span>{formatMeters(route.distance_m)} · calculada {formatDateTime(route.created_at)}</span></article>)}
        </div> : <p className="operation-data-note">Nenhuma versão de rota foi registrada.</p>}
        {timeline.length ? <ol className="operation-timeline">
          {timeline.map((event) => <li key={event.id}><time>{formatDateTime(event.at)}</time><div><strong>{event.title}</strong><p>{event.detail}</p></div></li>)}
        </ol> : !historyResource.loading ? <EmptyState title="Sem eventos registrados" description="Transições e ocorrências aparecerão aqui quando forem registradas." icon={MapPinned} /> : null}
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}
