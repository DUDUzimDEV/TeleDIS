import React, { useMemo, useState } from 'react';
import { MapPin, Pencil, Plus, Search, Tractor } from 'lucide-react';
import { Link } from 'react-router-dom';

import { apiFetch, readApiResponse } from '../api/apiClient';
import EntityMap from '../components/map/EntityMap';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime } from '../utils/geoData';
import { getCommunicationStatus, getLatestTimestamp } from '../utils/liveStatus';

const asList = (value) => Array.isArray(value) ? value : [];
const emptyForm = { name: '', code: '', status: 'active' };
const LIVE_REFRESH_INTERVAL_MS = 5000;

export default function MachinesPage() {
  const { can } = useAuth();
  const machinesResource = useApiResource('/api/v1/machines', 0, { pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS });
  const locationsResource = useApiResource('/api/v1/locations?limit=1000', 0, { pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS });
  const telemetryResource = useApiResource('/api/v1/telemetry', 0, {
    enabled: can('telemetry.view') && !can('telemetry.history'),
    pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
  });
  const operationsResource = useApiResource(
    '/api/v1/operations',
    0,
    { enabled: can('operations.view'), pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS },
  );
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const machines = asList(machinesResource.data);
  const locations = asList(locationsResource.data);
  const operations = asList(operationsResource.data);
  const selected = machines.find((machine) => machine.id === selectedId) || machines[0] || null;
  const selectedTelemetryResource = useApiResource(
    selected ? `/api/v1/telemetry/${selected.id}` : '',
    0,
    {
      enabled: Boolean(selected && can('telemetry.history')),
      pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
    },
  );
  const readings = can('telemetry.history')
    ? asList(selectedTelemetryResource.data?.historico)
    : asList(telemetryResource.data);
  const activeTelemetryResource = can('telemetry.history') ? selectedTelemetryResource : telemetryResource;
  const latestLocation = selected
    ? [...locations].filter((location) => String(location.maquina_id) === String(selected.id))
      .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0]
    : null;
  const latestReadings = selected
    ? readings.filter((reading) => String(reading.maquina_id) === String(selected.id))
      .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
    : [];
  const machineLastUpdate = getLatestTimestamp(latestLocation?.timestamp, latestReadings[0]?.timestamp);
  const communicationStatus = getCommunicationStatus(machineLastUpdate);
  const machineOperations = selected
    ? operations.filter((operation) => String(operation.machine_id) === String(selected.id))
      .sort((left, right) => new Date(right.updated_at || right.created_at || 0) - new Date(left.updated_at || left.created_at || 0))
    : [];
  const currentOperation = machineOperations.find(
    (operation) => !['CONCLUIDA', 'CANCELADA'].includes(operation.status),
  ) || machineOperations[0] || null;
  const simulatorContextResource = useApiResource(
    selected ? `/api/v1/simulator/machines/${selected.id}/context` : '',
    0,
    {
      enabled: Boolean(selected && can('machines.view')),
      pollingIntervalMs: ['EM_EXECUCAO', 'INTERROMPIDA'].includes(currentOperation?.status)
        ? LIVE_REFRESH_INTERVAL_MS
        : 0,
    },
  );
  const simulatorContext = simulatorContextResource.data;
  const types = [...new Set(machines.map((machine) => machine.tipo).filter(Boolean))];
  const statuses = [...new Set(machines.map((machine) => machine.status).filter(Boolean))];
  const filteredMachines = useMemo(() => machines.filter((machine) => (
    `${machine.nome || ''} ${machine.code || ''} ${machine.tipo || ''} ${machine.id}`.toLowerCase().includes(search.toLowerCase())
    && (statusFilter === 'all' || machine.status === statusFilter)
    && (typeFilter === 'all' || machine.tipo === typeFilter)
  )), [machines, search, statusFilter, typeFilter]);

  const activeCount = machines.filter((machine) => /ativo|active|operando/i.test(machine.status || '')).length;
  const maintenanceCount = machines.filter((machine) => /manuten/i.test(machine.status || '')).length;
  const stoppedCount = machines.length - activeCount - maintenanceCount;

  function beginCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setShowForm(true);
  }

  function beginEdit(machine) {
    setEditingId(machine.id);
    setForm({ name: machine.nome || '', code: machine.code || '', status: machine.status || 'active' });
    setFormError('');
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
  }

  async function saveMachine(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const response = await apiFetch(
        editingId ? `/api/v1/machines/${editingId}` : '/api/v1/machines',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            code: form.code.trim(),
            status: form.status,
          }),
        },
      );
      const payload = await readApiResponse(response);
      setSelectedId(payload?.data?.id ?? editingId);
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      machinesResource.reload();
    } catch (error) {
      setFormError(error.message || 'Não foi possível salvar a máquina.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fleet-screen">
      <PageHeading
        eyebrow="Gestão de ativos"
        title="Frota"
        description="Estado cadastral e últimas informações recebidas para cada máquina."
        actions={(
          <>
            <span className="updated-label">Dados consultados nas APIs de frota e telemetria</span>
            {can('machines.create') ? (
              <button className="toolbar-button primary" type="button" onClick={beginCreate}>
                <Plus size={16} />Cadastrar máquina
              </button>
            ) : null}
          </>
        )}
      />

      {showForm ? (
        <section className="cycle-create-panel" aria-label={editingId ? 'Editar máquina' : 'Cadastrar máquina'}>
          <h2>{editingId ? 'Editar máquina' : 'Cadastrar máquina'}</h2>
          <form className="cycle-form-grid" onSubmit={saveMachine}>
            <label>
              Identificação
              <input
                required
                minLength={2}
                maxLength={120}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label>
              Código
              <input
                required
                minLength={2}
                maxLength={50}
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
            </label>
            <label>
              Status
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                <option value="active">Ativa</option>
                <option value="maintenance">Em manutenção</option>
                <option value="inactive">Inativa</option>
                {!['active', 'maintenance', 'inactive'].includes(form.status) ? (
                  <option value={form.status}>{form.status}</option>
                ) : null}
              </select>
            </label>
            {formError ? <p className="field-form-error" role="alert">{formError}</p> : null}
            <div className="cycle-actions">
              <button className="toolbar-button primary" disabled={saving} type="submit">
                {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Cadastrar máquina'}
              </button>
              <button className="toolbar-button outline" disabled={saving} onClick={closeForm} type="button">
                Cancelar
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="fleet-summary" aria-label="Resumo da frota">
        <div><span>Total cadastrado</span><strong>{machinesResource.loading ? '—' : machines.length}</strong></div>
        <div><span>Ativas</span><strong className="text-success">{machinesResource.loading ? '—' : activeCount}</strong></div>
        <div><span>Em manutenção</span><strong className="text-warning">{machinesResource.loading ? '—' : maintenanceCount}</strong></div>
        <div><span>Outros status</span><strong>{machinesResource.loading ? '—' : stoppedCount}</strong></div>
      </section>

      {machinesResource.error ? <ErrorState message={machinesResource.error} onRetry={machinesResource.reload} /> : null}
      {locationsResource.error ? <ErrorState message={locationsResource.error} onRetry={locationsResource.reload} /> : null}
      {telemetryResource.error ? <ErrorState message={telemetryResource.error} onRetry={telemetryResource.reload} /> : null}
      {selectedTelemetryResource.error ? <ErrorState message={selectedTelemetryResource.error} onRetry={selectedTelemetryResource.reload} /> : null}
      {simulatorContextResource.error ? (
        <ErrorState message={simulatorContextResource.error} onRetry={simulatorContextResource.reload} />
      ) : null}
      {operationsResource.error ? <ErrorState message={operationsResource.error} onRetry={operationsResource.reload} /> : null}

      <div className="fleet-toolbar">
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar máquina ou tipo" aria-label="Buscar máquina" />
        </label>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filtrar por tipo">
          <option value="all">Todos os tipos</option>
          {types.map((type) => <option value={type} key={type}>{type}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por status">
          <option value="all">Todos os status</option>
          {statuses.map((status) => <option value={status} key={status}>{status}</option>)}
        </select>
      </div>

      <section className="fleet-workspace">
        <div className="fleet-list-panel">
          <div className="list-panel-heading"><strong>Máquinas</strong><span>{filteredMachines.length}</span></div>
          {machinesResource.loading ? <LoadingState label="Carregando frota..." /> : null}
          {!machinesResource.loading && !machinesResource.error && !filteredMachines.length ? (
            <EmptyState title={machines.length ? 'Nenhuma máquina encontrada' : 'Nenhuma máquina cadastrada.'} description={machines.length ? 'Ajuste os filtros para ver outros itens.' : 'As máquinas cadastradas para a fazenda ativa aparecerão aqui.'} icon={Tractor} />
          ) : null}
          <div className="fleet-list">
            {filteredMachines.map((machine) => (
              <button
                type="button"
                key={machine.id}
                className={`fleet-list-item ${selected?.id === machine.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(machine.id)}
              >
                <span className="asset-icon"><Tractor size={17} /></span>
                <span className="asset-details">
                  <strong>{machine.nome || `Máquina ${machine.id}`}</strong>
                  <small>{machine.code || `#${machine.id}`} · {machine.tipo || 'Tipo não informado'}</small>
                </span>
                <StatusBadge>{machine.status}</StatusBadge>
              </button>
            ))}
          </div>
        </div>

        <article className="machine-detail-panel">
          {selected ? (
            <>
              <header className="machine-detail-header">
                <div>
                  <span className="section-overline">Ficha de ativo · #{selected.id}</span>
                  <h2>{selected.nome || `Máquina ${selected.id}`}</h2>
                </div>
                <div className="cycle-actions">
                  <StatusBadge>{selected.status}</StatusBadge>
                  {can('machines.update') ? (
                    <button className="toolbar-button outline" type="button" onClick={() => beginEdit(selected)}>
                      <Pencil size={15} />Editar
                    </button>
                  ) : null}
                </div>
              </header>
              <div className="machine-detail-meta">
                <div><span>Código</span><strong>{selected.code || '—'}</strong></div>
                <div><span>Tipo</span><strong>{selected.tipo || 'Não informado pela API'}</strong></div>
                <div><span>Último GPS</span><strong>{formatDateTime(latestLocation?.timestamp)}</strong></div>
                <div><span>Latitude</span><strong>{latestLocation?.latitude ?? '—'}</strong></div>
                <div><span>Longitude</span><strong>{latestLocation?.longitude ?? '—'}</strong></div>
                <div>
                  <span>Origem do GPS</span>
                  <strong>{latestLocation?.source === 'SIMULATED' ? 'DADO SIMULADO' : latestLocation?.source === 'REAL' ? 'Dado real' : '—'}</strong>
                </div>
              </div>

              <section className="machine-readings simulator-context-panel" aria-label="Contexto operacional">
                <div className="section-heading compact-heading">
                  <div>
                    <span className="section-overline">Contexto operacional</span>
                    <h3>Estado derivado do sistema</h3>
                  </div>
                </div>
                {simulatorContextResource.loading ? <LoadingState label="Consultando contexto..." /> : null}
                {simulatorContextResource.error ? <ErrorState message={simulatorContextResource.error} onRetry={simulatorContextResource.reload} /> : null}
                {!simulatorContextResource.loading && simulatorContext ? (
                  <div className="machine-detail-meta">
                    <div>
                      <span>Estado do simulador</span>
                      <strong>{simulatorContext.simulator_state || '—'}</strong>
                    </div>
                    <div>
                      <span>Estado oficial da operação</span>
                      <strong>{simulatorContext.operation_state || 'Nenhuma operação associada'}</strong>
                    </div>
                    <div>
                      <span>Comunicação</span>
                      <strong className={`live-status live-status-${communicationStatus.toLowerCase()}`}>
                        {communicationStatus === 'ONLINE' ? 'Online' : communicationStatus === 'STALE' ? 'Desatualizada' : 'Sem dados'}
                      </strong>
                    </div>
                    <div>
                      <span>Última atualização</span>
                      <strong>{formatDateTime(machineLastUpdate)}</strong>
                    </div>
                    <div>
                      <span>Operação</span>
                      <strong>{simulatorContext.operation?.name || 'Nenhuma'}</strong>
                    </div>
                    <div>
                      <span>Talhão de destino</span>
                      <strong>{simulatorContext.field?.name || '—'}</strong>
                    </div>
                    <div>
                      <span>Base</span>
                      <strong>{simulatorContext.base_structure?.name || 'Sem associação cadastrada'}</strong>
                    </div>
                    <div>
                      <span>Motivo do estado</span>
                      <strong>{simulatorContext.state_reason || '—'}</strong>
                    </div>
                  </div>
                ) : null}
              </section>

              <div className="machine-readings">
                <div className="section-heading compact-heading">
                  <div><span className="section-overline">Telemetria disponível</span><h3>Últimas medições</h3></div>
                </div>
                {activeTelemetryResource.loading ? <LoadingState label="Consultando telemetria..." /> : null}
                {!activeTelemetryResource.loading && !latestReadings.length ? (
                  <EmptyState title="Sem medições disponíveis" description="Não há leituras recentes associadas a esta máquina." />
                ) : null}
                {latestReadings.slice(0, 6).map((reading) => (
                  <div className="reading-row" key={reading.id}>
                    <span>
                      {reading.metric}
                      {reading.source === 'SIMULATED' ? (
                        <small className="simulation-data-label">DADO SIMULADO</small>
                      ) : null}
                    </span>
                    <strong>{reading.valor} {reading.unidade || ''}</strong>
                    <time>{formatDateTime(reading.timestamp)}</time>
                  </div>
                ))}
              </div>

              {can('operations.view') ? (
                <section className="machine-readings machine-operation-panel" aria-label="Operações associadas à máquina">
                  <div className="section-heading compact-heading">
                    <div><span className="section-overline">Vínculo operacional</span><h3>Operação associada</h3></div>
                  </div>
                  {operationsResource.loading ? <LoadingState label="Consultando operações associadas..." /> : null}
                  {!operationsResource.loading && !operationsResource.error && currentOperation ? (
                    <Link className="machine-operation-link" to={`/operacoes/${currentOperation.id}`}>
                      <span><strong>{currentOperation.name || currentOperation.code}</strong><small>{currentOperation.field_name || 'Talhão não informado'} · {currentOperation.operation_type}</small></span>
                      <StatusBadge>{currentOperation.status.replaceAll('_', ' ')}</StatusBadge>
                    </Link>
                  ) : null}
                  {!operationsResource.loading && !operationsResource.error && !currentOperation ? (
                    <EmptyState title="Nenhuma operação associada" description="As operações vinculadas aparecerão aqui quando forem atribuídas." />
                  ) : null}
                </section>
              ) : null}

              <div className="machine-location-block">
                <div className="section-heading compact-heading">
                  <div><span className="section-overline">Geolocalização</span><h3>Último ponto recebido</h3></div>
                  <Link to="/mapa" className="text-link"><MapPin size={15} />Ver mapa</Link>
                </div>
                {latestLocation ? (
                  <EntityMap
                    className="machine-mini-map"
                    machines={[{ ...latestLocation, nome: selected.nome, status: selected.status }]}
                    fitBoundsKey={selected.id}
                    visibleLayers={{ fields: false, structures: false, roads: false, problems: false, machines: true }}
                    zoom={14}
                  />
                ) : (
                  <EmptyState title="Localização não disponível" description="A API não retornou um ponto de GPS para esta máquina." icon={MapPin} />
                )}
              </div>
            </>
          ) : (
            <EmptyState title="Selecione uma máquina" description="Os detalhes e dados disponíveis aparecerão aqui." icon={Tractor} />
          )}
        </article>
      </section>
    </div>
  );
}
