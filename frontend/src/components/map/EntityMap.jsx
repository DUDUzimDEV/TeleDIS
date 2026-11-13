import React, { useEffect, useRef } from 'react';
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';

import { getCoordinatesCenter, geoLineToLeaflet, geoPointToLeaflet, geoPolygonToLeaflet, formatDateTime } from '../../utils/geoData';
import AnimatedMachineMarker from './AnimatedMachineMarker';

const structureIcon = divIcon({
  className: 'entity-map-marker structure-map-marker',
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function MapFitter({ coordinates, fitKey }) {
  const map = useMap();
  const lastFitKey = useRef('');

  useEffect(() => {
    if (!coordinates.length || fitKey === lastFitKey.current) return;
    lastFitKey.current = fitKey;
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      map.fitBounds(latLngBounds(coordinates), { padding: [28, 28], maxZoom: 15 });
    });
    return () => cancelAnimationFrame(frame);
  }, [coordinates, fitKey, map]);

  return null;
}

export default function EntityMap({
  fields = [],
  structures = [],
  roads = [],
  roadProblems = [],
  machines = [],
  routeCoordinates = [],
  plannedRouteCoordinates = [],
  actualRouteCoordinates = [],
  routeSegmentIds = [],
  affectedSegmentIds = [],
  selectedFieldId,
  selectedMachineId,
  onSelectField,
  onSelectMachine,
  visibleLayers = {},
  className = '',
  zoom = 5,
  fitBoundsKey,
}) {
  const fieldPoints = visibleLayers.fields === false ? [] : fields.flatMap((field) => geoPolygonToLeaflet(field.geometry));
  const roadPoints = visibleLayers.roads === false ? [] : roads.flatMap((road) => geoLineToLeaflet(road.geometry));
  const structurePoints = visibleLayers.structures === false ? [] : structures.map((item) => geoPointToLeaflet(item.geometry)).filter(Boolean);
  const problemPoints = visibleLayers.problems === false ? [] : roadProblems.map((item) => geoPointToLeaflet(item.geometry)).filter(Boolean);
  const machinePoints = visibleLayers.machines === false ? [] : machines.map((item) => [item.latitude, item.longitude]).filter((point) => point.every(Number.isFinite));
  const plannedCoordinates = plannedRouteCoordinates.length ? plannedRouteCoordinates : routeCoordinates;
  const staticCoordinates = [
    ...fieldPoints,
    ...roadPoints,
    ...structurePoints,
    ...problemPoints,
    ...plannedCoordinates,
  ];
  const fitCoordinates = staticCoordinates.length ? staticCoordinates : machinePoints;
  const coordinatesKey = staticCoordinates.length
    ? JSON.stringify(staticCoordinates)
    : machinePoints.length ? 'initial-machine-positions' : '';
  const fitKey = fitBoundsKey == null ? coordinatesKey : `${coordinatesKey}:${fitBoundsKey}`;
  const allCoordinates = [
    ...staticCoordinates,
    ...machinePoints,
    ...plannedCoordinates,
    ...actualRouteCoordinates,
  ];
  const center = getCoordinatesCenter([allCoordinates]) || [0, 0];

  return (
    <div className={`entity-map ${className}`}>
      <MapContainer center={center} zoom={allCoordinates.length ? zoom : 2} scrollWheelZoom className="leaflet-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapFitter coordinates={fitCoordinates} fitKey={fitKey} />
        {visibleLayers.roads !== false ? roads.map((road) => {
          const points = geoLineToLeaflet(road.geometry);
          const isRouteSegment = routeSegmentIds.some((id) => String(id) === String(road.id));
          const isAffectedSegment = affectedSegmentIds.some((id) => String(id) === String(road.id));
          return points.length > 1 ? (
            <Polyline
              key={`road-${road.id}`}
              positions={points}
              pathOptions={{
                color: isAffectedSegment ? '#C83A32' : isRouteSegment ? '#141514' : road.is_blocked ? '#9B9E98' : '#7A7D77',
                weight: isRouteSegment ? 5 : 3.5,
                opacity: isRouteSegment || isAffectedSegment ? 0.98 : 0.78,
                dashArray: road.is_blocked ? '5 6' : undefined,
              }}
            >
              <Popup>
                <strong>{road.nome || `Estrada ${road.id}`}</strong><br />
                {road.tipo || 'Via'}
                {road.length_m != null ? <><br />{Number(road.length_m).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m</> : null}
                {road.is_blocked ? <><br /><strong>Trecho bloqueado</strong></> : null}
                {isRouteSegment ? <><br /><strong>Parte da rota calculada</strong></> : null}
                {isAffectedSegment ? <><br /><strong>Problema associado à rota</strong></> : null}
              </Popup>
            </Polyline>
          ) : null;
        }) : null}
        {visibleLayers.fields !== false ? fields.map((field) => {
          const points = geoPolygonToLeaflet(field.geometry);
          const isSelected = field.id === selectedFieldId;
          return points.length > 2 ? (
            <Polygon
              key={`field-${field.id}`}
              positions={points}
              eventHandlers={{ click: () => onSelectField?.(field.id) }}
              pathOptions={{
                color: isSelected ? '#FFFFFF' : '#1F7A4C',
                fillColor: isSelected ? '#141514' : '#1F7A4C',
                fillOpacity: isSelected ? 0.78 : 0.16,
                weight: isSelected ? 3 : 2,
              }}
            >
              <Popup><strong>{field.nome}</strong><br />{field.cultura || '—'} · {field.area_ha ?? '—'} ha</Popup>
            </Polygon>
          ) : null;
        }) : null}
        {visibleLayers.structures !== false ? structures.map((structure) => {
          const point = geoPointToLeaflet(structure.geometry);
          return point ? (
            <Marker key={`structure-${structure.id}`} position={point} icon={structureIcon}>
              <Popup><strong>{structure.nome}</strong><br />{structure.tipo}</Popup>
            </Marker>
          ) : null;
        }) : null}
        {visibleLayers.problems !== false ? roadProblems.map((problem) => {
          const point = geoPointToLeaflet(problem.geometry);
          return point ? (
            <CircleMarker
              key={`problem-${problem.id}`}
              center={point}
              radius={7.5}
              pathOptions={{
                color: '#FFFFFF',
                weight: 2.5,
                fillColor: problem.gravidade === 'CRITICA' ? '#C83A32' : problem.gravidade === 'ALTA' ? '#D97706' : '#EAB308',
                fillOpacity: 1,
              }}
            >
              <Popup><strong>{problem.tipo}</strong><br />{problem.gravidade} · {problem.status}<br />{problem.road_nome}</Popup>
            </CircleMarker>
          ) : null;
        }) : null}
        {visibleLayers.machines !== false ? machines.map((machine, index) => {
          const point = [Number(machine.latitude), Number(machine.longitude)];
          if (!point.every(Number.isFinite)) return null;
          return (
            <AnimatedMachineMarker
              key={`machine-${machine.id ?? machine.maquina_id ?? index}`}
              center={point}
              radius={8.5}
              eventHandlers={{ click: () => onSelectMachine?.(machine.maquina_id) }}
              pathOptions={{ color: '#FFFFFF', weight: 2.5, fillColor: '#141514', fillOpacity: 1 }}
            >
              <Popup>
                <strong>{machine.nome || `Máquina ${machine.maquina_id}`}</strong>
                <br />{machine.status || 'Localização registrada'}
                {machine.timestamp ? <><br /><small>Atualizado: {formatDateTime(machine.timestamp)}</small></> : null}
                {machine.source === 'SIMULATED' ? (
                  <><br /><strong style={{ color: '#d97706' }}>DADO SIMULADO</strong></>
                ) : machine.source === 'REAL' ? (
                  <><br /><strong style={{ color: '#15803d' }}>DADO REAL</strong></>
                ) : null}
              </Popup>
            </AnimatedMachineMarker>
          );
        }) : null}
        {plannedCoordinates.length > 1 ? (
          <>
            <Polyline positions={plannedCoordinates} pathOptions={{ color: '#FFFFFF', weight: 7, opacity: 0.9 }} />
            <Polyline positions={plannedCoordinates} pathOptions={{ color: '#141514', weight: 4, opacity: 0.96, dashArray: actualRouteCoordinates.length ? '8 6' : undefined }} />
          </>
        ) : null}
        {actualRouteCoordinates.length > 1 ? (
          <Polyline positions={actualRouteCoordinates} pathOptions={{ color: '#22A864', weight: 4.5, opacity: 0.98 }} />
        ) : null}
      </MapContainer>
    </div>
  );
}
