import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Route as RouteIcon } from 'lucide-react';

import { apiFetch } from '../api/apiClient';
import EntityMap from '../components/map/EntityMap';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { geoLineToLeaflet } from '../utils/geoData';
import { routeErrorMessage, routeResponseToMap } from '../utils/routeUtils';

const asList = (value) => Array.isArray(value) ? value : [];

export default function RoutesPage() {
  const { can } = useAuth();
  const machinesResource = useApiResource('/api/v1/machines');
  const structuresResource = useApiResource('/api/v1/structures');
  const locationsResource = useApiResource('/api/v1/locations');
  const segmentsResource = useApiResource('/api/v1/routes/segments');
  const problemsResource = useApiResource('/api/v1/road-problems');
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
  const routeCoordinates = useMemo(() => route?.routePoints || [], [route]);
  const mappedSegments = segments.map((segment) => ({ ...segment, nome: `Trecho ${segment.id}` }));
  const affectedIds = new Set(route?.affectedSegments || []);
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
            <div className="route-map-legend"><span><i className="legend-line" />Rede viária</span><span><i className="route-legend-line" />Rota calculada</span></div>
          </header>
          {segments.length || structures.length || routeCoordinates.length ? (
            <EntityMap
              className="route-network-map"
              roads={mappedSegments}
              structures={structures}
              roadProblems={problems}
              machines={locations}
              routeCoordinates={routeCoordinates}
              visibleLayers={{ fields: false, roads: true, structures: true, problems: true, machines: true }}
              zoom={13}
            />
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
