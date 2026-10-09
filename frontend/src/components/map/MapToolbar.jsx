import React from 'react';
import { Building2, Check, MapPin, PanelRightClose, PanelRightOpen, Route, Tractor, TriangleAlert, Waypoints, X } from 'lucide-react';

function ToolButton({ active, icon: Icon, label, onClick, variant = '' }) {
  return (
    <button
      type="button"
      className={`map-tool-button ${active ? 'active' : ''} ${variant}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export default function MapToolbar({
  isDrawing,
  onToggleDrawing,
  onFinalizeField,
  canFinalize,
  onCancelDrawing,
  isPlacingStructure,
  onStartStructure,
  onCancelStructure,
  isDrawingRoad,
  onStartRoad,
  onFinalizeRoad,
  onCancelRoad,
  isPlacingRoadProblem,
  onStartRoadProblem,
  onCancelRoadProblem,
  isPlanningRoute,
  onToggleRoutePlanning,
  showMachines,
  onToggleMachines,
  onSelectMode,
  onCenter,
  inspectorOpen,
  onToggleInspector,
  isSelecting,
  canCreateFields = false,
  canCreateRoads = false,
  canCreateStructures = false,
  canCreateRoadProblems = false,
  canPlanRoutes = false,
}) {
  return (
    <div className="map-toolbar">
      <ToolButton active={isSelecting} icon={MapPin} label="Selecionar" onClick={onSelectMode} />
      {canCreateFields ? <ToolButton active={isDrawing} icon={Waypoints} label={isDrawing ? 'Desenhando talhão' : 'Talhão'} onClick={onToggleDrawing} variant="tool-green" /> : null}
      {canCreateFields && isDrawing ? (
        <>
          <button type="button" className="map-tool-action" onClick={onFinalizeField} disabled={!canFinalize}><Check size={15} />Finalizar</button>
          <button type="button" className="map-tool-cancel" onClick={onCancelDrawing}><X size={15} />Cancelar</button>
        </>
      ) : null}
      {canCreateRoads ? <ToolButton active={isDrawingRoad} icon={Waypoints} label={isDrawingRoad ? 'Estrada ativa' : 'Estrada'} onClick={isDrawingRoad ? onCancelRoad : onStartRoad} variant="tool-amber" /> : null}
      {canCreateRoads && isDrawingRoad ? (
        <>
          <button type="button" className="map-tool-action" onClick={onFinalizeRoad}><Check size={15} />Finalizar</button>
          <button type="button" className="map-tool-cancel" onClick={onCancelRoad}><X size={15} />Cancelar</button>
        </>
      ) : null}
      {canCreateStructures ? <ToolButton active={isPlacingStructure} icon={Building2} label="Estrutura" onClick={isPlacingStructure ? onCancelStructure : onStartStructure} variant="tool-blue" /> : null}
      {canCreateRoadProblems ? <ToolButton active={isPlacingRoadProblem} icon={TriangleAlert} label="Problema" onClick={isPlacingRoadProblem ? onCancelRoadProblem : onStartRoadProblem} variant="tool-red" /> : null}
      <ToolButton active={showMachines} icon={Tractor} label="Máquinas" onClick={onToggleMachines} />
      {canPlanRoutes ? <ToolButton active={isPlanningRoute} icon={Route} label="Rota" onClick={onToggleRoutePlanning} variant="tool-blue" /> : null}
      <button type="button" className="map-tool-button map-center-button" onClick={onCenter}><MapPin size={16} /><span>Centralizar</span></button>
      <button type="button" className="map-tool-button" onClick={onToggleInspector}>
        {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        <span>{inspectorOpen ? 'Ocultar painel' : 'Mostrar painel'}</span>
      </button>
    </div>
  );
}
