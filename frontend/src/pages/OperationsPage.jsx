import React, { useState } from 'react';
import { ClipboardList, Route as RouteIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import { apiFetch } from '../api/apiClient';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';

const asList = (value) => Array.isArray(value) ? value : [];
export default function OperationsPage() {
  const { can } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ operation_type: 'COLHEITA', name: '', field_id: '', priority: 'NORMAL' });
  const operationsResource = useApiResource('/api/v1/operations', refresh);
  const fieldsResource = useApiResource('/api/v1/fields');
  const teamsResource = useApiResource('/api/v1/teams');
  const machinesResource = useApiResource('/api/v1/machines');
  const operations = asList(operationsResource.data);
  const fields = asList(fieldsResource.data);
  const teams = asList(teamsResource.data);
  const machines = asList(machinesResource.data);
  const selected = operations.find((operation) => operation.id === selectedId) || operations[0] || null;
  const [assignmentTeamId, setAssignmentTeamId] = useState('');
  const teamMembersResource = useApiResource(
    `/api/v1/teams/${assignmentTeamId}/members`,
    refresh,
    { enabled: Boolean(assignmentTeamId) && can('operations.assign') },
  );

  async function send(endpoint, method, body) {
    setBusyId(endpoint);
    setError('');
    try {
      const response = await apiFetch(endpoint, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      setRefresh((value) => value + 1);
      return payload.data;
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível concluir a operação.');
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function createOperation(event) {
    event.preventDefault();
    const result = await send('/api/v1/operations', 'POST', {
      ...form, field_id: Number(form.field_id),
    });
    if (result) {
      setSelectedId(result.id);
      setForm({ operation_type: 'COLHEITA', name: '', field_id: '', priority: 'NORMAL' });
    }
  }

  async function assignOperation(event, operation) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const result = await send(`/api/v1/operations/${operation.id}/assign`, 'POST', {
      machine_id: Number(values.get('machine_id')),
      operator_id: Number(values.get('operator_id')),
      team_id: Number(values.get('team_id')),
    });
    if (result) setSelectedId(result.id);
  }

  const operators = asList(teamMembersResource.data).filter(
    (member) => member.team_role === 'OPERATOR' && member.is_active,
  );

  return (
    <div className="cycle-screen">
      <PageHeading
        eyebrow="Planejamento e execução"
        title="Operações"
        description="Planeje atividades por talhão, atribua equipe e máquina e acompanhe o histórico real de execução."
      />
      {operationsResource.error ? <ErrorState message={operationsResource.error} onRetry={operationsResource.reload} /> : null}
      {error ? <ErrorState message={error} /> : null}

      {can('operations.create') ? <section className="cycle-create-panel">
        <h2><ClipboardList size={18} /> Planejar operação</h2>
        {fieldsResource.error ? <ErrorState message={fieldsResource.error} onRetry={fieldsResource.reload} /> : null}
        <form className="cycle-form-grid" onSubmit={createOperation}>
          <label>Atividade<select value={form.operation_type} onChange={(event) => setForm({ ...form, operation_type: event.target.value })}>{['PLANTIO', 'COLHEITA', 'APLICACAO', 'PULVERIZACAO', 'ADUBACAO', 'PREPARO_SOLO', 'TRANSPORTE', 'MANUTENCAO', 'DESLOCAMENTO', 'OUTRA'].map((type) => <option key={type}>{type}</option>)}</select></label>
          <label>Nome<input required minLength="2" maxLength="160" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Talhão<select required value={form.field_id} onChange={(event) => setForm({ ...form, field_id: event.target.value })}><option value="">Selecione</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.nome}</option>)}</select></label>
          <label>Prioridade<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'].map((priority) => <option key={priority}>{priority}</option>)}</select></label>
          <button className="toolbar-button primary" disabled={Boolean(busyId) || fieldsResource.loading || fields.length === 0} type="submit">Criar planejamento</button>
        </form>
      </section> : null}

      {operationsResource.loading ? <LoadingState label="Carregando operações..." /> : null}
      {!operationsResource.loading && !operationsResource.error && !operations.length ? (
        <EmptyState title="Nenhuma operação planejada" description="Operações cadastradas nesta fazenda aparecerão aqui." icon={ClipboardList} />
      ) : null}
      {selected ? (
        <section className="cycle-workspace">
          <aside className="cycle-list-panel">
            <div className="list-panel-heading"><strong>Programação</strong><span>{operations.length}</span></div>
            {operations.map((operation) => (
              <button key={operation.id} type="button" className={`cycle-operation-choice ${selected.id === operation.id ? 'selected' : ''}`} onClick={() => setSelectedId(operation.id)}>
                <strong>{operation.name}</strong><span>{operation.field_name} · {operation.operation_type}</span><small>{operation.status} · {operation.priority}</small>
              </button>
            ))}
          </aside>
          <article className="cycle-detail-panel">
            <header><div><span className="section-overline">{selected.code} · {selected.operation_type}</span><h2>{selected.name}</h2><p>{selected.description || selected.field_name}</p></div><div className="cycle-detail-heading-actions"><strong className={`cycle-status status-${selected.status.toLowerCase()}`}>{selected.status.replaceAll('_', ' ')}</strong><Link className="toolbar-button outline" to={`/operacoes/${selected.id}`}>Abrir detalhe completo</Link></div></header>
            <dl className="cycle-facts">
              <div><dt>Talhão</dt><dd>{selected.field_name}</dd></div>
              <div><dt>Equipe</dt><dd>{selected.team_name || 'Ainda não atribuída'}</dd></div>
              <div><dt>Máquina</dt><dd>{selected.machine_name || 'Ainda não atribuída'}</dd></div>
              <div><dt>Operador</dt><dd>{selected.operator_name || 'Ainda não atribuído'}</dd></div>
              <div><dt>Supervisor</dt><dd>{selected.supervisor_name || '—'}</dd></div>
              <div><dt>Início real</dt><dd>{selected.started_at ? new Date(selected.started_at).toLocaleString('pt-BR') : '—'}</dd></div>
            </dl>

            {selected.status === 'PLANEJADA' && can('operations.assign') ? (
              <section className="cycle-subpanel">
                <h3>Atribuir equipe e máquina</h3>
                {teamsResource.error ? <ErrorState message={teamsResource.error} onRetry={teamsResource.reload} /> : null}
                {machinesResource.error ? <ErrorState message={machinesResource.error} onRetry={machinesResource.reload} /> : null}
                {teamMembersResource.error ? <ErrorState message={teamMembersResource.error} onRetry={teamMembersResource.reload} /> : null}
                <form className="cycle-inline-form" onSubmit={(event) => assignOperation(event, selected)}>
                  <label>Equipe<select required name="team_id" value={assignmentTeamId} onChange={(event) => setAssignmentTeamId(event.target.value)}><option value="">Selecione</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
                  <label>Máquina<select required name="machine_id" defaultValue=""><option value="">Selecione</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.nome} · {machine.status}</option>)}</select></label>
                  <label>Operador<select required key={assignmentTeamId} name="operator_id" defaultValue="" disabled={!assignmentTeamId || teamMembersResource.loading}><option value="">Selecione</option>{operators.map((operator) => <option key={operator.user_id} value={operator.user_id}>{operator.full_name || operator.username}</option>)}</select></label>
                  <button className="toolbar-button primary" disabled={Boolean(busyId)} type="submit">Atribuir operação</button>
                </form>
              </section>
            ) : null}
            {selected.machine_id && !['CONCLUIDA', 'CANCELADA'].includes(selected.status) && can('operations.assign') ? (
              <div className="cycle-actions">
                <button className="toolbar-button outline" type="button" disabled={Boolean(busyId)} onClick={() => send(`/api/v1/operations/${selected.id}/route`, 'POST', {})}><RouteIcon size={16} /> Calcular rota Dijkstra</button>
                <button className="toolbar-button outline" type="button" disabled={Boolean(busyId)} onClick={() => send(`/api/v1/operations/${selected.id}/cancel`, 'POST', { reason: 'Cancelada pela coordenação.' })}>Cancelar operação</button>
              </div>
            ) : null}
            {selected.status !== 'PLANEJADA' ? <OperationHistory key={`${selected.id}-${refresh}`} operationId={selected.id} /> : null}
          </article>
        </section>
      ) : null}
    </div>
  );
}

