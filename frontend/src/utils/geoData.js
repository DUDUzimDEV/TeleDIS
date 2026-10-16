export function geoPointToLeaflet(geometry) {
  const coordinates = geometry?.coordinates;
  return Array.isArray(coordinates) && coordinates.length >= 2
    ? [Number(coordinates[1]), Number(coordinates[0])]
    : null;
}

export function geoLineToLeaflet(geometry) {
  const lineGeometry = geometry?.type === 'Feature' ? geometry.geometry : geometry;
  return Array.isArray(lineGeometry?.coordinates)
    ? lineGeometry.coordinates.map(([longitude, latitude]) => [Number(latitude), Number(longitude)])
    : [];
}

export function geoPolygonToLeaflet(geometry) {
  const ring = geometry?.coordinates?.[0];
  return Array.isArray(ring)
    ? ring.map(([longitude, latitude]) => [Number(latitude), Number(longitude)])
    : [];
}

export function getCoordinatesCenter(groups) {
  const points = groups.flat().filter((point) => (
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
  ));
  if (!points.length) return null;
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
