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
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const navItems = [
  { label: 'Dashboard', to: '/dashboard', icon: Gauge, permission: 'farm.view' },
  { label: 'Mapa Operacional', to: '/mapa', icon: Map, permission: 'fields.view' },
  { label: 'Máquinas', to: '/maquinas', icon: Tractor, permission: 'machines.view', except: 'OPERATOR' },
  { label: 'Talhões', to: '/talhoes', icon: MapPinned, permission: 'fields.view' },
  { label: 'Estruturas', to: '/estruturas', icon: Building2, permission: 'structures.view' },
  { label: 'Rotas', to: '/rotas', icon: Route, permission: 'routes.view', except: 'OPERATOR' },
  { label: 'Operações', to: '/operacoes', icon: ClipboardList, permission: 'operations.view', except: 'OPERATOR' },
  { label: 'Equipes', to: '/equipes', icon: UsersRound, permission: 'teams.view' },
  { label: 'Alertas', to: '/alertas', icon: Activity, permission: 'alerts.view' },
  { label: 'Recomendações', to: '/recomendacoes', icon: ClipboardList, permission: 'reports.view' },
  { label: 'Problemas nas Vias', to: '/problemas-vias', icon: AlertTriangle, permission: 'road_problems.view' },
  { label: 'Operadores', to: '/operadores', icon: UsersRound, permission: 'users.view' },
  { label: 'Usuários', to: '/usuarios', icon: UserCog, permission: 'users.view' },
  { label: 'Fazendas', to: '/fazendas', icon: Sprout, permission: 'farm.update' },
  { label: 'Auditoria', to: '/auditoria', icon: FileClock, permission: 'audit.view' },
  { label: 'Configurações', to: '/configuracoes', icon: Settings2, permission: 'settings.view' },
  { label: 'Minha operação', to: '/operacao', icon: Tractor, permission: 'machines.view', only: 'OPERATOR' },
  { label: 'Minha máquina', to: '/minha-maquina', icon: Gauge, permission: 'machines.view', only: 'OPERATOR' },
  { label: 'Minha rota', to: '/minha-rota', icon: Route, permission: 'routes.view', only: 'OPERATOR' },
];

export default function Sidebar() {
  const { can, role } = useAuth();
  const visibleItems = navItems.filter((item) => (
    can(item.permission)
    && (!item.only || item.only === role)
    && (!item.except || item.except !== role)
  ));

  return (
    <aside className="sidebar">
      <NavLink to="/dashboard" className="brand-block" aria-label="TeleDis - Dashboard">
        <div className="brand-mark">T</div>
        <div>
          <div className="brand-name">TeleDis</div>
          <div className="brand-subtitle">Operação agrícola</div>
        </div>
      </NavLink>
      <div className="sidebar-section-label">Espaço de trabalho</div>
      <nav className="sidebar-nav" aria-label="Menu principal">
        {visibleItems.map(({ label, to, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footnote"><span className="status-dot" />Plataforma operacional</div>
    </aside>
  );
}
