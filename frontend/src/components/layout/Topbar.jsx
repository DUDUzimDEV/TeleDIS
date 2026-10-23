import React, { useState } from 'react';
import { Bell, Building2, ChevronDown, ChevronRight, LogOut, Menu, MonitorPlay, Search, UserRound, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import CommandPalette from './CommandPalette';

const roleLabels = {
  OWNER: 'Proprietário',
  FARM_ADMIN: 'Administrador da fazenda',
  COORDINATOR: 'Coordenador',
  SUPERVISOR: 'Supervisor',
  OPERATOR: 'Operador',
  TECHNICIAN: 'Técnico',
  ANALYST: 'Analista',
};

const breadcrumbLabels = {
  dashboard: ['Visão geral', 'Dashboard'],
  mapa: ['Operação', 'Mapa operacional'],
  maquinas: ['Estrutura', 'Máquinas'],
  talhoes: ['Estrutura', 'Talhões'],
  estruturas: ['Estrutura', 'Estruturas'],
  rotas: ['Operação', 'Rotas'],
  operacoes: ['Operação', 'Operações'],
  alertas: ['Monitoramento', 'Central de eventos'],
  telemetria: ['Monitoramento', 'Telemetria'],
  'problemas-vias': ['Estrutura', 'Problemas nas vias'],
  recomendacoes: ['Monitoramento', 'Recomendações'],
  equipes: ['Administração', 'Equipes'],
  operadores: ['Administração', 'Operadores'],
  usuarios: ['Administração', 'Usuários'],
  fazendas: ['Administração', 'Fazendas'],
  configuracoes: ['Administração', 'Configurações'],
  auditoria: ['Administração', 'Auditoria'],
  operacao: ['Operação', 'Minha operação'],
  'minha-maquina': ['Operação', 'Minha máquina'],
  'minha-rota': ['Operação', 'Minha rota'],
};

function getBreadcrumb(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  const route = segments[0] || 'dashboard';
  const labels = breadcrumbLabels[route] || ['TeleDis', 'Área operacional'];
  if (route === 'operacoes' && segments[1] && segments[2] === 'relatorio') {
    return ['Operações', `#${segments[1]}`, 'Relatório'];
  }
  return [...labels, ...(segments.length > 1 ? [`#${segments[1]}`] : [])];
}

export default function Topbar({ onMenuClick = () => {}, menuOpen = false, presentationMode = false, onTogglePresentation = () => {} }) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    role,
    farms,
    activeFarm,
    activeFarmId,
    selectFarm,
    signOut,
    can,
  } = useAuth();
  const [actionError, setActionError] = useState('');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const breadcrumbs = getBreadcrumb(location.pathname);
  const name = user?.full_name || user?.username || 'Sessão autenticada';
  const initials = name.slice(0, 2).toUpperCase();
  const eventsPath = can('alerts.view') && can('telemetry.view')
    ? '/alertas'
    : can('road_problems.view') ? '/problemas-vias' : null;

  React.useEffect(() => {
    function openCommandPalette(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    }
    document.addEventListener('keydown', openCommandPalette);
    return () => document.removeEventListener('keydown', openCommandPalette);
  }, []);

  async function handleFarmChange(event) {
    setActionError('');
    try {
      const selectedFarm = farms.find((farm) => String(farm.id) === String(event.target.value));
      await selectFarm(event.target.value);
      navigate(selectedFarm?.role === 'OPERATOR' ? '/operacao' : '/dashboard');
    } catch (error) {
      setActionError(error.message || 'Não foi possível trocar de fazenda.');
    }
  }

  async function handleLogout() {
    setActionError('');
    try {
      await signOut();
    } catch {
      setActionError('A sessão foi encerrada neste dispositivo, mas o servidor não confirmou o logout.');
    } finally {
      navigate('/login', { replace: true });
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-leading">
        <button
          type="button"
          className="topbar-menu-button"
          aria-label={menuOpen ? 'Fechar menu de navegação' : 'Abrir menu de navegação'}
          aria-controls="primary-navigation"
          aria-expanded={menuOpen}
          onClick={onMenuClick}
        >
          <Menu size={19} aria-hidden="true" />
        </button>
        <nav className="breadcrumb" aria-label="Trilha de navegação">
          <Link to="/dashboard">TeleDis</Link>
          {breadcrumbs.map((part, index) => (
            <React.Fragment key={`${part}-${index}`}>
              <ChevronRight size={14} aria-hidden="true" />
              <span aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{part}</span>
            </React.Fragment>
          ))}
        </nav>
      </div>
      <div className="topbar-product-context">
        <span className="topbar-context-mark" />
        <div><strong>TeleDis</strong><small>Centro de operação agrícola</small></div>
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className={`presentation-toggle${presentationMode ? ' active' : ''}`}
          onClick={onTogglePresentation}
          aria-pressed={presentationMode}
          aria-label={presentationMode ? 'Sair do modo apresentação' : 'Ativar modo apresentação'}
          title={presentationMode ? 'Sair do modo apresentação' : 'Modo apresentação'}
        >
          {presentationMode ? <X size={16} aria-hidden="true" /> : <MonitorPlay size={16} aria-hidden="true" />}
          <span>{presentationMode ? 'Sair da apresentação' : 'Apresentação'}</span>
        </button>
        <button
          type="button"
          className="topbar-search-trigger"
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Abrir navegação rápida"
          title="Navegação rápida (Ctrl+K)"
        >
          <Search size={16} aria-hidden="true" />
          <span>Buscar</span>
          <kbd>Ctrl K</kbd>
        </button>
        <label className="farm-context-switcher">
          <Building2 size={16} aria-hidden="true" />
          <span className="sr-only">Fazenda ativa</span>
          <select
            value={activeFarmId || ''}
            onChange={handleFarmChange}
            aria-label="Selecionar fazenda"
            disabled={farms.length <= 1}
          >
            {farms.map((farm) => (
              <option key={farm.id} value={farm.id}>
                {farm.name}{farm.code ? ` · ${farm.code}` : ''}
              </option>
            ))}
          </select>
          {farms.length > 1 ? <ChevronDown size={14} aria-hidden="true" /> : null}
        </label>
        {eventsPath ? (
          <Link
            className="topbar-icon-link"
            to={eventsPath}
            aria-label="Abrir eventos e ocorrências"
            title="Eventos e ocorrências"
          >
            <Bell size={18} aria-hidden="true" />
          </Link>
        ) : null}
        <details className="account-menu">
          <summary className="account-menu-trigger" aria-label={`Perfil de ${name}`}>
            <span className="user-avatar">{user ? initials : <UserRound size={17} />}</span>
            <span className="account-trigger-copy">
              <strong>{name}</strong>
              <small>{roleLabels[role] || role || 'Usuário'}</small>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className="account-menu-panel">
            <strong>{name}</strong>
            <span>{roleLabels[role] || role || 'Usuário'}</span>
            <span className="account-farm-label">
              <Building2 size={14} aria-hidden="true" />
              {activeFarm?.name || 'Fazenda não selecionada'}
            </span>
            <button type="button" onClick={handleLogout}>
              <LogOut size={16} aria-hidden="true" />Sair da conta
            </button>
          </div>
        </details>
      </div>
      {actionError ? <p className="farm-switch-error" role="alert">{actionError}</p> : null}
      <span className="sr-only">Fazenda ativa: {activeFarm?.name || 'não selecionada'}</span>
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} can={can} />
    </header>
  );
}
