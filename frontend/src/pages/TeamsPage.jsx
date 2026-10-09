import React, { useState } from 'react';
import { Plus, UsersRound } from 'lucide-react';

import { apiFetch } from '../api/apiClient';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';

const asList = (value) => Array.isArray(value) ? value : [];

export default function TeamsPage() {
  const { can } = useAuth();
  const teamsResource = useApiResource('/api/v1/teams');
  const machinesResource = useApiResource('/api/v1/machines');
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [teamForm, setTeamForm] = useState({ name: '', code: '', description: '' });
  const [memberForm, setMemberForm] = useState({ user_id: '', team_role: 'OPERATOR' });
  const [machineForm, setMachineForm] = useState({ machine_id: '', operator_id: '' });
  const teams = asList(teamsResource.data);
  const machines = asList(machinesResource.data);
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) || teams[0] || null;
  const candidatesResource = useApiResource(
    `/api/v1/teams/${selectedTeam?.id}/member-candidates?team_role=${memberForm.team_role}`,
    refresh,
    { enabled: Boolean(selectedTeam?.id) && can('teams.manage') },
  );
  const membersResource = useApiResource(
    `/api/v1/teams/${selectedTeam?.id}/members`, refresh, { enabled: Boolean(selectedTeam?.id) },
  );
  const assignmentsResource = useApiResource(
    `/api/v1/teams/${selectedTeam?.id}/machines`, refresh, { enabled: Boolean(selectedTeam?.id) },
  );
  const members = asList(membersResource.data);
  const assignments = asList(assignmentsResource.data);
  const eligibleMembers = asList(candidatesResource.data);
  const eligibleOperators = members.filter(
    (member) => member.team_role === 'OPERATOR' && member.is_active,
  );

  async function submit(endpoint, method, body) {
    setBusy(true);
    setFormError('');
    try {
      const response = await apiFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      setRefresh((value) => value + 1);
      return true;
    } catch (error) {
      setFormError(error.message || 'Não foi possível concluir a operação.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createTeam(event) {
    event.preventDefault();
    if (await submit('/api/v1/teams', 'POST', teamForm)) {
      setTeamForm({ name: '', code: '', description: '' });
      teamsResource.reload();
    }
  }

  async function addMember(event) {
    event.preventDefault();
    if (!selectedTeam) return;
    if (await submit(`/api/v1/teams/${selectedTeam.id}/members`, 'POST', {
      ...memberForm, user_id: Number(memberForm.user_id),
    })) {
      setMemberForm({ user_id: '', team_role: 'OPERATOR' });
    }
  }

  async function assignMachine(event) {
    event.preventDefault();
    if (!selectedTeam) return;
    if (await submit(
      `/api/v1/teams/${selectedTeam.id}/machines/${machineForm.machine_id}/assignments`,
      'POST',
      {
        team_id: selectedTeam.id,
        operator_id: machineForm.operator_id ? Number(machineForm.operator_id) : null,
      },
    )) {
      setMachineForm({ machine_id: '', operator_id: '' });
    }
  }

  return (
    <div className="cycle-screen">
      <PageHeading
        eyebrow="Organização operacional"
        title="Equipes"
        description="Associe pessoas e máquinas usando os usuários cadastrados nesta fazenda."
      />
      {teamsResource.error ? <ErrorState message={teamsResource.error} onRetry={teamsResource.reload} /> : null}
      {formError ? <ErrorState message={formError} /> : null}

      {can('teams.manage') ? <section className="cycle-create-panel">
        <h2><Plus size={18} /> Criar equipe</h2>
        <form className="cycle-form-grid" onSubmit={createTeam}>
          <label>Nome<input required minLength="2" maxLength="120" value={teamForm.name} onChange={(event) => setTeamForm({ ...teamForm, name: event.target.value })} /></label>
          <label>Código<input required minLength="2" maxLength="40" value={teamForm.code} onChange={(event) => setTeamForm({ ...teamForm, code: event.target.value })} /></label>
          <label className="cycle-form-wide">Descrição<input value={teamForm.description} onChange={(event) => setTeamForm({ ...teamForm, description: event.target.value })} /></label>
          <button className="toolbar-button primary" disabled={busy} type="submit">Salvar equipe</button>
        </form>
      </section> : null}

      {teamsResource.loading ? <LoadingState label="Carregando equipes..." /> : null}
      {!teamsResource.loading && !teamsResource.error && !teams.length ? (
        <EmptyState title="Nenhuma equipe cadastrada" description="As equipes serão listadas aqui após serem criadas." icon={UsersRound} />
      ) : null}
      {selectedTeam ? (
        <section className="cycle-workspace">
          <aside className="cycle-list-panel">
            <div className="list-panel-heading"><strong>Equipes da fazenda</strong><span>{teams.length}</span></div>
            {teams.map((team) => (
              <button key={team.id} type="button" onClick={() => setSelectedTeamId(team.id)} className={`cycle-team-choice ${selectedTeam.id === team.id ? 'selected' : ''}`}>
                <strong>{team.name}</strong><span>{team.code}</span><small>{team.member_count} membros</small>
              </button>
            ))}
          </aside>
          <div className="cycle-detail-panel">
            <header><div><span className="section-overline">Equipe selecionada</span><h2>{selectedTeam.name}</h2><p>{selectedTeam.description || 'Sem descrição.'}</p></div><strong>{selectedTeam.code}</strong></header>

            <section className="cycle-subpanel">
              <h3>Membros</h3>
              {membersResource.error ? <ErrorState message={membersResource.error} onRetry={membersResource.reload} /> : null}
              {candidatesResource.error ? <ErrorState message={candidatesResource.error} onRetry={candidatesResource.reload} /> : null}
              {membersResource.loading ? <LoadingState label="Carregando membros..." /> : null}
              {!membersResource.loading && members.length ? (
                <div className="cycle-table-wrap"><table className="cycle-table"><thead><tr><th>Nome</th><th>E-mail</th><th>Função na equipe</th><th>Status</th></tr></thead><tbody>
                  {members.map((member) => <tr key={member.user_id}><td>{member.full_name || member.username}</td><td>{member.email}</td><td>{member.team_role}</td><td>{member.is_active ? 'Ativo' : 'Inativo'}</td></tr>)}
                </tbody></table></div>
              ) : null}
              {can('teams.manage') ? <form className="cycle-inline-form" onSubmit={addMember}>
                <label>Função<select value={memberForm.team_role} onChange={(event) => setMemberForm({ team_role: event.target.value, user_id: '' })}><option value="OPERATOR">Operador</option><option value="SUPERVISOR">Supervisor</option><option value="TECHNICIAN">Técnico</option></select></label>
                <label>Usuário<select required value={memberForm.user_id} onChange={(event) => setMemberForm({ ...memberForm, user_id: event.target.value })}><option value="">Selecione</option>{eligibleMembers.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.username} · {user.role}</option>)}</select></label>
                <button className="toolbar-button primary" disabled={busy || candidatesResource.loading || eligibleMembers.length === 0} type="submit">Adicionar membro</button>
              </form> : null}
            </section>

            <section className="cycle-subpanel">
              <h3>Histórico de atribuições de máquinas</h3>
              {assignmentsResource.error ? <ErrorState message={assignmentsResource.error} onRetry={assignmentsResource.reload} /> : null}
              {assignmentsResource.loading ? <LoadingState label="Carregando máquinas..." /> : null}
              {!assignmentsResource.loading && assignments.length ? (
                <div className="cycle-table-wrap"><table className="cycle-table"><thead><tr><th>Máquina</th><th>Operador</th><th>Início</th><th>Status</th></tr></thead><tbody>
                  {assignments.map((assignment) => <tr key={assignment.id}><td>{assignment.machine_name}</td><td>{assignment.operator_name || '—'}</td><td>{new Date(assignment.assigned_from).toLocaleString('pt-BR')}</td><td>{assignment.is_active ? 'Ativa' : 'Encerrada'}</td></tr>)}
                </tbody></table></div>
              ) : null}
              {can('teams.manage') ? <form className="cycle-inline-form" onSubmit={assignMachine}>
                <label>Máquina<select required value={machineForm.machine_id} onChange={(event) => setMachineForm({ ...machineForm, machine_id: event.target.value })}><option value="">Selecione</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.nome} · {machine.code}</option>)}</select></label>
                <label>Operador (opcional)<select value={machineForm.operator_id} onChange={(event) => setMachineForm({ ...machineForm, operator_id: event.target.value })}><option value="">Somente equipe</option>{eligibleOperators.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.username}</option>)}</select></label>
                <button className="toolbar-button primary" disabled={busy || machinesResource.loading} type="submit">Atribuir máquina</button>
              </form> : null}
              {machinesResource.error ? <ErrorState message={machinesResource.error} onRetry={machinesResource.reload} /> : null}
            </section>
          </div>
        </section>
      ) : null}
    </div>
  );
}