function OperationHistory({ operationId }) {
  const historyResource = useApiResource(`/api/v1/operations/${operationId}/history`);
  const locationsResource = useApiResource(`/api/v1/operations/${operationId}/locations`);
  const occurrencesResource = useApiResource(`/api/v1/operations/${operationId}/occurrences`);
  const history = historyResource.data || { statuses: [], routes: [] };
  const occurrences = asList(occurrencesResource.data);
  const comparison = locationsResource.data?.comparison;

  return (
    <section className="cycle-subpanel">
      <h3>Histórico e resultado operacional</h3>
      {historyResource.error ? <ErrorState message={historyResource.error} onRetry={historyResource.reload} /> : null}
      {locationsResource.error ? <ErrorState message={locationsResource.error} onRetry={locationsResource.reload} /> : null}
      {occurrencesResource.error ? <ErrorState message={occurrencesResource.error} onRetry={occurrencesResource.reload} /> : null}
      {historyResource.loading ? <LoadingState label="Consultando histórico..." /> : null}
      {history.routes?.length ? <div className="cycle-history-list">{history.routes.map((route) => <article key={route.version}><strong>Rota versão {route.version}</strong><span>{Number(route.distance_m).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m · calculada {new Date(route.created_at).toLocaleString('pt-BR')}</span></article>)}</div> : null}
      {comparison ? <p className="cycle-data-note">{comparison.sufficient_data ? `Distância observada: ${comparison.actual_distance_m == null ? 'indisponível' : `${Number(comparison.actual_distance_m).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m`}.` : 'Comparação de trajeto ainda sem amostras GPS suficientes.'}</p> : null}
      {occurrences.length ? <div className="cycle-history-list">{occurrences.map((occurrence) => <article key={occurrence.id}><strong>{occurrence.occurrence_type}</strong><span>{occurrence.description} · {new Date(occurrence.created_at).toLocaleString('pt-BR')}</span></article>)}</div> : null}
      {occurrencesResource.loading ? <LoadingState label="Carregando ocorrências..." /> : null}
    </section>
  );
}
