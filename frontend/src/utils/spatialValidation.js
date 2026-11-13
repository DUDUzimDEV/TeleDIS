/**
 * Pure spatial validation utilities for client-side geometric checks in WGS84 GeoJSON.
 */

/**
 * Checks if a point (lng, lat) lies on a segment between p1 and p2 within epsilon tolerance.
 *
 * @param {number} lng
 * @param {number} lat
 * @param {[number, number]} p1 - [longitude, latitude]
 * @param {[number, number]} p2 - [longitude, latitude]
 * @param {number} [epsilon=1e-9]
 * @returns {boolean}
 */
export function isPointOnSegment(lng, lat, p1, p2, epsilon = 1e-9) {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const lenSq = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (lenSq < 1e-16) return false;

  // Cross product to test collinearity
  const cross = (lat - y1) * (x2 - x1) - (lng - x1) * (y2 - y1);
  if (Math.abs(cross) > epsilon) return false;

  // Dot product to test if point is within the bounding segment
  const dot = (lng - x1) * (x2 - x1) + (lat - y1) * (y2 - y1);
  return dot >= -epsilon && dot <= lenSq + epsilon;
}

/**
 * Checks if a point (lng, lat) is inside a closed 2D ring using ray casting.
 * Ring coordinates are [lng, lat].
 *
 * @param {number} lng
 * @param {number} lat
 * @param {Array<[number, number]>} rawRing
 * @returns {boolean}
 */
export function isPointInRing(lng, lat, rawRing) {
  if (!Array.isArray(rawRing) || rawRing.length < 3) return false;

  // If ring is closed (first and last vertex identical), remove closing vertex to avoid degenerate zero-length edge
  const isClosed = rawRing[0][0] === rawRing[rawRing.length - 1][0] && rawRing[0][1] === rawRing[rawRing.length - 1][1];
  const ring = isClosed ? rawRing.slice(0, -1) : rawRing;
  if (ring.length < 3) return false;

  let inside = false;
  let j = ring.length - 1;
  for (let i = 0; i < ring.length; i += 1) {
    const p1 = ring[i];
    const p2 = ring[j];

    // If point is directly on the boundary segment, treat as inside (matches PostGIS ST_Covers)
    if (isPointOnSegment(lng, lat, p1, p2)) {
      return true;
    }

    const xi = p1[0];
    const yi = p1[1];
    const xj = p2[0];
    const yj = p2[1];

    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);

    if (intersect) {
      inside = !inside;
    }

    j = i;
  }

  return inside;
}

/**
 * Checks if a point (lng, lat) is inside a GeoJSON Polygon coordinates structure:
 * [outerRing, ...holeRings]
 *
 * @param {number} lng
 * @param {number} lat
 * @param {Array<Array<[number, number]>>} rings
 * @returns {boolean}
 */
export function isPointInPolygonRings(lng, lat, rings) {
  if (!Array.isArray(rings) || rings.length === 0) return false;
  const outerRing = rings[0];
  if (!isPointInRing(lng, lat, outerRing)) {
    return false;
  }
  // If point is inside any hole, it is outside the polygon
  for (let i = 1; i < rings.length; i += 1) {
    if (isPointInRing(lng, lat, rings[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Validates if coordinates (lat, lng) are inside a GeoJSON Polygon or MultiPolygon.
 * Supports Feature, GeometryCollection, Polygon and MultiPolygon with interior rings (holes).
 *
 * @param {number} lat - Latitude in WGS84
 * @param {number} lng - Longitude in WGS84
 * @param {object} geojsonGeometry - GeoJSON Polygon, MultiPolygon, Feature, or GeometryCollection
 * @returns {boolean}
 */
export function isPointInGeoJsonGeometry(lat, lng, geojsonGeometry) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !geojsonGeometry) {
    return false;
  }

  let geom = geojsonGeometry;
  if (geom.type === 'Feature') {
    geom = geom.geometry;
  }
  if (!geom || !geom.type) {
    return false;
  }

  if (geom.type === 'Polygon') {
    return isPointInPolygonRings(lng, lat, geom.coordinates);
  }

  if (geom.type === 'MultiPolygon') {
    if (!Array.isArray(geom.coordinates)) return false;
    return geom.coordinates.some((rings) => isPointInPolygonRings(lng, lat, rings));
  }

  if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
    return geom.geometries.some((subGeom) => isPointInGeoJsonGeometry(lat, lng, subGeom));
  }

  return false;
}

/**
 * Calculates distance in meters between two WGS84 points using Haversine formula.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in meters
 */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    return 0;
  }
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180))
    * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
