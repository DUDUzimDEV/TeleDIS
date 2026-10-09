import React from 'react';
import { divIcon, latLngBounds } from 'leaflet';
import { CircleMarker, GeoJSON, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';

import { getCoordinatesCenter } from '../../utils/geoData';

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
  });

  return null;
}

function PersistedEntityBounds({ fields, structures, roads, roadProblems, machines, operationalArea, ready, placingRoadProblem, selectedRoadProblemRoadId }) {
  const map = useMap();

  React.useEffect(() => {
    if (!ready || placingRoadProblem) {
      return;
    }

    const coordinates = [
      ...fields.flatMap((field) => field.points),
      ...structures.map((structure) => structure.coordinates),
      ...roads.flatMap((road) => road.points),
      ...roadProblems.map((problem) => problem.coordinates),
      ...machines.map((machine) => [machine.latitude, machine.longitude]),
      ...geometryLeafletCoordinates(operationalArea?.geometry),
      ...geometryLeafletCoordinates(operationalArea?.proximity_zone),
    ];

    if (coordinates.length > 0) {
      const frame = requestAnimationFrame(() => {
        map.invalidateSize({ pan: false });
        map.fitBounds(latLngBounds(coordinates), { padding: [32, 32], maxZoom: 15 });
      });

      return () => cancelAnimationFrame(frame);
    }

    return undefined;
  }, [fields, machines, map, operationalArea, placingRoadProblem, ready, roadProblems, roads, structures]);

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

function CalculatedRouteBounds({ routePoints }) {
  const map = useMap();

  React.useEffect(() => {
    if (!routePoints || routePoints.length < 2) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      map.fitBounds(latLngBounds(routePoints), { padding: [56, 56], maxZoom: 17 });
    });
    return () => cancelAnimationFrame(frame);
  }, [map, routePoints]);

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
  fields = [],
  structures = [],
  roads = [],
  roadProblems = [],
  fitToPersistedEntities = false,
  selectedFieldId,
  onSelectField,
  onSelectMachine,
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
  ];
  const center = getCoordinatesCenter([mapCoordinates]) || [0, 0];

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
        />
        <CalculatedRouteBounds routePoints={calculatedRoute?.routePoints} />
        <PersistedEntityBounds
          fields={fields}
          structures={structures}
          roads={roads}
          roadProblems={roadProblems}
          machines={machines}
          operationalArea={operationalArea}
          ready={fitToPersistedEntities}
          placingRoadProblem={placingRoadProblem}
          selectedRoadProblemRoadId={selectedRoadProblemRoadId}
        />

        {operationalArea?.proximity_zone ? (
          <GeoJSON
            key={`farm-proximity-${JSON.stringify(operationalArea.proximity_zone)}`}
            data={operationalArea.proximity_zone}
            style={{ color: '#b48742', weight: 1.5, dashArray: '6 5', fillColor: '#e6d6b5', fillOpacity: 0.08 }}
          />
        ) : null}
        {operationalArea?.geometry ? (
          <GeoJSON
            key={`farm-area-${JSON.stringify(operationalArea.geometry)}`}
            data={operationalArea.geometry}
            style={{ color: '#286545', weight: 2.5, fillColor: '#72a982', fillOpacity: 0.16 }}
          />
        ) : null}

        {visibleLayers.fields !== false ? fields.map((field) => {
          const isSelected = selectedFieldId === field.id;

          return (
            <Polygon
              key={field.id}
              positions={field.points}
              pathOptions={{
                color: isSelected ? '#163f2d' : '#2c7a52',
                fillColor: '#8ad8a9',
                fillOpacity: isSelected ? 0.42 : 0.25,
                weight: isSelected ? 3 : 2,
              }}
              eventHandlers={{
                click: () => onSelectField?.(field.id),
              }}
            >
              <Popup>
                <div className="map-popup">
                  <strong>{field.name}</strong>
                  <div>Cultura: {field.crop || 'Cana-de-açúcar'}</div>
                  <div>Safra: {field.season || '2026/27'}</div>
                  <div>Área: {field.areaHa ? `${field.areaHa.toFixed(2)} ha` : '—'}</div>
                </div>
              </Popup>
            </Polygon>
          );
        }) : null}

        {visibleLayers.structures !== false ? structures.map((structure) => (
          <Marker key={structure.id} position={structure.coordinates} icon={structureIcon}>
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

        {draftPoints.length > 0 ? (
          <>
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

            {draftPoints.map((point, index) => (
              <CircleMarker
                key={`${point[0]}-${point[1]}-${index}`}
                center={point}
                radius={5}
                pathOptions={{ color: '#1d6b45', fillColor: '#ffffff', weight: 2 }}
              />
            ))}
          </>
        ) : null}

        {visibleLayers.roads !== false ? roads.map((road) => (
          <Polyline
            key={road.id}
            positions={road.points}
            pathOptions={{
              color: String(road.id) === selectedRoadProblemRoadId ? '#bd493d' : '#bd6c2f',
              weight: String(road.id) === selectedRoadProblemRoadId ? 8 : 5,
              opacity: 0.98,
            }}
            eventHandlers={{
              click: (event) => {
                if (placingRoadProblem) {
                  event.originalEvent?.stopPropagation();
                  onRoadProblemMapClick?.(event.latlng);
                }
              },
            }}
          >
            <Popup>
              <div className="map-popup">
                <strong>{road.nome}</strong>
                <div>Tipo: {roadTypeLabels[road.tipo] || road.tipo}</div>
                <div>Comprimento: {road.comprimento_m.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m</div>
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
              <CircleMarker
                key={`draft-road-${index}`}
                center={point}
                radius={5}
                pathOptions={{ color: '#a85921', fillColor: '#ffffff', weight: 2 }}
              />
            ))}
          </>
        ) : null}

        {visibleLayers.machines !== false ? machines.map((machine) => (
          <CircleMarker
            key={machine.maquina_id}
            center={[Number(machine.latitude), Number(machine.longitude)]}
            radius={compact ? 9 : 11}
            eventHandlers={{ click: () => onSelectMachine?.(machine.maquina_id) }}
            pathOptions={{ color: '#fff', weight: 2, fillColor: '#2879a8', fillOpacity: 1 }}
          >
            <Popup>
              <strong>{machine.nome || `Máquina ${machine.maquina_id}`}</strong>
              <br />
              Status: {machine.status || 'Não informado'}
              <br />
              Última posição: {machine.timestamp || 'Não informado'}
              {machine.velocidade != null ? <><br />Velocidade: {machine.velocidade} km/h</> : null}
            </Popup>
          </CircleMarker>
        )) : null}

        {calculatedRoute && visibleLayers.routes !== false ? (
          <>
            <Polyline
              positions={calculatedRoute.routePoints}
              pathOptions={{ color: '#1464c0', weight: 7, opacity: 0.95 }}
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
