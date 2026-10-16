import React from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  ClipboardList,
  FileClock,
  Gauge,
  Map,
  MapPinned,
  Route,
  Settings2,
  Sprout,
  Tractor,
  UserCog,
  UsersRound,
  X,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const navigationGroups = [
  {
    label: 'Visão geral',
    items: [{ label: 'Dashboard', to: '/dashboard', icon: Gauge, permission: 'farm.view' }],
  },
  {
    label: 'Operação',
    items: [
      { label: 'Operações', to: '/operacoes', icon: ClipboardList, permission: 'operations.view', except: 'OPERATOR' },
      { label: 'Mapa operacional', to: '/mapa', icon: Map, permission: 'fields.view' },
      { label: 'Rotas', to: '/rotas', icon: Route, permission: 'routes.view', except: 'OPERATOR' },
      { label: 'Minha operação', to: '/operacao', icon: Tractor, permission: 'machines.view', only: 'OPERATOR' },
      { label: 'Minha rota', to: '/minha-rota', icon: Route, permission: 'routes.view', only: 'OPERATOR' },
    ],
  },
  {
    label: 'Estrutura',
    items: [
      { label: 'Máquinas', to: '/maquinas', icon: Tractor, permission: 'machines.view', except: 'OPERATOR' },
      { label: 'Talhões', to: '/talhoes', icon: MapPinned, permission: 'fields.view' },
      { label: 'Estruturas', to: '/estruturas', icon: Building2, permission: 'structures.view' },
      { label: 'Problemas nas vias', to: '/problemas-vias', icon: AlertTriangle, permission: 'road_problems.view' },
    ],
  },
  {
    label: 'Monitoramento',
    items: [
      { label: 'Telemetria', to: '/telemetria', icon: Activity, permission: 'telemetry.view' },
      {
        label: 'Central de eventos',
        to: '/alertas',
        icon: Activity,
        permission: 'alerts.view',
        requires: ['telemetry.view'],
      },
      { label: 'Recomendações', to: '/recomendacoes', icon: ClipboardList, permission: 'reports.view' },
    ],
  },
  {
    label: 'Administração',
    items: [
      { label: 'Fazendas', to: '/fazendas', icon: Sprout, permission: 'farm.update' },
      { label: 'Equipes', to: '/equipes', icon: UsersRound, permission: 'teams.view' },
      { label: 'Operadores', to: '/operadores', icon: UsersRound, permission: 'users.view' },
      { label: 'Usuários', to: '/usuarios', icon: UserCog, permission: 'users.view' },
      { label: 'Auditoria', to: '/auditoria', icon: FileClock, permission: 'audit.view' },
      { label: 'Configurações', to: '/configuracoes', icon: Settings2, permission: 'settings.view' },
    ],
  },
];

export default function Sidebar({ mobileOpen = false, onNavigate = () => {} }) {
  const { can, role } = useAuth();
  const homePath = role === 'OPERATOR' ? '/operacao' : '/dashboard';

  return (
    <aside className={`sidebar${mobileOpen ? ' sidebar-open' : ''}`} id="primary-navigation">
      <div className="sidebar-brand-row">
        <NavLink to={homePath} className="brand-block" aria-label="TeleDis - início" onClick={onNavigate}>
        <div className="brand-mark">T</div>
        <div>
          <div className="brand-name">TeleDis</div>
          <div className="brand-subtitle">Operação agrícola</div>
        </div>
        </NavLink>
        <button
          className="sidebar-close-button"
          type="button"
          aria-label="Fechar menu"
          onClick={onNavigate}
        >
          <X size={19} aria-hidden="true" />
        </button>
      </div>
      <nav className="sidebar-nav" aria-label="Menu principal">
        {navigationGroups.map((group) => {
          const items = group.items.filter((item) => (
            can(item.permission)
            && (item.requires || []).every(can)
            && (!item.only || item.only === role)
            && (!item.except || item.except !== role)
          ));
          if (!items.length) return null;
          return (
            <section className="sidebar-nav-group" key={group.label} aria-label={group.label}>
              <h2 className="sidebar-section-label">{group.label}</h2>
              {items.map(({ label, to, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </section>
          );
        })}
      </nav>
      <div className="sidebar-footnote"><span className="status-dot" />Plataforma operacional</div>
    </aside>
  );
}
