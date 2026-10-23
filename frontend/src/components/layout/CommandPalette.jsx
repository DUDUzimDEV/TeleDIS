import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bell, ClipboardList, Gauge, Map, Route, Search, Tractor, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
  const availableCommands = useMemo(() => commands.filter((command) => can(command.permission)), [can]);
  const visibleCommands = availableCommands.filter((command) => (
    `${command.label} ${command.description}`.toLowerCase().includes(query.trim().toLowerCase())
  ));

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
          {visibleCommands.map((command) => {
            const Icon = command.icon;
            return (
              <button type="button" key={command.to} onClick={() => runCommand(command)} role="option">
                <span><Icon size={18} aria-hidden="true" /></span>
                <span><strong>{command.label}</strong><small>{command.description}</small></span>
              </button>
            );
          })}
          {!visibleCommands.length ? <p>Nenhum destino autorizado encontrado.</p> : null}
        </div>
        <footer><kbd>Esc</kbd> fechar <span><kbd>Ctrl</kbd> + <kbd>K</kbd> abrir</span></footer>
      </section>
    </div>
  );
}
