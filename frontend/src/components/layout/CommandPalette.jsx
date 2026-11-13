import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Building2,
  ClipboardList,
  Gauge,
  Lightbulb,
  Map,
  Route,
  Search,
  Tractor,
  UsersRound,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useApiResource from '../../hooks/useApiResource';

const commands = [
  { label: 'Dashboard', description: 'Visão geral da operação', to: '/dashboard', permission: 'farm.view', icon: Gauge },
  { label: 'Mapa operacional', description: 'Ativos e camadas geográficas', to: '/mapa', permission: 'fields.view', icon: Map },
  { label: 'Máquinas', description: 'Central da frota', to: '/maquinas', permission: 'machines.view', icon: Tractor },
  { label: 'Operações', description: 'Ciclo operacional', to: '/operacoes', permission: 'operations.view', icon: ClipboardList },
  { label: 'Rotas', description: 'Planejamento logístico', to: '/rotas', permission: 'routes.view', icon: Route },
  { label: 'Estruturas', description: 'Silos, pátios e pontos de apoio', to: '/estruturas', permission: 'structures.view', icon: Building2 },
  { label: 'Problemas nas vias', description: 'Ocorrências e bloqueios em estradas', to: '/problemas-vias', permission: 'road_problems.view', icon: AlertTriangle },
  { label: 'Telemetria', description: 'Leituras operacionais', to: '/telemetria', permission: 'telemetry.view', icon: Activity },
  { label: 'Alertas e eventos', description: 'Central de eventos e ocorrências', to: '/alertas', permission: 'alerts.view', icon: Bell },
  { label: 'Recomendações', description: 'Sugestões e relatórios operacionais', to: '/recomendacoes', permission: 'reports.view', icon: Lightbulb },
  { label: 'Equipes', description: 'Times e frentes de trabalho', to: '/equipes', permission: 'teams.view', icon: UsersRound },
];

export default function CommandPalette({ open, onClose, can }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const itemRefs = useRef([]);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const machinesResource = useApiResource('/api/v1/machines', 0, { enabled: open && can('machines.view') });
  const operationsResource = useApiResource('/api/v1/operations', 0, { enabled: open && can('operations.view') });
  const fieldsResource = useApiResource('/api/v1/fields', 0, { enabled: open && can('fields.view') });
  const availableCommands = useMemo(() => commands.filter((command) => can(command.permission)), [can]);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (value) => !normalizedQuery || String(value || '').toLowerCase().includes(normalizedQuery);
  const groups = useMemo(() => [
    {
      label: 'Navegação',
      items: availableCommands.filter((command) => matches(`${command.label} ${command.description}`)),
    },
    {
      label: 'Máquinas',
      items: (Array.isArray(machinesResource.data) ? machinesResource.data : [])
        .filter((machine) => matches(`${machine.nome} ${machine.code} ${machine.status}`))
        .slice(0, 5)
        .map((machine) => ({
          label: machine.nome || `Máquina ${machine.id}`,
          description: `${machine.code || `ID ${machine.id}`} · ${machine.status || 'Status não informado'}`,
          to: `/maquinas?machineId=${machine.id}`,
          icon: Tractor,
        })),
    },
    {
      label: 'Operações',
      items: (Array.isArray(operationsResource.data) ? operationsResource.data : [])
        .filter((operation) => matches(`${operation.name} ${operation.code} ${operation.id} ${operation.status}`))
        .slice(0, 5)
        .map((operation) => ({
          label: operation.name || `Operação #${operation.id}`,
          description: `Operação #${operation.id} · ${String(operation.status || '').replaceAll('_', ' ')}`,
          to: `/operacoes/${operation.id}`,
          icon: ClipboardList,
        })),
    },
    {
      label: 'Talhões',
      items: (Array.isArray(fieldsResource.data) ? fieldsResource.data : [])
        .filter((field) => matches(`${field.nome} ${field.cultura} ${field.safra}`))
        .slice(0, 5)
        .map((field) => ({
          label: field.nome || `Talhão ${field.id}`,
          description: [field.cultura, field.safra].filter(Boolean).join(' · ') || 'Área cadastrada',
          to: `/talhoes?fieldId=${field.id}`,
          icon: Map,
        })),
    },
  ].filter((group) => group.items.length), [availableCommands, fieldsResource.data, machinesResource.data, normalizedQuery, operationsResource.data]);

  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const safeActiveIndex = flatItems.length ? Math.min(activeIndex, flatItems.length - 1) : 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    const activeElement = itemRefs.current[safeActiveIndex];
    if (activeElement?.scrollIntoView) {
      activeElement.scrollIntoView({ block: 'nearest' });
    }
  }, [safeActiveIndex]);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setActiveIndex(0);
    const previousFocus = document.activeElement;
    requestAnimationFrame(() => inputRef.current?.focus());
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      previousFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  function runCommand(command) {
    navigate(command.to);
    onClose();
  }

  function handleKeyDown(event) {
    if (!flatItems.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % flatItems.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
    } else if (event.key === 'Enter') {
      const target = flatItems[safeActiveIndex];
      if (target) {
        event.preventDefault();
        runCommand(target);
      }
    }
  }

  let renderIndex = 0;

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Navegação rápida"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="command-palette-search">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar uma área do TeleDis..."
            aria-label="Buscar comando"
          />
          <button type="button" onClick={onClose} aria-label="Fechar navegação rápida"><X size={18} /></button>
        </header>
        <div className="command-palette-results" role="listbox" aria-label="Destinos disponíveis">
          {groups.map((group) => (
            <section className="command-result-group" key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map((command) => {
                const Icon = command.icon;
                const itemIndex = renderIndex;
                renderIndex += 1;
                const isActive = itemIndex === safeActiveIndex;
                return (
                  <button
                    type="button"
                    key={`${group.label}-${command.to}`}
                    ref={(el) => { itemRefs.current[itemIndex] = el; }}
                    className={isActive ? 'active' : ''}
                    aria-selected={isActive}
                    onMouseEnter={() => setActiveIndex(itemIndex)}
                    onClick={() => runCommand(command)}
                    role="option"
                  >
                    <span><Icon size={18} aria-hidden="true" /></span>
                    <span><strong>{command.label}</strong><small>{command.description}</small></span>
                  </button>
                );
              })}
            </section>
          ))}
          {!groups.length ? <p>Nenhum resultado autorizado encontrado.</p> : null}
        </div>
        <footer><span><kbd>↑</kbd> <kbd>↓</kbd> navegar · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar</span><span><kbd>Ctrl</kbd> + <kbd>K</kbd> abrir</span></footer>
      </section>
    </div>
  );
}
