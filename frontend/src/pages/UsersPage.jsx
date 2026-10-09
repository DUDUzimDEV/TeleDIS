import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, Search, UserRoundCog } from 'lucide-react';

import { apiFetch } from '../api/apiClient';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import useApiResource from '../hooks/useApiResource';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../utils/geoData';

const roleLabels = {
  OWNER: 'Proprietário',
  FARM_ADMIN: 'Administrador',
  COORDINATOR: 'Coordenador',
  SUPERVISOR: 'Supervisor',
  OPERATOR: 'Operador',
  TECHNICIAN: 'Técnico / manutenção',
  ANALYST: 'Analista / visualização',
};

export default function UsersPage() {
  const usersResource = useApiResource('/api/v1/users');
  const rolesResource = useApiResource('/api/v1/roles');
  const { can } = useAuth();
  const machinesResource = useApiResource('/api/v1/machines', 0, { enabled: can('machines.view') });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [permissionRows, setPermissionRows] = useState([]);
  const [permissionError, setPermissionError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [userEditError, setUserEditError] = useState('');
  const [userEditDraft, setUserEditDraft] = useState({});
  const [draft, setDraft] = useState({ username: '', email: '', full_name: '', password: '', role: 'OPERATOR', phone: '', assigned_machine_id: '' });

  const users = Array.isArray(usersResource.data) ? usersResource.data : [];
  const roles = Array.isArray(rolesResource.data) ? rolesResource.data : [];
  const machines = Array.isArray(machinesResource.data) ? machinesResource.data : [];
  const visibleUsers = useMemo(() => users.filter((user) => (
    (roleFilter === 'all' || user.role === roleFilter)
    && `${user.full_name || ''} ${user.username} ${user.email}`.toLowerCase().includes(search.toLowerCase())
  )), [users, roleFilter, search]);
  const selectedUser = users.find((user) => user.id === selectedId) || null;

  useEffect(() => {
    if (!selectedUser) return;
    setUserEditDraft({
      full_name: selectedUser.full_name || '',
      email: selectedUser.email || '',
      phone: selectedUser.phone || '',
      role: selectedUser.role,
      assigned_machine_id: selectedUser.assigned_machine_id || '',
    });
    setUserEditError('');
  }, [selectedUser?.id]);

  useEffect(() => {
    if (!selectedUser || !can('users.permissions')) {
      setPermissionRows([]);
      return;
    }
    setPermissionError('');
    let active = true;
    apiFetch(`/api/v1/users/${selectedUser.id}/permissions`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (active) setPermissionRows(payload.data || []);
      })
      .catch((error) => {
        if (active) setPermissionError(`Não foi possível carregar permissões: ${error.message}`);
      });
    return () => { active = false; };
  }, [selectedUser?.id, can]);

  async function updateUser(event) {
    event.preventDefault();
    setUserEditError('');
    try {
      const response = await apiFetch(`/api/v1/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...userEditDraft,
          phone: userEditDraft.phone || null,
          assigned_machine_id: userEditDraft.role === 'OPERATOR' && userEditDraft.assigned_machine_id
            ? Number(userEditDraft.assigned_machine_id)
            : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      usersResource.reload();
    } catch (error) {
      setUserEditError(error.message);
    }
  }

  async function createUser(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const response = await apiFetch('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          assigned_machine_id: draft.assigned_machine_id ? Number(draft.assigned_machine_id) : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      setFormOpen(false);
      setDraft({ username: '', email: '', full_name: '', password: '', role: 'OPERATOR', phone: '', assigned_machine_id: '' });
      usersResource.reload();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleUserStatus(user) {
    const status = user.status === 'active' ? 'inactive' : 'active';
    try {
      const response = await apiFetch(`/api/v1/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      usersResource.reload();
    } catch (error) {
      setFormError(error.message);
    }
  }

  async function setOverride(permission) {
    setPermissionError('');
    try {
      const response = await apiFetch(`/api/v1/users/${selectedUser.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: permission.code, allowed: !permission.effective }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      setPermissionRows((current) => current.map((item) => item.code === permission.code
        ? { ...item, effective: !item.effective, source: !item.effective ? 'permissão adicional' : 'permissão removida' }
        : item));
    } catch (error) {
      setPermissionError(error.message);
    }
  }

  return (
    <div className="users-screen">
      <PageHeading
        eyebrow="Acessos da fazenda"
        title="Usuários da Fazenda"
        description="Contas e perfis vinculados à fazenda ativa. A autorização é validada também pela API."
        actions={can('users.create') ? <button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}><Plus size={16} /> Novo usuário</button> : null}
      />
      {usersResource.error ? <ErrorState message={usersResource.error} onRetry={usersResource.reload} /> : null}
      {rolesResource.error ? <ErrorState message={rolesResource.error} onRetry={rolesResource.reload} /> : null}
      {formError ? <ErrorState message={formError} /> : null}
      {formOpen ? (
        <form className="user-create-form" onSubmit={createUser}>
          <h2>Novo usuário</h2>
          <label>Nome completo<input required minLength="2" value={draft.full_name} onChange={(event) => setDraft({ ...draft, full_name: event.target.value })} /></label>
          <label>Nome de usuário<input required minLength="3" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></label>
          <label>E-mail<input required type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
          <label>Senha inicial<input required minLength="10" type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} autoComplete="new-password" /></label>
          <label>Perfil<select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}>{roles.filter((role) => role.name !== 'OWNER').map((role) => <option key={role.id} value={role.name}>{roleLabels[role.name] || role.name}</option>)}</select></label>
          <label>Telefone<input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
          {draft.role === 'OPERATOR' && can('machines.view') ? <label>Máquina atribuída<select value={draft.assigned_machine_id} onChange={(event) => setDraft({ ...draft, assigned_machine_id: event.target.value })}><option value="">Sem atribuição</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.nome || machine.code}</option>)}</select></label> : null}
          {formError ? <p role="alert">{formError}</p> : null}
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Salvando...' : 'Criar usuário'}</button>
          <button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancelar</button>
        </form>
      ) : null}
      <div className="users-toolbar">
        <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, usuário ou e-mail" /></label>
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="Filtrar usuários por perfil">
          <option value="all">Todos os perfis</option>
          {roles.map((role) => <option key={role.id} value={role.name}>{roleLabels[role.name] || role.name}</option>)}
        </select>
        <span>{visibleUsers.length} usuário(s)</span>
      </div>
      {usersResource.loading ? <LoadingState label="Carregando usuários..." /> : null}
      {!usersResource.loading && !usersResource.error && visibleUsers.length === 0 ? (
        <EmptyState title="Nenhum usuário encontrado" description="Não há usuários nesta fazenda com os filtros selecionados." icon={UserRoundCog} />
      ) : null}
      {visibleUsers.length > 0 ? (
        <div className="users-management-grid">
          <div className="users-table-wrap">
            <table className="users-table">
              <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th>Último acesso</th><th>Máquina</th><th>Ações</th></tr></thead>
              <tbody>{visibleUsers.map((user) => (
                <tr key={user.id} className={selectedId === user.id ? 'selected-row' : ''} onClick={() => setSelectedId(user.id)}>
                  <td><strong>{user.full_name || user.username}</strong><small>@{user.username}</small></td>
                  <td>{user.email}</td>
                  <td>{roleLabels[user.role] || user.role}</td>
                  <td><StatusBadge tone={user.status === 'active' ? 'success' : 'neutral'}>{user.status === 'active' ? 'Ativo' : 'Inativo'}</StatusBadge></td>
                  <td>{formatDateTime(user.last_login_at)}</td>
                  <td>{machines.find((machine) => Number(machine.id) === Number(user.assigned_machine_id))?.nome || (user.assigned_machine_id ? `ID ${user.assigned_machine_id}` : '—')}</td>
                  <td>{(user.status === 'active' ? can('users.delete') : can('users.update')) && user.role !== 'OWNER' ? <button type="button" className="table-action" onClick={(event) => { event.stopPropagation(); toggleUserStatus(user); }}>{user.status === 'active' ? 'Desativar' : 'Ativar'}</button> : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {selectedUser ? (
            <aside className="user-permission-panel">
              <header><KeyRound size={17} /><div><small>Perfil e permissões</small><h2>{selectedUser.full_name || selectedUser.username}</h2></div></header>
              <p><strong>{roleLabels[selectedUser.role] || selectedUser.role}</strong> · {selectedUser.email}</p>
              {can('users.update') && selectedUser.role !== 'OWNER' ? (
                <form className="user-edit-form" onSubmit={updateUser}>
                  <label>Nome completo<input required minLength="2" value={userEditDraft.full_name || ''} onChange={(event) => setUserEditDraft({ ...userEditDraft, full_name: event.target.value })} /></label>
                  <label>E-mail<input required type="email" value={userEditDraft.email || ''} onChange={(event) => setUserEditDraft({ ...userEditDraft, email: event.target.value })} /></label>
                  <label>Telefone<input value={userEditDraft.phone || ''} onChange={(event) => setUserEditDraft({ ...userEditDraft, phone: event.target.value })} /></label>
                  <label>Perfil<select value={userEditDraft.role || ''} onChange={(event) => setUserEditDraft({ ...userEditDraft, role: event.target.value })}>{roles.filter((role) => role.name !== 'OWNER').map((role) => <option key={role.id} value={role.name}>{roleLabels[role.name] || role.name}</option>)}</select></label>
                  {can('machines.view') ? <label>Máquina atribuída<select value={userEditDraft.assigned_machine_id || ''} onChange={(event) => setUserEditDraft({ ...userEditDraft, assigned_machine_id: event.target.value })}><option value="">Sem atribuição</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.nome || machine.code}</option>)}</select></label> : null}
                  {userEditError ? <p role="alert">{userEditError}</p> : null}
                  <button type="submit" className="primary-button">Salvar alterações</button>
                </form>
              ) : null}
              {can('users.permissions') ? (
                <>
                  {permissionError ? <ErrorState message={permissionError} /> : null}
                  <ul>{permissionRows.map((permission) => (
                    <li key={permission.code}>
                      <span>{permission.description}<small>{permission.code} · {permission.source}</small></span>
                      {selectedUser.role === 'OWNER' ? <strong>Proprietário</strong> : <button type="button" disabled={!can(permission.code)} onClick={() => setOverride(permission)} aria-label={`${permission.effective ? 'Remover' : 'Conceder'} ${permission.code}`}>{permission.effective ? '✓' : '+'}</button>}
                    </li>
                  ))}</ul>
                </>
              ) : <p>Você pode consultar o perfil atribuído; a personalização individual de permissões não está habilitada para seu acesso.</p>}
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
