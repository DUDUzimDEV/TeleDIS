export function coordinatesFromPolygon(geometry) {
  if (geometry?.type !== 'Polygon' || geometry.coordinates?.length !== 1 || !Array.isArray(geometry.coordinates[0])) return [];
  const ring = geometry.coordinates[0];
  const openRing = ring.length > 1
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  return openRing.map(([longitude, latitude]) => [Number(latitude), Number(longitude)]);
}

export function geometryFromPoints(points) {
  const ring = points.map(([latitude, longitude]) => [longitude, latitude]);
  if (ring.length && (
    ring[0][0] !== ring[ring.length - 1][0]
    || ring[0][1] !== ring[ring.length - 1][1]
  )) {
    ring.push(ring[0]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

function orientation(a, b, c) {
  return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
}

function onSegment(a, b, point) {
  return point[0] >= Math.min(a[0], b[0])
    && point[0] <= Math.max(a[0], b[0])
    && point[1] >= Math.min(a[1], b[1])
    && point[1] <= Math.max(a[1], b[1]);
}

function segmentsIntersect(a, b, c, d) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  const epsilon = 1e-12;

  if (((first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon))
    && ((third > epsilon && fourth < -epsilon) || (third < -epsilon && fourth > epsilon))) {
    return true;
  }
  return (Math.abs(first) <= epsilon && onSegment(a, b, c))
    || (Math.abs(second) <= epsilon && onSegment(a, b, d))
    || (Math.abs(third) <= epsilon && onSegment(c, d, a))
    || (Math.abs(fourth) <= epsilon && onSegment(c, d, b));
}

export function validateOperationalArea(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return { valid: false, message: 'O perímetro precisa ter pelo menos três vértices.' };
  }
  if (points.some(([latitude, longitude]) => (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ))) {
    return { valid: false, message: 'Cada vértice deve usar coordenadas válidas em WGS84.' };
  }
  if (new Set(points.map(([latitude, longitude]) => `${latitude},${longitude}`)).size < 3) {
    return { valid: false, message: 'O perímetro precisa ter três vértices distintos.' };
  }

  let twiceArea = 0;
  const ring = points.map(([latitude, longitude]) => [longitude, latitude]);
  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    twiceArea += ring[index][0] * ring[next][1] - ring[next][0] * ring[index][1];
  }
  if (Math.abs(twiceArea) < 1e-12) {
    return { valid: false, message: 'Os vértices precisam formar uma área maior que zero.' };
  }

  for (let first = 0; first < ring.length; first += 1) {
    const firstNext = (first + 1) % ring.length;
    for (let second = first + 1; second < ring.length; second += 1) {
      const secondNext = (second + 1) % ring.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(ring[first], ring[firstNext], ring[second], ring[secondNext])) {
        return { valid: false, message: 'O perímetro não pode cruzar a si próprio.' };
      }
    }
  }
  return { valid: true, message: 'Perímetro válido. A validação final será feita pelo PostGIS ao salvar.' };
}
