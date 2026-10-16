import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Route as RouteIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import { apiFetch } from '../api/apiClient';
import EntityMap from '../components/map/EntityMap';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime, geoLineToLeaflet } from '../utils/geoData';
import { getCommunicationStatus } from '../utils/liveStatus';
import { routeErrorMessage, routeResponseToMap } from '../utils/routeUtils';

const asList = (value) => Array.isArray(value) ? value : [];
const LIVE_REFRESH_INTERVAL_MS = 5000;

export default function RoutesPage() {
  const { can } = useAuth();
  const operationsResource = useApiResource('/api/v1/operations', 0, {
    enabled: can('operations.view'),
    pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
  });
  const machinesResource = useApiResource('/api/v1/machines');
  const structuresResource = useApiResource('/api/v1/structures');
  const locationsResource = useApiResource('/api/v1/locations');
  const segmentsResource = useApiResource('/api/v1/routes/segments');
  const problemsResource = useApiResource('/api/v1/road-problems');
  const [selectedRouteOperationId, setSelectedRouteOperationId] = useState('');
  const [mode, setMode] = useState('machine');
  const [machineId, setMachineId] = useState('');
  const [structureId, setStructureId] = useState('');
  const [origin, setOrigin] = useState({ latitude: '', longitude: '' });
  const [destination, setDestination] = useState({ latitude: '', longitude: '' });
  const [route, setRoute] = useState(null);
  const [routeError, setRouteError] = useState('');
  const [calculating, setCalculating] = useState(false);

  const machines = asList(machinesResource.data);
  const structures = asList(structuresResource.data);
  const locations = asList(locationsResource.data);
  const segments = asList(segmentsResource.data);
  const problems = asList(problemsResource.data);
  const routeOperations = asList(operationsResource.data)
    .filter((operation) => operation.machine_id && operation.route_plan_id)
    .sort((left, right) => new Date(right.updated_at || right.created_at || 0) - new Date(left.updated_at || left.created_at || 0));
  const selectedRouteOperation = routeOperations.find(
    (operation) => String(operation.id) === selectedRouteOperationId,
  ) || routeOperations[0] || null;
  const operationHistoryResource = useApiResource(
    selectedRouteOperation && can('operations.history')
      ? `/api/v1/operations/${selectedRouteOperation.id}/history`
      : '',
    0,
    { enabled: Boolean(selectedRouteOperation && can('operations.history')) },
  );
  const operationLocationsResource = useApiResource(
    selectedRouteOperation && can('operations.history')
      ? `/api/v1/operations/${selectedRouteOperation.id}/locations`
      : '',
    0,
    {
      enabled: Boolean(selectedRouteOperation?.started_at && can('operations.history')),
      pollingIntervalMs: ['EM_EXECUCAO', 'INTERROMPIDA'].includes(selectedRouteOperation?.status)
        ? LIVE_REFRESH_INTERVAL_MS
        : 0,
    },
  );
  const latestLocationResource = useApiResource(
    selectedRouteOperation?.machine_id
      ? `/api/v1/locations/${selectedRouteOperation.machine_id}?limit=1`
      : '',
    0,
    {
      enabled: Boolean(selectedRouteOperation?.machine_id && can('machines.view')),
      pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
    },
  );
  const persistedRoutes = asList(operationHistoryResource.data?.routes);
  const persistedRoute = persistedRoutes.find(
    (item) => Number(item.id) === Number(selectedRouteOperation?.route_plan_id),
  ) || persistedRoutes[persistedRoutes.length - 1];
  const persistedRouteCoordinates = geoLineToLeaflet(persistedRoute?.route_geometry);
  const persistedTrackCoordinates = asList(operationLocationsResource.data?.locations)
    .map((location) => [Number(location.latitude), Number(location.longitude)])
    .filter((point) => point.every(Number.isFinite));
  const latestMachineLocation = asList(latestLocationResource.data?.historico)[0];
  const routeCommunicationStatus = getCommunicationStatus(latestMachineLocation?.timestamp);
  const routeCoordinates = useMemo(() => route?.routePoints || [], [route]);
  const mappedSegments = segments.map((segment) => ({ ...segment, nome: `Trecho ${segment.id}` }));
  const affectedIds = new Set((route?.affectedSegments || []).map(String));
  const routeSegmentIds = new Set((route?.segments || []).map(String));
  const selectedRouteSegments = segments.filter((segment) => routeSegmentIds.has(String(segment.id)));
  const routeProblems = route?.problems || [];
  const currentMachineLocation = locations
    .filter((location) => String(location.maquina_id) === String(machineId))
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0];
  const routeLoading = [machinesResource, structuresResource, locationsResource, segmentsResource, problemsResource].some((item) => item.loading);

  function updateCoordinate(setter, key, value) {
    setter((current) => ({ ...current, [key]: value }));
    setRoute(null);
    setRouteError('');
  }

  async function calculateRoute(event) {
    event.preventDefault();
    setCalculating(true);
    setRoute(null);
    setRouteError('');

    try {
      let response;
      if (mode === 'machine') {
        if (!machineId || !structureId) throw new Error('Selecione uma máquina e uma estrutura.');
        response = await apiFetch(`/api/v1/routes/machine/${machineId}/to-structure/${structureId}`, { method: 'POST' });
      } else {
        if ([origin.latitude, origin.longitude, destination.latitude, destination.longitude].some((value) => value.trim() === '')) {
          throw new Error('Informe latitude e longitude para origem e destino.');
        }
        const coordinates = [origin.latitude, origin.longitude, destination.latitude, destination.longitude].map(Number);
        if (
          coordinates.some((coordinate) => !Number.isFinite(coordinate))
          || Math.abs(coordinates[0]) > 90
          || Math.abs(coordinates[2]) > 90
          || Math.abs(coordinates[1]) > 180
          || Math.abs(coordinates[3]) > 180
        ) {
          throw new Error('Informe latitude e longitude válidas para origem e destino.');
        }
        response = await apiFetch('/api/v1/routes/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: { latitude: coordinates[0], longitude: coordinates[1] },
            destination: { latitude: coordinates[2], longitude: coordinates[3] },
          }),
        });
      }
      if (!response.ok) throw new Error(await routeErrorMessage(response));
      const payload = await response.json();
      setRoute(routeResponseToMap(payload));
    } catch (error) {
      setRouteError(error.message || 'Não foi possível calcular a rota.');
    } finally {
      setCalculating(false);
    }
  }

  const openProblemsOnRoute = routeProblems.length;

  return (
    <div className="route-planner-screen">
      <PageHeading
        eyebrow="Planejamento logístico"
        title="Planejador de rotas"
        description="Caminhos calculados na rede viária disponível pelo algoritmo Dijkstra."
      />
      <div className="route-planner-workspace">
        <aside className="route-planner-sidebar">
          <section className="route-form-panel">
            <div className="route-panel-heading">
              <span className="route-panel-icon"><RouteIcon size={18} /></span>
              <div><span className="section-overline">Nova consulta</span><h2>Planejar deslocamento</h2></div>
            </div>
            <div className="route-mode-tabs" role="tablist" aria-label="Tipo de origem">
              <button type="button" className={mode === 'machine' ? 'active' : ''} onClick={() => { setMode('machine'); setRoute(null); }}>
                Máquina → estrutura
              </button>
              <button type="button" className={mode === 'coordinates' ? 'active' : ''} onClick={() => { setMode('coordinates'); setRoute(null); }}>
                Coordenadas
              </button>
            </div>
            {can('routes.create') ? <form className="route-form" onSubmit={calculateRoute}>
              {mode === 'machine' ? (
                <>
                  <label>Origem · Máquina
                    <select value={machineId} onChange={(event) => { setMachineId(event.target.value); setRoute(null); }}>
                      <option value="">Selecione uma máquina</option>
                      {machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.nome || `Máquina ${machine.id}`}</option>)}
                    </select>
                  </label>
                  {currentMachineLocation ? (
                    <p className="route-form-note">Último GPS: {Number(currentMachineLocation.latitude).toFixed(5)}, {Number(currentMachineLocation.longitude).toFixed(5)}</p>
                  ) : null}
                  <span className="route-waypoint"><ArrowDown size={16} />Destino</span>
                  <label>Estrutura
                    <select value={structureId} onChange={(event) => { setStructureId(event.target.value); setRoute(null); }}>
                      <option value="">Selecione uma estrutura</option>
                      {structures.map((structure) => <option key={structure.id} value={structure.id}>{structure.nome} · {structure.tipo}</option>)}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <span className="route-waypoint"><ArrowUp size={15} />Origem · Latitude / longitude</span>
                  <div className="coordinate-inputs">
                    <input inputMode="decimal" value={origin.latitude} onChange={(event) => updateCoordinate(setOrigin, 'latitude', event.target.value)} placeholder="Latitude" aria-label="Latitude de origem" />
                    <input inputMode="decimal" value={origin.longitude} onChange={(event) => updateCoordinate(setOrigin, 'longitude', event.target.value)} placeholder="Longitude" aria-label="Longitude de origem" />
                  </div>
                  <span className="route-waypoint"><ArrowDown size={15} />Destino · Latitude / longitude</span>
                  <div className="coordinate-inputs">
                    <input inputMode="decimal" value={destination.latitude} onChange={(event) => updateCoordinate(setDestination, 'latitude', event.target.value)} placeholder="Latitude" aria-label="Latitude do destino" />
                    <input inputMode="decimal" value={destination.longitude} onChange={(event) => updateCoordinate(setDestination, 'longitude', event.target.value)} placeholder="Longitude" aria-label="Longitude do destino" />
                  </div>
                </>
              )}
              <button type="submit" className="route-submit-button" disabled={calculating || routeLoading}>
                {calculating ? 'Calculando...' : 'Calcular rota'}
              </button>
            </form> : <p className="route-form-note">Seu perfil pode consultar a rede viária, mas não possui permissão para calcular rotas.</p>}
            {routeError ? <ErrorState message={routeError} /> : null}
            {routeLoading ? <LoadingState label="Carregando destinos e rede..." /> : null}
            {machinesResource.error ? <ErrorState message={machinesResource.error} onRetry={machinesResource.reload} /> : null}
            {structuresResource.error ? <ErrorState message={structuresResource.error} onRetry={structuresResource.reload} /> : null}
            {segmentsResource.error ? <ErrorState message={segmentsResource.error} onRetry={segmentsResource.reload} /> : null}
            {problemsResource.error ? <ErrorState message={problemsResource.error} onRetry={problemsResource.reload} /> : null}
          </section>

          {route ? (
            <section className="route-result-panel">
              <header><span className="section-overline">Resultado Dijkstra</span><StatusBadge tone="success">Encontrada</StatusBadge></header>
              <div className="route-result-stat-grid">
                <div><span>Distância</span><strong>{route.distanceMeters.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m</strong></div>
                <div><span>Custo ponderado</span><strong>{route.totalCost.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</strong></div>
                <div><span>Segmentos</span><strong>{route.segments.length}</strong></div>
                <div><span>Tempo</span><strong>—</strong></div>
              </div>
              <p className="route-cost-disclaimer">O custo é uma distância ponderada pelas condições viárias; tempo e consumo não são fornecidos.</p>
              {selectedRouteSegments.length ? (
                <section className="route-segment-list" aria-label="Trechos da rota calculada">
                  <h3>Trechos do percurso</h3>
                  {selectedRouteSegments.map((segment) => (
                    <div className="route-segment-row" key={segment.id}>
                      <span className={`route-segment-marker${affectedIds.has(String(segment.id)) ? ' affected' : ''}`} aria-hidden="true" />
                      <span><strong>Trecho {segment.id}</strong><small>{segment.length_m == null ? 'Comprimento não informado' : `${Number(segment.length_m).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m`} · {affectedIds.has(String(segment.id)) ? 'Problema associado' : 'Sem problema retornado'}</small></span>
                      <StatusBadge tone={affectedIds.has(String(segment.id)) ? 'warning' : 'success'}>{affectedIds.has(String(segment.id)) ? 'Afetado' : 'Incluído'}</StatusBadge>
                    </div>
                  ))}
                </section>
              ) : null}
              {openProblemsOnRoute ? (
                <div className="route-problem-impact">
                  <h3><AlertTriangle size={16} />Problemas associados</h3>
                  {routeProblems.map((problem) => (
                    <p key={problem.id}>
                      {problem.tipo} · {problem.gravidade} · {problem.status}
                    </p>
                  ))}
                  <small>Problemas ativos podem alterar o custo ou bloquear segmentos conforme as regras atuais.</small>
                </div>
              ) : <p className="route-no-issues">A API não retornou problemas associados à rota calculada.</p>}
              {route.blockedSegments.length ? <p className="route-cost-disclaimer">{route.blockedSegments.length} segmentos bloqueados foram excluídos da busca.</p> : null}
            </section>
          ) : (
            <EmptyState title="Aguardando origem e destino" description="Preencha os pontos para calcular um percurso na rede viária persistida." icon={RouteIcon} />
          )}
          <section className="route-result-panel persisted-route-panel">
            <header><span className="section-overline">Rota operacional persistida</span></header>
            {operationsResource.error ? (
              <ErrorState message={operationsResource.error} onRetry={operationsResource.reload} />
            ) : !can('operations.view') ? (
              <p className="route-cost-disclaimer">Seu perfil não possui acesso à lista de operações.</p>
            ) : routeOperations.length ? (
              <>
                <label className="persisted-route-select">
                  Operação
                  <select
                    value={selectedRouteOperation?.id || ''}
                    onChange={(event) => setSelectedRouteOperationId(event.target.value)}
                  >
                    {routeOperations.map((operation) => (
                      <option key={operation.id} value={operation.id}>
                        {operation.name || operation.code || `Operação ${operation.id}`} · Plano {operation.route_plan_id}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="route-result-stat-grid">
                  <div><span>Estado da operação</span><strong>{selectedRouteOperation.status.replaceAll('_', ' ')}</strong></div>
                  <div><span>Versões persistidas</span><strong>{persistedRoutes.length || '—'}</strong></div>
                  <div><span>Pontos GPS</span><strong>{operationLocationsResource.data?.comparison?.gps_sample_count ?? persistedTrackCoordinates.length}</strong></div>
                  <div><span>Plano</span><strong>#{selectedRouteOperation.route_plan_id}</strong></div>
                </div>
                {can('machines.view') ? (
                  <div className="operation-live-meta">
                    <span className={`live-status live-status-${routeCommunicationStatus.toLowerCase()}`}>
                      Comunicação: {routeCommunicationStatus === 'ONLINE' ? 'online' : routeCommunicationStatus === 'STALE' ? 'desatualizada' : 'sem dados'}
                    </span>
                    <span>Última posição: {formatDateTime(latestMachineLocation?.timestamp)}</span>
                    <span>Origem: {latestMachineLocation?.source === 'SIMULATED' ? 'DADO SIMULADO' : latestMachineLocation?.source === 'REAL' ? 'DADO REAL' : 'Não informada'}</span>
                  </div>
                ) : null}
                {Number(operationLocationsResource.data?.comparison?.gps_sample_count) === 1 ? (
                  <p className="route-cost-disclaimer">Há apenas 1 ponto GPS no período; ele é exibido como ponto, sem inferir uma trajetória.</p>
                ) : null}
                {operationHistoryResource.error ? <ErrorState message={operationHistoryResource.error} onRetry={operationHistoryResource.reload} /> : null}
                {operationLocationsResource.error ? <ErrorState message={operationLocationsResource.error} onRetry={operationLocationsResource.reload} /> : null}
                {latestLocationResource.error ? <ErrorState message={latestLocationResource.error} onRetry={latestLocationResource.reload} /> : null}
                {!can('operations.history') ? <p className="route-cost-disclaimer">Seu perfil não possui permissão para consultar a trajetória GPS e o histórico da rota.</p> : null}
                <Link className="text-link" to={`/operacoes/${selectedRouteOperation.id}`}>Abrir detalhes e comparação da operação</Link>
              </>
            ) : (
              <p className="route-cost-disclaimer">Não há operações com plano de rota associado nesta fazenda.</p>
            )}
          </section>
          <section className="route-network-status">
            <span className="section-overline">Rede viária disponível</span>
            {segmentsResource.loading ? <strong>Consultando segmentos...</strong> : segmentsResource.error ? <strong>Não foi possível carregar a rede</strong> : (
              <strong>{segments.length} segmentos carregados</strong>
            )}
            <small>O recálculo da rede permanece no Mapa Operacional e exige permissão de alteração das estradas.</small>
          </section>
        </aside>

        <section className="route-map-stage">
          <header className="route-map-header">
            <div><span className="section-overline">Visualização geográfica</span><h2>Rede e percurso</h2></div>
            <div className="route-map-legend">
              <span><i className="legend-line" />Rede disponível</span>
              <span><i className={persistedRouteCoordinates.length && !route ? 'route-legend-persisted' : 'route-legend-line'} />{persistedRouteCoordinates.length && !route ? 'Plano persistido' : 'Rota calculada'}</span>
              {persistedTrackCoordinates.length > 1 ? <span><i className="route-legend-actual" />Trajetória GPS</span> : null}
              <span><i className="route-segment-swatch affected" />Trecho com problema</span>
              <span><i className="route-segment-swatch blocked" />Trecho bloqueado</span>
            </div>
          </header>
          {segments.length || structures.length || routeCoordinates.length || persistedRouteCoordinates.length || persistedTrackCoordinates.length ? (
            <>
              <EntityMap
                className="route-network-map"
                roads={mappedSegments}
                structures={structures}
                roadProblems={problems}
                machines={locations}
                fitBoundsKey={selectedRouteOperation?.id || 'calculated-route'}
                routeCoordinates={routeCoordinates}
                plannedRouteCoordinates={route?.routePoints?.length ? [] : persistedRouteCoordinates}
                actualRouteCoordinates={persistedTrackCoordinates}
                routeSegmentIds={route?.segments || []}
                affectedSegmentIds={route?.affectedSegments || []}
                visibleLayers={{ fields: false, roads: true, structures: true, problems: true, machines: true }}
                zoom={13}
              />
            </>
          ) : segmentsResource.loading ? <LoadingState label="Carregando rede geográfica..." /> : (
            <EmptyState title="Rede sem geometria disponível" description="Construa a rede viária pelo Mapa Operacional após cadastrar estradas." icon={RouteIcon} />
          )}
          {route ? (
            <div className="route-map-footer">
              <span><strong>{route.nodes.length}</strong> nós</span>
              <span><strong>{route.segments.length}</strong> segmentos</span>
              <span className={openProblemsOnRoute ? 'text-warning' : ''}><strong>{openProblemsOnRoute}</strong> problemas informados</span>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
