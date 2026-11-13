import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, LogOut, MapPinned, Navigation, Sprout, Tractor, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { apiFetch } from '../api/apiClient';
import EntityMap from '../components/map/EntityMap';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime, geoLineToLeaflet } from '../utils/geoData';

const ROAD_PROBLEM_TYPES = [
  { value: 'BURACO', label: 'Buraco' },
  { value: 'LAMA', label: 'Lama' },
  { value: 'ALAGAMENTO', label: 'Alagamento' },
  { value: 'VIA_BLOQUEADA', label: 'Via bloqueada' },
  { value: 'PONTE_PROBLEMA', label: 'Problema em ponte' },
  { value: 'DESLIZAMENTO', label: 'Deslizamento' },
  { value: 'OUTRO', label: 'Outro' },
];

const ROAD_PROBLEM_SEVERITIES = [
  { value: 'BAIXA', label: 'Baixa' },
  { value: 'MEDIA', label: 'Média' },
  { value: 'ALTA', label: 'Alta' },
  { value: 'CRITICA', label: 'Crítica' },
];

const INITIAL_ROAD_PROBLEM_DRAFT = {
  road_id: '',
  tipo: 'BURACO',
  gravidade: 'MEDIA',
  descricao: '',
};

export default function OperatorPage() {
  const { activeFarm, can, signOut, user } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const [locationRefresh, setLocationRefresh] = useState(0);
  const [actionError, setActionError] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [occurrence, setOccurrence] = useState({ occurrence_type: 'PROBLEMA_VIA', description: '' });
  const [sending, setSending] = useState(false);
  const [roadProblemModalOpen, setRoadProblemModalOpen] = useState(false);
  const [roadProblemDraft, setRoadProblemDraft] = useState(INITIAL_ROAD_PROBLEM_DRAFT);
  const [roadProblemSubmitting, setRoadProblemSubmitting] = useState(false);
  const [roadProblemError, setRoadProblemError] = useState('');
  const [roadProblemSuccess, setRoadProblemSuccess] = useState('');
  const machineId = user?.assigned_machine_id;
  const machinesResource = useApiResource('/api/v1/machines');
  const locationResource = useApiResource(`/api/v1/locations/${machineId}?limit=20`, locationRefresh, { enabled: Boolean(machineId) });
  const telemetryResource = useApiResource(`/api/v1/telemetry/${machineId}`, 0, {
    enabled: Boolean(machineId),
    pollingIntervalMs: 10000,
  });
  const operationsResource = useApiResource('/api/v1/operations', refresh, {
    pollingIntervalMs: 10000,
  });
  const roadsResource = useApiResource('/api/v1/roads', 0, {
    enabled: can('road_problems.create'),
  });
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

  useEffect(() => {
    if (!confirmAction) return undefined;
    const timer = window.setTimeout(() => setConfirmAction(null), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmAction]);

  const roads = Array.isArray(roadsResource.data) ? roadsResource.data : [];

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
  const rpmReading = latestReadings.find((item) => /rpm|rotac/i.test(item.metric));
  const tempReading = latestReadings.find((item) => /temp/i.test(item.metric));
  const fuelReading = latestReadings.find((item) => /combust|fuel/i.test(item.metric));
  const operationStepIndex = !currentOperation
    ? -1
    : currentOperation.status === 'CONCLUIDA'
      ? 2
      : ['EM_EXECUCAO', 'INTERROMPIDA'].includes(currentOperation.status)
        ? 1
        : ['ACEITA', 'ATRIBUIDA'].includes(currentOperation.status)
          ? 0
          : -1;

  async function logout() {
    await signOut();
  }

  async function operationAction(action, body = {}) {
    if (!currentOperation) return;
    setConfirmAction(null);
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

  function handleConfirmedAction(action, body = {}) {
    if (confirmAction !== action) {
      setConfirmAction(action);
      return;
    }
    operationAction(action, body);
  }

  function openRoadProblemModal() {
    setRoadProblemError('');
    setRoadProblemSuccess('');
    setRoadProblemModalOpen(true);
  }

  function closeRoadProblemModal() {
    if (roadProblemSubmitting) return;
    setRoadProblemModalOpen(false);
    setRoadProblemError('');
  }

  async function submitRoadProblem(event) {
    event.preventDefault();
    if (!currentLocation) {
      setRoadProblemError('Posição GPS da máquina indisponível no momento.');
      return;
    }
    setRoadProblemSubmitting(true);
    setRoadProblemError('');
    try {
      const response = await apiFetch('/api/v1/road-problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          road_id: Number(roadProblemDraft.road_id),
          tipo: roadProblemDraft.tipo,
          gravidade: roadProblemDraft.gravidade,
          descricao: roadProblemDraft.descricao.trim() || null,
          geometry: {
            type: 'Point',
            coordinates: [Number(currentLocation.longitude), Number(currentLocation.latitude)],
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      setRoadProblemModalOpen(false);
      setRoadProblemDraft(INITIAL_ROAD_PROBLEM_DRAFT);
      setRoadProblemSuccess('Problema na via registrado com sucesso.');
      setRefresh((value) => value + 1);
    } catch (error) {
      setRoadProblemError(error.message || 'Não foi possível registrar o problema na via.');
    } finally {
      setRoadProblemSubmitting(false);
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
        <div>
          <small>Modo cabine · Minha máquina</small>
          <h1>{assignedMachine?.nome || 'Máquina não atribuída'}</h1>
        </div>
        {assignedMachine ? (
          <div className="operator-live-badges">
            <StatusBadge tone={assignedMachine.status === 'active' || assignedMachine.status === 'ATIVA' ? 'success' : 'neutral'}>
              {assignedMachine.status}
            </StatusBadge>
            <StatusBadge tone={currentLocation ? 'success' : 'neutral'}>
              {currentLocation ? 'Ao vivo' : 'Sem GPS'}
            </StatusBadge>
          </div>
        ) : null}
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
            <article><small>Velocidade</small><strong className="mono">{speedReading ? `${speedReading.valor} ${speedReading.unidade || 'km/h'}` : '—'}</strong></article>
            <article><small>RPM</small><strong className="mono">{rpmReading ? `${rpmReading.valor} ${rpmReading.unidade || 'rpm'}` : '—'}</strong></article>
            <article><small>Temperatura</small><strong className="mono">{tempReading ? `${tempReading.valor} ${tempReading.unidade || '°C'}` : '—'}</strong></article>
            <article><small>Combustível</small><strong className="mono">{fuelReading ? `${fuelReading.valor} ${fuelReading.unidade || '%'}` : '—'}</strong></article>
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
                  <div className="operator-task-head">
                    <h2>{currentOperation.name}</h2>
                    <StatusBadge tone={currentOperation.status === 'EM_EXECUCAO' ? 'success' : currentOperation.status === 'INTERROMPIDA' ? 'warning' : 'neutral'}>
                      {currentOperation.status.replaceAll('_', ' ')}
                    </StatusBadge>
                  </div>
                  <p>{currentOperation.operation_type} · Talhão: {currentOperation.field_name}</p>
                  <div className="operator-lifecycle-steps" aria-label="Etapas da operação">
                    {['Aceita', 'Em Execução', 'Concluída'].map((stepLabel, index) => {
                      const stateClass = index < operationStepIndex
                        ? 'done'
                        : index === operationStepIndex
                          ? 'current'
                          : 'upcoming';
                      return (
                        <div key={stepLabel} className={`operator-step-pill ${stateClass}`}>
                          <span className="operator-step-dot" />
                          <span>{stepLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                  {latestRoute ? <p className="mono">Trajeto recomendado: {Number(latestRoute.distance_m).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m · versão {latestRoute.version}</p> : <p>A rota ainda não foi calculada pela coordenação.</p>}
                  {historyResource.error ? <ErrorState message={historyResource.error} onRetry={historyResource.reload} /> : null}
                  <div className="operator-operation-actions">
                    {currentOperation.status === 'ATRIBUIDA' ? <button type="button" className="operator-primary-action" disabled={sending} onClick={() => operationAction('accept')}>Aceitar operação</button> : null}
                    {currentOperation.status === 'ACEITA' ? <button type="button" className="operator-primary-action" disabled={sending} onClick={() => operationAction('start')}>Iniciar operação</button> : null}
                    {currentOperation.status === 'EM_EXECUCAO' ? <button type="button" disabled={sending} onClick={() => operationAction('interrupt', { reason: 'Parada informada pelo operador.' })}>Informar parada</button> : null}
                    {currentOperation.status === 'INTERROMPIDA' ? <button type="button" className="operator-primary-action" disabled={sending} onClick={() => operationAction('resume')}>Retomar operação</button> : null}
                    {currentOperation.status === 'EM_EXECUCAO' ? (
                      <button
                        type="button"
                        className={confirmAction === 'complete' ? 'complete confirming' : 'complete'}
                        disabled={sending}
                        onClick={() => handleConfirmedAction('complete')}
                      >
                        {confirmAction === 'complete' ? 'Confirmar finalização?' : 'Finalizar operação'}
                      </button>
                    ) : null}
                    {['ATRIBUIDA', 'ACEITA', 'INTERROMPIDA'].includes(currentOperation.status) ? (
                      <button
                        type="button"
                        className={confirmAction === 'cancel' ? 'danger confirming' : 'danger'}
                        disabled={sending}
                        onClick={() => handleConfirmedAction('cancel', { reason: 'Cancelada pelo operador.' })}
                      >
                        {confirmAction === 'cancel' ? 'Confirmar cancelamento?' : 'Cancelar'}
                      </button>
                    ) : null}
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

          {roadProblemSuccess ? (
            <div className="operator-road-problem-success" role="status">
              <CheckCircle2 size={18} />
              <span>{roadProblemSuccess}</span>
            </div>
          ) : null}

          {can('road_problems.create') ? (
            <button type="button" className="operator-occurrence-button" onClick={openRoadProblemModal}>
              <AlertTriangle size={21} /> Informar problema na via
            </button>
          ) : null}

          {roadProblemModalOpen ? (
            <div className="field-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="operator-road-problem-title">
              <div className="field-modal operator-road-problem-modal">
                <div className="field-modal-header">
                  <div>
                    <p className="modal-kicker">Modo cabine</p>
                    <h3 id="operator-road-problem-title">Informar problema na via</h3>
                  </div>
                  <button
                    type="button"
                    className="close-button"
                    onClick={closeRoadProblemModal}
                    aria-label="Fechar modal"
                    disabled={roadProblemSubmitting}
                  >
                    <X size={18} />
                  </button>
                </div>

                {roadsResource.error ? <ErrorState message={roadsResource.error} onRetry={roadsResource.reload} /> : null}
                {roadProblemError ? <ErrorState message={roadProblemError} /> : null}

                {!currentLocation ? (
                  <p className="operator-road-gps-warning">
                    Posição GPS da máquina indisponível no momento. Aguarde a próxima leitura de localização para enviar.
                  </p>
                ) : (
                  <p className="operator-road-gps-info">
                    Localização capturada da máquina: {Number(currentLocation.latitude).toFixed(5)}, {Number(currentLocation.longitude).toFixed(5)}
                  </p>
                )}

                <form className="operator-occurrence-form" onSubmit={submitRoadProblem}>
                  <label>
                    Estrada
                    <select
                      required
                      value={roadProblemDraft.road_id}
                      onChange={(event) => setRoadProblemDraft((prev) => ({ ...prev, road_id: event.target.value }))}
                      disabled={roadsResource.loading || roadProblemSubmitting}
                    >
                      <option value="">
                        {roadsResource.loading ? 'Carregando estradas...' : 'Selecione a estrada'}
                      </option>
                      {roads.map((road) => (
                        <option key={road.id} value={road.id}>
                          {road.nome || `Estrada ${road.id}`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Tipo de problema
                    <select
                      value={roadProblemDraft.tipo}
                      onChange={(event) => setRoadProblemDraft((prev) => ({ ...prev, tipo: event.target.value }))}
                      disabled={roadProblemSubmitting}
                    >
                      {ROAD_PROBLEM_TYPES.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Gravidade
                    <select
                      value={roadProblemDraft.gravidade}
                      onChange={(event) => setRoadProblemDraft((prev) => ({ ...prev, gravidade: event.target.value }))}
                      disabled={roadProblemSubmitting}
                    >
                      {ROAD_PROBLEM_SEVERITIES.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Descrição
                    <textarea
                      maxLength={4000}
                      placeholder="Descreva o obstáculo, extensão ou risco na via..."
                      value={roadProblemDraft.descricao}
                      onChange={(event) => setRoadProblemDraft((prev) => ({ ...prev, descricao: event.target.value }))}
                      disabled={roadProblemSubmitting}
                    />
                  </label>

                  <div className="operator-modal-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={closeRoadProblemModal}
                      disabled={roadProblemSubmitting}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={roadProblemSubmitting || !currentLocation || !roadProblemDraft.road_id}
                    >
                      {roadProblemSubmitting ? 'Enviando...' : 'Registrar problema'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
          <p className="operator-data-note"><Sprout size={14} />Informações exibidas somente para a máquina vinculada ao seu usuário.</p>
        </>
      ) : null}
    </main>
  );
}
