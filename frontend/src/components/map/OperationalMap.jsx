import React from 'react';
import { divIcon, DomEvent, latLngBounds } from 'leaflet';
import { CircleMarker, GeoJSON, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';

import { getCoordinatesCenter } from '../../utils/geoData';
import AnimatedMachineMarker from './AnimatedMachineMarker';

const structureTypeLabels = {
  OFICINA: 'Oficina',
  GALPAO: 'Galpão',
  ABASTECIMENTO: 'Abastecimento',
  SEDE: 'Sede',
  ALMOXARIFADO: 'Almoxarifado',
  APOIO: 'Ponto de apoio',
  OUTRO: 'Outro',
};

const roadTypeLabels = {
  PRINCIPAL: 'Via principal',
  SECUNDARIA: 'Via secundária',
  ACESSO: 'Acesso',
  SERVICO: 'Via de serviço',
  OUTRA: 'Outra',
};

const roadProblemTypeLabels = {
  BURACO: 'Buraco',
  LAMA: 'Lama',
  ALAGAMENTO: 'Alagamento',
  VIA_BLOQUEADA: 'Via bloqueada',
  PONTE_PROBLEMA: 'Problema em ponte',
  DESLIZAMENTO: 'Deslizamento',
  OUTRO: 'Outro',
};

const roadProblemSeverityLabels = {
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
  CRITICA: 'Crítica',
};

const roadProblemStatusLabels = {
  ABERTO: 'Aberto',
  EM_ANALISE: 'Em análise',
  RESOLVIDO: 'Resolvido',
  INATIVO: 'Inativo',
};

const structureIcon = divIcon({
  className: 'structure-marker-icon',
  html: '<span></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const draftVertexIcon = divIcon({
  className: 'draft-vertex-marker',
  html: '<span class="draft-vertex-dot" title="Clique para remover este vértice · Arraste para reposicionar"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const draftRoadVertexIcon = divIcon({
  className: 'draft-road-vertex-marker',
  html: '<span class="draft-road-vertex-dot" title="Clique para remover este vértice · Arraste para reposicionar"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const roadProblemIcons = {
  BAIXA: divIcon({ className: 'road-problem-marker-icon severity-low', html: '<span>!</span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
  MEDIA: divIcon({ className: 'road-problem-marker-icon severity-medium', html: '<span>!</span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
  ALTA: divIcon({ className: 'road-problem-marker-icon severity-high', html: '<span>!</span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
  CRITICA: divIcon({ className: 'road-problem-marker-icon severity-critical', html: '<span>!</span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
};

function geometryLeafletCoordinates(geometry) {
  const points = [];
  const visit = (value) => {
    if (Array.isArray(value) && value.length >= 2 && value.every(Number.isFinite)) {
      points.push([value[1], value[0]]);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry?.coordinates);
  return points;
}

function MapClickHandler({
  drawingMode,
  placingStructure,
  drawingRoad,
  placingRoadProblem,
  routePickTarget,
  onMapClick,
  onStructureMapClick,
  onRoadMapClick,
  onRoadProblemMapClick,
  onRouteMapClick,
  onCursorMove,
}) {
  useMapEvents({
    click(event) {
      if (drawingMode) {
        onMapClick(event.latlng);
      } else if (placingStructure) {
        onStructureMapClick(event.latlng);
      } else if (drawingRoad) {
        onRoadMapClick(event.latlng);
      } else if (placingRoadProblem) {
        onRoadProblemMapClick(event.latlng);
      } else if (routePickTarget) {
        onRouteMapClick(event.latlng, routePickTarget);
      }
    },
    mousemove(event) {
      if (drawingMode || drawingRoad) {
        onCursorMove?.(event.latlng);
      }
    },
    mouseout() {
      onCursorMove?.(null);
    },
  });

  return null;
}

function PersistedEntityBounds({
  fields,
  structures,
  roads,
  roadProblems,
  operationalArea,
  ready,
  isDrawingModeActive,
  farmId,
  placingRoadProblem,
  selectedRoadProblemRoadId,
}) {
  const map = useMap();
  const fittedFarmRef = React.useRef(null);

  React.useEffect(() => {
    // NEVER fit bounds if drawing or placing mode is active
    if (!ready || isDrawingModeActive || placingRoadProblem) {
      return undefined;
    }

    // Only auto-fit once per farm!
    const targetFarm = farmId != null ? String(farmId) : (operationalArea?.farm_id != null ? String(operationalArea.farm_id) : 'default');
    if (fittedFarmRef.current === targetFarm) {
      return undefined;
    }

    const coordinates = [
      ...fields.flatMap((field) => field.points),
      ...structures.map((structure) => structure.coordinates),
      ...roads.flatMap((road) => road.points),
      ...roadProblems.map((problem) => problem.coordinates),
      ...geometryLeafletCoordinates(operationalArea?.geometry),
      ...geometryLeafletCoordinates(operationalArea?.proximity_zone),
    ];

    if (coordinates.length > 0) {
      fittedFarmRef.current = targetFarm;
      const frame = requestAnimationFrame(() => {
        map.invalidateSize({ pan: false });
        map.fitBounds(latLngBounds(coordinates), { padding: [32, 32], maxZoom: 15 });
      });

      return () => cancelAnimationFrame(frame);
    }

    return undefined;
  }, [farmId, fields, isDrawingModeActive, map, operationalArea, placingRoadProblem, ready, roadProblems, roads, structures]);

  React.useEffect(() => {
    if (!placingRoadProblem || !selectedRoadProblemRoadId) {
      return undefined;
    }

    const selectedRoad = roads.find((road) => String(road.id) === selectedRoadProblemRoadId);
    if (!selectedRoad) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      map.fitBounds(selectedRoad.points, { padding: [56, 56], maxZoom: 17 });
    });

    return () => cancelAnimationFrame(frame);
  }, [map, placingRoadProblem, roads, selectedRoadProblemRoadId]);

  return null;
}

function CalculatedRouteBounds({ routePoints, isDrawingModeActive }) {
  const map = useMap();

  React.useEffect(() => {
    if (isDrawingModeActive || !routePoints || routePoints.length < 2) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      map.fitBounds(latLngBounds(routePoints), { padding: [56, 56], maxZoom: 17 });
    });
    return () => cancelAnimationFrame(frame);
  }, [isDrawingModeActive, map, routePoints]);

  return null;
}

function MapInstance({ onMapReady }) {
  const map = useMap();
  React.useEffect(() => {
    onMapReady?.(map);
  }, [map, onMapReady]);
  return null;
}

export default function OperationalMap({
  compact = false,
  drawingMode = false,
  placingStructure = false,
  drawingRoad = false,
  placingRoadProblem = false,
  selectedRoadProblemRoadId = null,
  routePickTarget = null,
  calculatedRoute = null,
  plannedRouteCoordinates = [],
  actualRouteCoordinates = [],
  operationalArea = null,
  draftPoints = [],
  draftRoadPoints = [],
  draftValidity = null,
  draftRoadProblemPoint = null,
  machines = [],
  visibleLayers = {},
  onMapClick,
  onStructureMapClick,
  onRoadMapClick,
  onRoadProblemMapClick,
  onRouteMapClick,
  onRemoveDraftPoint,
  onMoveDraftPoint,
  onRemoveDraftRoadPoint,
  onMoveDraftRoadPoint,
  farmId = null,
  fields = [],
  structures = [],
  roads = [],
  roadProblems = [],
  fitToPersistedEntities = false,
  selectedFieldId,
  onSelectField,
  onSelectMachine,
  onSelectStructure,
  onSelectRoad,
  onSelectRoadProblem,
  onMapReady,
}) {
  const mapCoordinates = [
    ...geometryLeafletCoordinates(operationalArea?.proximity_zone),
    ...geometryLeafletCoordinates(operationalArea?.geometry),
    ...fields.flatMap((field) => field.points),
    ...structures.map((structure) => structure.coordinates),
    ...roads.flatMap((road) => road.points),
    ...roadProblems.map((problem) => problem.coordinates),
    ...machines.map((machine) => [machine.latitude, machine.longitude]),
    ...plannedRouteCoordinates,
    ...actualRouteCoordinates,
  ];
  const center = getCoordinatesCenter([mapCoordinates]) || [0, 0];
  const [cursorPos, setCursorPos] = React.useState(null);
  const isDrawingModeActive = Boolean(drawingMode || placingStructure || drawingRoad || placingRoadProblem);
  const showOperationalArea = Boolean(operationalArea?.geometry) && (isDrawingModeActive || visibleLayers.operationalArea !== false);
  const showProximityZone = Boolean(operationalArea?.proximity_zone) && (isDrawingModeActive || visibleLayers.proximityZone !== false);

  const operationalAreaPathOptions = isDrawingModeActive
    ? {
        color: '#141514',
        weight: 3,
        fillColor: '#1F7A4C',
        fillOpacity: 0.18,
        interactive: false,
      }
    : {
        color: '#1F7A4C',
        weight: 2,
        fillColor: '#1F7A4C',
        fillOpacity: 0.10,
        interactive: false,
      };

  const proximityZonePathOptions = isDrawingModeActive
    ? {
        color: '#8A5D18',
        weight: 2,
        dashArray: '6 6',
        fillColor: '#E6D6B5',
        fillOpacity: 0.14,
        interactive: false,
      }
    : {
        color: '#b48742',
        weight: 1.5,
        dashArray: '6 5',
        fillColor: '#e6d6b5',
        fillOpacity: 0.08,
        interactive: false,
      };

  return (
    <div className={`map-shell ${compact ? 'compact' : ''}`}>
      <MapContainer center={center} zoom={mapCoordinates.length ? 14 : 2} scrollWheelZoom className="leaflet-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapInstance onMapReady={onMapReady} />

        <MapClickHandler
          drawingMode={drawingMode}
          placingStructure={placingStructure}
          drawingRoad={drawingRoad}
          placingRoadProblem={placingRoadProblem}
          routePickTarget={routePickTarget}
          onMapClick={onMapClick}
          onStructureMapClick={onStructureMapClick}
          onRoadMapClick={onRoadMapClick}
          onRoadProblemMapClick={onRoadProblemMapClick}
          onRouteMapClick={onRouteMapClick}
          onCursorMove={setCursorPos}
        />
        <CalculatedRouteBounds routePoints={calculatedRoute?.routePoints} isDrawingModeActive={isDrawingModeActive} />
        <PersistedEntityBounds
          fields={fields}
          structures={structures}
          roads={roads}
          roadProblems={roadProblems}
          operationalArea={operationalArea}
          ready={fitToPersistedEntities}
          isDrawingModeActive={isDrawingModeActive}
          farmId={farmId || operationalArea?.farm_id}
          placingRoadProblem={placingRoadProblem}
          selectedRoadProblemRoadId={selectedRoadProblemRoadId}
        />

        {showProximityZone ? (
          <GeoJSON
            key={`farm-proximity-${isDrawingModeActive ? 'active' : 'idle'}-${JSON.stringify(operationalArea.proximity_zone)}`}
            data={operationalArea.proximity_zone}
            interactive={false}
            pathOptions={proximityZonePathOptions}
            style={proximityZonePathOptions}
          />
        ) : null}
        {showOperationalArea ? (
          <GeoJSON
            key={`farm-area-${isDrawingModeActive ? 'active' : 'idle'}-${JSON.stringify(operationalArea.geometry)}`}
            data={operationalArea.geometry}
            interactive={false}
            pathOptions={operationalAreaPathOptions}
            style={operationalAreaPathOptions}
          />
        ) : null}

        {visibleLayers.fields !== false ? fields.map((field) => {
          const isSelected = selectedFieldId === field.id;

          return (
            <Polygon
              key={field.id}
              positions={field.points}
              pathOptions={{
                color: isSelected ? '#FFFFFF' : '#1F7A4C',
                fillColor: isSelected ? '#141514' : '#1F7A4C',
                fillOpacity: isSelected ? 0.78 : 0.16,
                weight: isSelected ? 3 : 2,
              }}
              eventHandlers={{
                click: (event) => {
                  if (drawingMode) {
                    event.originalEvent?.stopPropagation();
                    onMapClick?.(event.latlng);
                  } else if (placingStructure) {
                    event.originalEvent?.stopPropagation();
                    onStructureMapClick?.(event.latlng);
                  } else if (drawingRoad) {
                    event.originalEvent?.stopPropagation();
                    onRoadMapClick?.(event.latlng);
                  } else {
                    onSelectField?.(field.id);
                  }
                },
              }}
            >
              <Popup>
                <div className="map-popup">
                  <strong>{field.name}</strong>
                  <div>Cultura: {field.crop || 'Não informada'}</div>
                  <div>Safra: {field.season || 'Não informada'}</div>
                  <div>Área: {field.areaHa ? `${field.areaHa.toFixed(2)} ha` : '—'}</div>
                </div>
              </Popup>
            </Polygon>
          );
        }) : null}

        {visibleLayers.structures !== false ? structures.map((structure) => (
          <Marker
            key={structure.id}
            position={structure.coordinates}
            icon={structureIcon}
            eventHandlers={{
              click: (event) => {
                if (drawingMode) {
                  event.originalEvent?.stopPropagation();
                  onMapClick?.(event.latlng || { lat: structure.coordinates[0], lng: structure.coordinates[1] });
                } else if (placingStructure) {
                  event.originalEvent?.stopPropagation();
                  onStructureMapClick?.(event.latlng || { lat: structure.coordinates[0], lng: structure.coordinates[1] });
                } else if (drawingRoad) {
                  event.originalEvent?.stopPropagation();
                  onRoadMapClick?.(event.latlng || { lat: structure.coordinates[0], lng: structure.coordinates[1] });
                } else {
                  onSelectStructure?.(structure.id);
                }
              },
            }}
          >
            <Popup>
              <div className="map-popup">
                <strong>{structure.nome}</strong>
                <div>Tipo: {structureTypeLabels[structure.tipo] || structure.tipo}</div>
                <div>Descrição: {structure.descricao || 'Sem descrição'}</div>
                <small>ID: {structure.id}</small>
              </div>
            </Popup>
          </Marker>
        )) : null}

        {drawingMode && draftPoints.length > 0 && cursorPos ? (
          <Polyline
            positions={[
              draftPoints[draftPoints.length - 1],
              [cursorPos.lat, cursorPos.lng],
              ...(draftPoints.length >= 2 ? [draftPoints[0]] : []),
            ]}
            pathOptions={{
              color: '#1F7A4C',
              weight: 2,
              dashArray: '5 5',
              opacity: 0.85,
            }}
          />
        ) : null}

        {draftPoints.length > 0 ? (
          <>
            {draftPoints.length >= 3 ? (
              <Polygon
                positions={draftPoints}
                pathOptions={{
                  color: draftValidity === 'invalid' ? '#b33d37' : draftValidity === 'proximity' ? '#b48742' : '#1d6b45',
                  fillColor: draftValidity === 'invalid' ? '#c94c45' : '#8ad8a9',
                  fillOpacity: 0.32,
                  weight: 2.5,
                  dashArray: draftValidity === 'pending' ? '7 5' : undefined,
                }}
              />
            ) : draftPoints.length === 2 ? (
              <Polyline
                positions={draftPoints}
                pathOptions={{
                  color: '#1d6b45',
                  weight: 2.5,
                  dashArray: '6 4',
                }}
              />
            ) : null}

            {draftPoints.map((point, index) => (
              <Marker
                key={`draft-vertex-${index}-${point[0]}-${point[1]}`}
                position={point}
                icon={draftVertexIcon}
                draggable={true}
                eventHandlers={{
                  click: (event) => {
                    if (event?.originalEvent) {
                      DomEvent.stopPropagation(event.originalEvent);
                      DomEvent.preventDefault(event.originalEvent);
                    }
                    if (event) {
                      DomEvent.stopPropagation(event);
                    }
                    onRemoveDraftPoint?.(index);
                  },
                  contextmenu: (event) => {
                    if (event?.originalEvent) {
                      DomEvent.stopPropagation(event.originalEvent);
                      DomEvent.preventDefault(event.originalEvent);
                    }
                    if (event) {
                      DomEvent.stopPropagation(event);
                    }
                    onRemoveDraftPoint?.(index);
                  },
                  dragend: (event) => {
                    const latlng = event.target.getLatLng();
                    onMoveDraftPoint?.(index, { lat: latlng.lat, lng: latlng.lng });
                  },
                }}
              />
            ))}
          </>
        ) : null}

        {visibleLayers.roads !== false ? roads.map((road) => (
          <Polyline
            key={road.id}
            positions={road.points}
            pathOptions={{
              color: String(road.id) === selectedRoadProblemRoadId ? '#C83A32' : '#686A66',
              weight: String(road.id) === selectedRoadProblemRoadId ? 7 : 4,
              opacity: 0.9,
            }}
            eventHandlers={{
              click: (event) => {
                if (drawingMode) {
                  event.originalEvent?.stopPropagation();
                  onMapClick?.(event.latlng);
                } else if (placingStructure) {
                  event.originalEvent?.stopPropagation();
                  onStructureMapClick?.(event.latlng);
                } else if (drawingRoad) {
                  event.originalEvent?.stopPropagation();
                  onRoadMapClick?.(event.latlng);
                } else if (placingRoadProblem) {
                  event.originalEvent?.stopPropagation();
                  onRoadProblemMapClick?.(event.latlng);
                } else {
                  onSelectRoad?.(road.id);
                }
              },
            }}
          >
            <Popup>
              <div className="map-popup">
                <strong>{road.nome}</strong>
                <div>Tipo: {roadTypeLabels[road.tipo] || road.tipo}</div>
                <div>Comprimento: {road.comprimento_m != null && Number.isFinite(Number(road.comprimento_m)) ? `${Number(road.comprimento_m).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m` : 'Não informado'}</div>
                <div>Descrição: {road.descricao || 'Sem descrição'}</div>
                <small>ID: {road.id}</small>
              </div>
            </Popup>
          </Polyline>
        )) : null}

        {visibleLayers.problems !== false ? roadProblems.map((problem) => (
          <Marker
            key={problem.id}
            position={problem.coordinates}
            icon={roadProblemIcons[problem.gravidade] || roadProblemIcons.MEDIA}
            eventHandlers={{ click: () => onSelectRoadProblem?.(problem.id) }}
          >
            <Popup>
              <div className="map-popup">
                <strong>Problema na via</strong>
                <div>Tipo: {roadProblemTypeLabels[problem.tipo] || problem.tipo}</div>
                <div>Gravidade: {roadProblemSeverityLabels[problem.gravidade] || problem.gravidade}</div>
                <div>Status: {roadProblemStatusLabels[problem.status] || problem.status}</div>
                <div>Estrada: {problem.road_nome}</div>
                {problem.descricao ? <div>Descrição: {problem.descricao}</div> : null}
              </div>
            </Popup>
          </Marker>
        )) : null}

        {draftRoadProblemPoint ? (
          <Marker
            position={[draftRoadProblemPoint.latitude, draftRoadProblemPoint.longitude]}
            icon={roadProblemIcons.MEDIA}
            interactive={false}
          />
        ) : null}

        {drawingRoad && draftRoadPoints.length > 0 && cursorPos ? (
          <Polyline
            positions={[
              draftRoadPoints[draftRoadPoints.length - 1],
              [cursorPos.lat, cursorPos.lng],
            ]}
            pathOptions={{
              color: '#d07831',
              weight: 2.5,
              dashArray: '5 5',
              opacity: 0.85,
            }}
          />
        ) : null}

        {draftRoadPoints.length > 0 ? (
          <>
            {draftRoadPoints.length > 1 ? (
              <Polyline
                positions={draftRoadPoints}
                pathOptions={{
                  color: draftValidity === 'invalid' ? '#b33d37' : draftValidity === 'proximity' ? '#b48742' : '#d07831',
                  weight: 5,
                  dashArray: '2 6',
                }}
              />
            ) : null}
            {draftRoadPoints.map((point, index) => (
              <Marker
                key={`draft-road-vertex-${index}-${point[0]}-${point[1]}`}
                position={point}
                icon={draftRoadVertexIcon}
                draggable={true}
                eventHandlers={{
                  click: (event) => {
                    if (event?.originalEvent) {
                      DomEvent.stopPropagation(event.originalEvent);
                      DomEvent.preventDefault(event.originalEvent);
                    }
                    if (event) {
                      DomEvent.stopPropagation(event);
                    }
                    onRemoveDraftRoadPoint?.(index);
                  },
                  contextmenu: (event) => {
                    if (event?.originalEvent) {
                      DomEvent.stopPropagation(event.originalEvent);
                      DomEvent.preventDefault(event.originalEvent);
                    }
                    if (event) {
                      DomEvent.stopPropagation(event);
                    }
                    onRemoveDraftRoadPoint?.(index);
                  },
                  dragend: (event) => {
                    const latlng = event.target.getLatLng();
                    onMoveDraftRoadPoint?.(index, { lat: latlng.lat, lng: latlng.lng });
                  },
                }}
              />
            ))}
          </>
        ) : null}

        {visibleLayers.machines !== false ? machines.map((machine) => (
          Number.isFinite(Number(machine.latitude)) && Number.isFinite(Number(machine.longitude)) ? (
          <AnimatedMachineMarker
            key={machine.maquina_id}
            center={[Number(machine.latitude), Number(machine.longitude)]}
            radius={compact ? 9 : 11}
            eventHandlers={{ click: () => onSelectMachine?.(machine.maquina_id) }}
            pathOptions={{
              color: '#fff',
              weight: 2,
              fillColor: machine.coordinate_source === 'BASE' ? '#64766a' : '#2879a8',
              fillOpacity: 1,
            }}
          >
            <Popup>
              <strong>{machine.nome || `Máquina ${machine.maquina_id}`}</strong>
              <br />
              Status: {machine.status || 'Não informado'}
              <br />
              {machine.coordinate_source === 'BASE'
                ? `Base cadastrada${machine.base_name ? `: ${machine.base_name}` : ''} (sem GPS)`
                : `Última posição: ${machine.timestamp || 'Não informado'}`}
              {machine.source ? <><br />Origem GPS: {machine.source === 'SIMULATED' ? 'DADO SIMULADO' : machine.source === 'REAL' ? 'DADO REAL' : machine.source}</> : null}
              {machine.velocidade != null ? <><br />Velocidade: {machine.velocidade} km/h</> : null}
            </Popup>
          </AnimatedMachineMarker>
          ) : null
        )) : null}

        {plannedRouteCoordinates.length > 1 ? (
          <>
            <Polyline positions={plannedRouteCoordinates} pathOptions={{ color: '#FFFFFF', weight: 7, opacity: 0.9 }} />
            <Polyline positions={plannedRouteCoordinates} pathOptions={{ color: '#141514', weight: 4, opacity: 0.96, dashArray: actualRouteCoordinates.length ? '8 6' : undefined }} />
          </>
        ) : null}
        {actualRouteCoordinates.length > 1 ? (
          <Polyline positions={actualRouteCoordinates} pathOptions={{ color: '#22A864', weight: 4.5, opacity: 0.98 }} />
        ) : null}

        {calculatedRoute && visibleLayers.routes !== false ? (
          <>
            <Polyline
              positions={calculatedRoute.routePoints}
              pathOptions={{ color: '#FFFFFF', weight: 7.5, opacity: 0.92 }}
            />
            <Polyline
              positions={calculatedRoute.routePoints}
              pathOptions={{ color: '#141514', weight: 4.5, opacity: 0.98 }}
            />
            <Marker position={calculatedRoute.origin} icon={divIcon({
              className: 'route-endpoint-marker route-origin-marker',
              html: '<span>O</span>',
              iconSize: [30, 30],
              iconAnchor: [15, 15],
            })}>
              <Popup>Origem da rota calculada</Popup>
            </Marker>
            <Marker position={calculatedRoute.destination} icon={divIcon({
              className: 'route-endpoint-marker route-destination-marker',
              html: '<span>D</span>',
              iconSize: [30, 30],
              iconAnchor: [15, 15],
            })}>
              <Popup>Destino da rota calculada</Popup>
            </Marker>
          </>
        ) : null}
      </MapContainer>
    </div>
  );
}
