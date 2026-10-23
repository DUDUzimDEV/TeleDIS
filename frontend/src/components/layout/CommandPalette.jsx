import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bell, ClipboardList, Gauge, Map, Route, Search, Tractor, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useApiResource from '../../hooks/useApiResource';

const commands = [
  { label: 'Dashboard', description: 'Visão geral da operação', to: '/dashboard', permission: 'farm.view', icon: Gauge },
  { label: 'Mapa operacional', description: 'Ativos e camadas geográficas', to: '/mapa', permission: 'fields.view', icon: Map },
  { label: 'Máquinas', description: 'Central da frota', to: '/maquinas', permission: 'machines.view', icon: Tractor },
  { label: 'Operações', description: 'Ciclo operacional', to: '/operacoes', permission: 'operations.view', icon: ClipboardList },
  { label: 'Rotas', description: 'Planejamento logístico', to: '/rotas', permission: 'routes.view', icon: Route },
  { label: 'Telemetria', description: 'Leituras operacionais', to: '/telemetria', permission: 'telemetry.view', icon: Activity },
  { label: 'Central de eventos', description: 'Alertas e ocorrências', to: '/alertas', permission: 'alerts.view', icon: Bell },
];

export default function CommandPalette({ open, onClose, can }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const machinesResource = useApiResource('/api/v1/machines', 0, { enabled: open && can('machines.view') });
  const operationsResource = useApiResource('/api/v1/operations', 0, { enabled: open && can('operations.view') });
  const fieldsResource = useApiResource('/api/v1/fields', 0, { enabled: open && can('fields.view') });
  const availableCommands = useMemo(() => commands.filter((command) => can(command.permission)), [can]);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (value) => !normalizedQuery || String(value || '').toLowerCase().includes(normalizedQuery);
  const groups = [
    {
      label: 'Navegação',
      items: availableCommands.filter((command) => matches(`${command.label} ${command.description}`)),
    },
    {
      label: 'Máquinas',
      items: (Array.isArray(machinesResource.data) ? machinesResource.data : []).filter((machine) => matches(`${machine.nome} ${machine.code} ${machine.status}`)).slice(0, 5).map((machine) => ({ label: machine.nome || `Máquina ${machine.id}`, description: `${machine.code || `ID ${machine.id}`} · ${machine.status || 'Status não informado'}`, to: `/maquinas?machineId=${machine.id}`, icon: Tractor })),
    },
    {
      label: 'Operações',
      items: (Array.isArray(operationsResource.data) ? operationsResource.data : []).filter((operation) => matches(`${operation.name} ${operation.code} ${operation.id} ${operation.status}`)).slice(0, 5).map((operation) => ({ label: operation.name || `Operação #${operation.id}`, description: `Operação #${operation.id} · ${String(operation.status || '').replaceAll('_', ' ')}`, to: `/operacoes/${operation.id}`, icon: ClipboardList })),
    },
    {
      label: 'Talhões',
      items: (Array.isArray(fieldsResource.data) ? fieldsResource.data : []).filter((field) => matches(`${field.nome} ${field.cultura} ${field.safra}`)).slice(0, 5).map((field) => ({ label: field.nome || `Talhão ${field.id}`, description: [field.cultura, field.safra].filter(Boolean).join(' · ') || 'Área cadastrada', to: `/talhoes?fieldId=${field.id}`, icon: Map })),
    },
  ].filter((group) => group.items.length);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
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

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Navegação rápida"
        onMouseDown={(event) => event.stopPropagation()}
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
                return (
                  <button type="button" key={`${group.label}-${command.to}`} onClick={() => runCommand(command)} role="option">
                    <span><Icon size={18} aria-hidden="true" /></span>
                    <span><strong>{command.label}</strong><small>{command.description}</small></span>
                  </button>
                );
              })}
            </section>
          ))}
          {!groups.length ? <p>Nenhum resultado autorizado encontrado.</p> : null}
        </div>
        <footer><kbd>Esc</kbd> fechar <span><kbd>Ctrl</kbd> + <kbd>K</kbd> abrir</span></footer>
      </section>
    </div>
  );
}
