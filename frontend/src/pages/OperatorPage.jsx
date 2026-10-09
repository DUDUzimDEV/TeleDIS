import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, LogOut, MapPinned, Navigation, Sprout, Tractor } from 'lucide-react';
import { Link } from 'react-router-dom';

import { apiFetch } from '../api/apiClient';
import EntityMap from '../components/map/EntityMap';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime, geoLineToLeaflet } from '../utils/geoData';

export default function OperatorPage() {
  const { activeFarm, can, signOut, user } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const [locationRefresh, setLocationRefresh] = useState(0);
  const [actionError, setActionError] = useState('');
  const [occurrence, setOccurrence] = useState({ occurrence_type: 'PROBLEMA_VIA', description: '' });
  const [sending, setSending] = useState(false);
  const machineId = user?.assigned_machine_id;
  const machinesResource = useApiResource('/api/v1/machines');
  const locationResource = useApiResource(`/api/v1/locations/${machineId}?limit=20`, locationRefresh, { enabled: Boolean(machineId) });
  const telemetryResource = useApiResource(`/api/v1/telemetry/${machineId}`, 0, { enabled: Boolean(machineId) });
  const operationsResource = useApiResource('/api/v1/operations', refresh);
  const operations = Array.isArray(operationsResource.data) ? operationsResource.data : [];
  const currentOperation = operations.find((item) => ['ATRIBUIDA', 'ACEITA', 'EM_EXECUCAO', 'INTERROMPIDA'].includes(item.status))
    || operations.find((item) => item.status === 'PLANEJADA')
    || null;
  const historyResource = useApiResource(
    `/api/v1/operations/${currentOperation?.id}/history`, refresh, { enabled: Boolean(currentOperation?.id) },
  );
  const operationLocationsResource = useApiResource(
    `/api/v1/operations/${currentOperation?.id}/locations`,
    locationRefresh,
    { enabled: Boolean(currentOperation?.id && currentOperation.started_at) },
  );
  const operationHistory = historyResource.data || { routes: [] };
  const latestRoute = operationHistory.routes?.[operationHistory.routes.length - 1];
  const routeCoordinates = geoLineToLeaflet(latestRoute?.route_geometry?.geometry);
  const actualRouteCoordinates = (operationLocationsResource.data?.locations || [])
    .map((location) => [Number(location.latitude), Number(location.longitude)])
    .filter((point) => point.every(Number.isFinite));

  useEffect(() => {
    if (!machineId) return undefined;
    const timer = window.setInterval(() => setLocationRefresh((value) => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, [machineId]);

  const assignedMachine = useMemo(() => (
    (Array.isArray(machinesResource.data) ? machinesResource.data : [])
      .find((machine) => Number(machine.id) === Number(machineId)) || null
  ), [machinesResource.data, machineId]);
  const locationData = locationResource.data;
  const locations = machineId
    ? (Array.isArray(locationData?.historico) ? locationData.historico : [])
    : [];
  const currentLocation = locations[0] || null;
  const telemetryData = telemetryResource.data;
  const readings = machineId
    ? (Array.isArray(telemetryData?.historico) ? telemetryData.historico : [])
    : [];
  const latestReadings = useMemo(() => {
    const byMetric = new Map();
    readings.forEach((reading) => {
      if (!byMetric.has(reading.metric)) byMetric.set(reading.metric, reading);
    });
    return [...byMetric.values()];
  }, [readings]);
  const speedReading = latestReadings.find((item) => /velocidade|speed/i.test(item.metric));

  async function logout() {
    await signOut();
  }

  async function operationAction(action, body = {}) {
    if (!currentOperation) return;
    setSending(true);
    setActionError('');
    try {
      const response = await apiFetch(`/api/v1/operations/${currentOperation.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      setRefresh((value) => value + 1);
    } catch (error) {
      setActionError(error.message || 'Não foi possível atualizar a operação.');
    } finally {
      setSending(false);
    }
  }

  async function reportOccurrence(event) {
    event.preventDefault();
    if (!currentOperation) return;
    setSending(true);
    setActionError('');
    try {
      const response = await apiFetch(`/api/v1/operations/${currentOperation.id}/occurrences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...occurrence,
          ...(currentLocation ? {
            latitude: Number(currentLocation.latitude),
            longitude: Number(currentLocation.longitude),
          } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      setOccurrence({ ...occurrence, description: '' });
      setRefresh((value) => value + 1);
    } catch (error) {
      setActionError(error.message || 'Não foi possível registrar a ocorrência.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="operator-page">
      <header className="operator-topbar">
        <div className="operator-brand"><span className="operator-brand-mark">T</span><span><strong>TeleDis</strong><small>Operação de campo</small></span></div>
        <div className="operator-context"><strong>{activeFarm?.name || 'Fazenda'}</strong><small>{user?.full_name || user?.username} · Operador</small></div>
        <button type="button" className="operator-logout" onClick={logout} aria-label="Encerrar sessão"><LogOut size={19} /></button>
      </header>

      <section className="operator-machine-heading">
        <span className="operator-machine-icon"><Tractor size={24} /></span>
        <div><small>Minha máquina</small><h1>{assignedMachine?.nome || 'Máquina não atribuída'}</h1></div>
        {assignedMachine ? <StatusBadge>{assignedMachine.status}</StatusBadge> : null}
      </section>

      {machinesResource.error ? <ErrorState message={machinesResource.error} onRetry={machinesResource.reload} /> : null}
      {machinesResource.loading ? <LoadingState label="Consultando máquina atribuída..." /> : null}
      {operationsResource.error ? <ErrorState message={operationsResource.error} onRetry={operationsResource.reload} /> : null}
      {actionError ? <ErrorState message={actionError} /> : null}

      {!machinesResource.loading && !machinesResource.error && !machineId ? (
        <EmptyState
          title="Nenhuma máquina atribuída"
          description="Solicite à coordenação que associe uma máquina ao seu usuário nesta fazenda."
          icon={Tractor}
        />
      ) : null}

      {!machinesResource.loading && !machinesResource.error && machineId && !assignedMachine ? (
        <ErrorState message="A máquina associada ao seu usuário não está disponível nesta fazenda. Contate a administração." />
      ) : null}

      {assignedMachine ? (
        <>
          <section className="operator-map-panel">
            <header><span><MapPinned size={18} />Minha localização</span>{currentLocation ? <small>Atualizada {formatDateTime(currentLocation.timestamp)}</small> : null}</header>
            {locationResource.error ? <ErrorState message={locationResource.error} onRetry={locationResource.reload} /> : null}
            {locationResource.loading ? <LoadingState label="Carregando localização..." /> : null}
            {!locationResource.loading && !locationResource.error && !currentLocation ? (
              <EmptyState title="Localização indisponível" description="Ainda não há posição recebida para sua máquina." icon={Navigation} />
            ) : null}
            {currentLocation ? (
              <EntityMap
                machines={[{ ...currentLocation, nome: assignedMachine.nome, status: assignedMachine.status }]}
                routeCoordinates={routeCoordinates}
                actualRouteCoordinates={actualRouteCoordinates}
                visibleLayers={{ fields: false, roads: false, structures: false, problems: false, machines: true }}
                zoom={15}
                className="operator-map"
              />
            ) : null}
          </section>

          <section className="operator-status-strip">
            <article><small>Status da máquina</small><strong><StatusBadge>{assignedMachine.status}</StatusBadge></strong></article>
            <article><small>Velocidade</small><strong>{speedReading ? `${speedReading.valor} ${speedReading.unidade || ''}` : 'Sem leitura disponível'}</strong></article>
            <article><small>Última posição</small><strong>{currentLocation ? formatDateTime(currentLocation.timestamp) : 'Sem posição'}</strong></article>
          </section>

          <section className="operator-readings-panel">
            <header><Activity size={18} /><h2>Leituras recentes</h2></header>
            {telemetryResource.error ? <ErrorState message={telemetryResource.error} onRetry={telemetryResource.reload} /> : null}
            {telemetryResource.loading ? <LoadingState label="Carregando telemetria..." /> : null}
            {!telemetryResource.loading && !telemetryResource.error && latestReadings.length === 0 ? (
              <EmptyState title="Sem telemetria recente" description="A API não retornou leituras para a máquina atribuída." icon={Activity} />
            ) : null}
            <div className="operator-readings-grid">
              {latestReadings.map((reading) => (
                <article key={reading.metric}>
                  <small>{reading.metric}</small>
                  <strong>{reading.valor} <span>{reading.unidade || ''}</span></strong>
                  <time>{formatDateTime(reading.timestamp)}</time>
                </article>
              ))}
            </div>
          </section>

          <section className="operator-task-panel">
            <span className="operator-task-icon"><Navigation size={19} /></span>
            <div className="operator-task-content">
              <small>Minha operação</small>
              {operationsResource.loading ? <p>Consultando operações atribuídas...</p> : null}
              {!operationsResource.loading && !operationsResource.error && !currentOperation ? <><h2>Nenhuma operação atribuída</h2><p>A coordenação ainda não atribuiu uma atividade a você.</p></> : null}
              {currentOperation ? (
                <>
                  <h2>{currentOperation.name}</h2>
                  <p>{currentOperation.operation_type} · Talhão: {currentOperation.field_name} · {currentOperation.status.replaceAll('_', ' ')}</p>
                  {latestRoute ? <p>Trajeto recomendado: {Number(latestRoute.distance_m).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m · versão {latestRoute.version}</p> : <p>A rota ainda não foi calculada pela coordenação.</p>}
                  {historyResource.error ? <ErrorState message={historyResource.error} onRetry={historyResource.reload} /> : null}
                  <div className="operator-operation-actions">
                    {currentOperation.status === 'ATRIBUIDA' ? <button type="button" disabled={sending} onClick={() => operationAction('accept')}>Aceitar operação</button> : null}
                    {currentOperation.status === 'ACEITA' ? <button type="button" disabled={sending} onClick={() => operationAction('start')}>Iniciar operação</button> : null}
                    {currentOperation.status === 'EM_EXECUCAO' ? <button type="button" disabled={sending} onClick={() => operationAction('interrupt', { reason: 'Parada informada pelo operador.' })}>Informar parada</button> : null}
                    {currentOperation.status === 'INTERROMPIDA' ? <button type="button" disabled={sending} onClick={() => operationAction('resume')}>Retomar operação</button> : null}
                    {currentOperation.status === 'EM_EXECUCAO' ? <button type="button" className="complete" disabled={sending} onClick={() => operationAction('complete')}>Finalizar operação</button> : null}
                    {['ATRIBUIDA', 'ACEITA', 'INTERROMPIDA'].includes(currentOperation.status) ? <button type="button" disabled={sending} onClick={() => operationAction('cancel', { reason: 'Cancelada pelo operador.' })}>Cancelar</button> : null}
                  </div>
                  <Link className="operator-detail-link" to={`/operacoes/${currentOperation.id}`}>Ver mapa, métricas e histórico completos</Link>
                  {['EM_EXECUCAO', 'INTERROMPIDA'].includes(currentOperation.status) ? (
                    <form className="operator-occurrence-form" onSubmit={reportOccurrence}>
                      <label>Ocorrência<select value={occurrence.occurrence_type} onChange={(event) => setOccurrence({ ...occurrence, occurrence_type: event.target.value })}><option value="PROBLEMA_VIA">Problema na via</option><option value="MAQUINA">Problema na máquina</option><option value="PARADA">Parada</option><option value="DESVIO">Desvio</option><option value="OUTRO">Outra ocorrência</option></select></label>
                      <label>Descrição<textarea required minLength="2" maxLength="4000" value={occurrence.description} onChange={(event) => setOccurrence({ ...occurrence, description: event.target.value })} /></label>
                      <button type="submit" disabled={sending}>Enviar ocorrência</button>
                    </form>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>

          {can('road_problems.create') ? (
            <Link className="operator-occurrence-button" to="/problemas-vias"><AlertTriangle size={21} /> Informar problema na via</Link>
          ) : null}
          <p className="operator-data-note"><Sprout size={14} />Informações exibidas somente para a máquina vinculada ao seu usuário.</p>
        </>
      ) : null}
    </main>
  );
}
