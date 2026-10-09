import React, { useState } from 'react';
import { Building2, LogOut, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';

const roleLabels = {
  OWNER: 'Proprietário',
  FARM_ADMIN: 'Administrador da fazenda',
  COORDINATOR: 'Coordenador',
  SUPERVISOR: 'Supervisor',
  OPERATOR: 'Operador',
  TECHNICIAN: 'Técnico',
  ANALYST: 'Analista',
};

export default function Topbar() {
  const navigate = useNavigate();
  const { user, role, farms, activeFarm, activeFarmId, selectFarm, signOut } = useAuth();
  const [switchError, setSwitchError] = useState('');
  const name = user?.full_name || user?.username || 'Sessão autenticada';
  const initials = name.slice(0, 2).toUpperCase();

  async function handleFarmChange(event) {
    setSwitchError('');
    try {
      const selectedFarm = farms.find((farm) => String(farm.id) === String(event.target.value));
      await selectFarm(event.target.value);
      navigate(selectedFarm?.role === 'OPERATOR' ? '/operacao' : '/dashboard');
    } catch (error) {
      setSwitchError(error.message);
    }
  }

  async function handleLogout() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <header className="topbar">
      <div className="topbar-product-context">
        <span className="topbar-context-mark" />
        <div><strong>TeleDis</strong><small>Centro de operação agrícola</small></div>
      </div>
      <div className="topbar-actions">
        <label className="farm-context-switcher">
          <Building2 size={16} aria-hidden="true" />
          <span className="sr-only">Fazenda ativa</span>
          <select value={activeFarmId || ''} onChange={handleFarmChange} aria-label="Selecionar fazenda">
            {farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}
          </select>
        </label>
        <div className="user-chip">
          <div className="user-avatar">{user ? initials : <UserRound size={17} />}</div>
          <div><strong>{name}</strong><small>{roleLabels[role] || role || 'Usuário'}</small></div>
        </div>
        <button type="button" className="logout-button" onClick={handleLogout}>
          <LogOut size={16} aria-hidden="true" /><span>Sair</span>
        </button>
      </div>
      {switchError ? <p className="farm-switch-error" role="alert">{switchError}</p> : null}
      <span className="sr-only">Fazenda ativa: {activeFarm?.name || 'não selecionada'}</span>
    </header>
  );
}
