import React, { useEffect } from 'react';
import { divIcon, latLngBounds } from 'leaflet';
import { CircleMarker, GeoJSON, MapContainer, Marker, Polygon, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';

const vertexIcon = divIcon({
  className: 'operational-area-vertex',
  html: '<span></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const selectedVertexIcon = divIcon({
  className: 'operational-area-vertex selected',
  html: '<span></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function coordinatePairs(geometry) {
  if (!geometry?.coordinates) return [];
  const points = [];
  const visit = (value) => {
    if (Array.isArray(value) && value.length >= 2 && value.every(Number.isFinite)) {
      points.push([value[1], value[0]]);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry.coordinates);
  return points;
}

function MapClick({ enabled, onAddPoint }) {
  useMapEvents({
    click(event) {
      if (enabled) onAddPoint([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

function midpoint(start, end) {
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
}

function MapBounds({ geometry, zone, center }) {
  const map = useMap();
  useEffect(() => {
    const points = [...coordinatePairs(geometry), ...coordinatePairs(zone)];
    if (points.length) {
      map.fitBounds(latLngBounds(points), { padding: [28, 28], maxZoom: 15 });
    } else if (center && center.length === 2) {
      map.setView([center[1], center[0]], 13);
    }
  }, [center, geometry, map, zone]);
  return null;
}

export default function OperationalAreaMap({
  geometry,
  proximityZone,
  center,
  draftPoints,
  isEditing,
  validity,
  selectedPointIndex,
  onAddPoint,
  onMovePoint,
  onSelectPoint,
  onInsertPoint,
}) {
  const defaultCenter = center ? [center[1], center[0]] : [-15, -50];
  const draftColor = validity === 'invalid' ? '#b33d37' : '#276948';

  return (
    <div className="operational-area-map">
      <MapContainer center={defaultCenter} zoom={center ? 13 : 4} scrollWheelZoom className="leaflet-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapBounds geometry={geometry} zone={proximityZone} center={center} />
        <MapClick enabled={isEditing} onAddPoint={onAddPoint} />
        {proximityZone ? (
          <GeoJSON
            key={`proximity-${JSON.stringify(proximityZone)}`}
            data={proximityZone}
            style={{ color: '#b48742', weight: 1.5, dashArray: '6 5', fillColor: '#e6d6b5', fillOpacity: 0.12 }}
          />
        ) : null}
        {geometry ? (
          <GeoJSON
            key={`operational-area-${JSON.stringify(geometry)}`}
            data={geometry}
            style={{ color: '#286545', weight: 2.5, fillColor: '#72a982', fillOpacity: 0.2 }}
          />
        ) : null}
        {draftPoints.length >= 3 ? (
          <Polygon
            positions={draftPoints}
            pathOptions={{
              color: draftColor,
              weight: 3,
              dashArray: validity === 'pending' ? '7 5' : undefined,
              fillColor: draftColor,
              fillOpacity: 0.16,
            }}
          />
        ) : draftPoints.length > 1 ? (
          <Polyline
            positions={draftPoints}
            pathOptions={{ color: draftColor, weight: 3, dashArray: validity === 'pending' ? '7 5' : undefined }}
          />
        ) : null}
        {isEditing ? draftPoints.map((point, index) => {
          const next = draftPoints[(index + 1) % draftPoints.length];
          const between = midpoint(point, next);
          return (
            <React.Fragment key={`segment-${index}`}>
              {draftPoints.length >= 2 ? (
                <CircleMarker
                  center={between}
                  radius={5}
                  pathOptions={{ color: '#fff', weight: 2, fillColor: '#638a6d', fillOpacity: 0.8 }}
                  bubblingMouseEvents={false}
                  eventHandlers={{
                    click(event) {
                      event.originalEvent?.stopPropagation();
                      onInsertPoint(index, between);
                    },
                  }}
                />
              ) : null}
              <Marker
                key={`vertex-${index}`}
                position={point}
                icon={selectedPointIndex === index ? selectedVertexIcon : vertexIcon}
                draggable
                eventHandlers={{
                  click(event) {
                    event.originalEvent?.stopPropagation();
                    onSelectPoint?.(index);
                  },
                  dragend(event) {
                    const position = event.target.getLatLng();
                    onMovePoint(index, [position.lat, position.lng]);
                    onSelectPoint?.(index);
                  },
                }}
              />
            </React.Fragment>
          );
        }) : null}
      </MapContainer>
    </div>
  );
}
