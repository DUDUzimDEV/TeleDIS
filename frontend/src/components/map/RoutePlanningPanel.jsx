import React from 'react';
import { AlertTriangle, Ban } from 'lucide-react';

const problemLabels = {
  BURACO: 'Buraco',
  LAMA: 'Lama',
  ALAGAMENTO: 'Alagamento',
  VIA_BLOQUEADA: 'Via bloqueada',
  PONTE_PROBLEMA: 'Problema em ponte',
  DESLIZAMENTO: 'Deslizamento',
  OUTRO: 'Outro',
};

export default function RoutePlanningPanel({
  method,
  onMethodChange,
  origin,
  destination,
  onPickOrigin,
  onPickDestination,
  routePickTarget,
  machines,
  structures,
  machineId,
  structureId,
  onMachineChange,
  onStructureChange,
  canRebuildNetwork,
  onRebuild,
  isRebuilding,
  onCalculate,
  isCalculating,
  error,
  notice,
  route,
}) {
  const distance = route
    ? route.distanceMeters.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
    : null;
  const cost = route
    ? route.totalCost.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
    : null;

  return (
    <section className="route-planning-panel" aria-label="Planejamento de rota">
      <header className="route-planning-header">
        <div>
          <p className="modal-kicker">Navegação operacional</p>
          <h3>Planejar rota</h3>
        </div>
        <span className="tag muted">Dijkstra · determinístico</span>
      </header>

      <label>
        <span>Origem e destino</span>
        <select value={method} onChange={(event) => onMethodChange(event.target.value)}>
          <option value="coordinates">Selecionar pontos no mapa</option>
          <option value="machine-structure">Máquina até estrutura</option>
        </select>
      </label>

      {method === 'coordinates' ? (
        <div className="route-coordinate-pickers">
          <button
            type="button"
            className={`toolbar-button ${routePickTarget === 'origin' ? 'active' : 'outline'}`}
            onClick={onPickOrigin}
          >
            {origin
              ? `Origem: ${origin.latitude.toFixed(5)}, ${origin.longitude.toFixed(5)}`
              : 'Selecionar origem no mapa'}
          </button>
          <button
            type="button"
            className={`toolbar-button ${routePickTarget === 'destination' ? 'active' : 'outline'}`}
            onClick={onPickDestination}
          >
            {destination
              ? `Destino: ${destination.latitude.toFixed(5)}, ${destination.longitude.toFixed(5)}`
              : 'Selecionar destino no mapa'}
          </button>
        </div>
      ) : (
        <div className="route-select-grid">
          <label>
            <span>Máquina de origem</span>
            <select value={machineId} onChange={(event) => onMachineChange(event.target.value)}>
              <option value="">Selecione uma máquina</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.nome || machine.name} (#{machine.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Estrutura de destino</span>
            <select value={structureId} onChange={(event) => onStructureChange(event.target.value)}>
              <option value="">Selecione uma estrutura</option>
              {structures.map((structure) => (
                <option key={structure.id} value={structure.id}>
                  {structure.nome} — {structure.tipo}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {canRebuildNetwork ? (
        <details className="route-network-controls">
          <summary>Rede viária</summary>
          <p>Reconstrução disponível para perfis com permissão de alteração de estradas.</p>
          <button type="button" className="toolbar-button outline" onClick={onRebuild} disabled={isRebuilding}>
            {isRebuilding ? 'Construindo rede...' : 'Construir / reconstruir rede'}
          </button>
        </details>
      ) : null}

      <div className="route-planning-actions">
        <button
          type="button"
          className="primary-button"
          onClick={onCalculate}
          disabled={isCalculating || (method === 'coordinates' ? !origin || !destination : !machineId || !structureId)}
        >
          {isCalculating ? 'Calculando...' : 'Calcular rota'}
        </button>
      </div>

      {error ? <p className="field-form-error" role="alert">{error}</p> : null}
      {notice ? <p className="route-network-notice" role="status">{notice}</p> : null}

      {route ? (
        <div className="route-result" role="status">
          <div className="route-result-metrics">
            <div><span>Distância</span><strong>{distance} m</strong></div>
            <div><span>Custo ponderado</span><strong>{cost}</strong></div>
          </div>
          <p className="route-cost-note">
            O custo é uma distância ponderada pelas regras atuais; não representa tempo, consumo ou previsão.
          </p>
          {route.problems.length > 0 ? (
            <div className="route-issues">
              <strong>Trechos com problemas ativos</strong>
              {route.problems.map((problem) => (
                <p key={problem.id}>
                  {problem.tipo === 'VIA_BLOQUEADA' ? <Ban size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
                  {' '}{problemLabels[problem.tipo] || problem.tipo}
                  {' · '}{problem.gravidade} · {problem.status}
                  {problem.tipo === 'VIA_BLOQUEADA' ? ' · trecho bloqueado' : ''}
                </p>
              ))}
            </div>
          ) : (
            <p className="route-cost-note">A rota não utiliza trechos com problemas ativos.</p>
          )}
          {route.blockedSegments.length > 0 ? (
            <p className="route-blocked-note">
              A rede possui {route.blockedSegments.length} segmento(s) bloqueado(s); o Dijkstra não os utiliza.
            </p>
          ) : null}
        </div>
      ) : null}

      {routePickTarget ? <p className="route-map-hint">Clique no mapa para definir a {routePickTarget === 'origin' ? 'origem' : 'destino'}.</p> : null}
    </section>
  );
}
