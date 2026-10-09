import assert from 'node:assert/strict';
import test from 'node:test';

import {
  geoJsonLineStringToLeaflet,
  routeErrorMessage,
  routeResponseToMap,
} from '../src/utils/routeUtils.js';

const response = {
  found: true,
  distance_m: 1520.5,
  total_cost: 1800.4,
  nodes: [1, 5, 8],
  segments: [2, 7],
  affected_segments: [7],
  blocked_segments: [10],
  problems: [{
    id: 1,
    segment_id: 7,
    tipo: 'BURACO',
    gravidade: 'ALTA',
    status: 'ABERTO',
  }],
  origin: { latitude: -21, longitude: -50 },
  destination: { latitude: -21.01, longitude: -50.01 },
  route: {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [[-50, -21], [-50.01, -21.01]],
    },
  },
};

test('converts GeoJSON longitude/latitude pairs to Leaflet latitude/longitude', () => {
  assert.deepEqual(
    geoJsonLineStringToLeaflet(response.route.geometry),
    [[-21, -50], [-21.01, -50.01]],
  );
});

test('maps a successful route response for display', () => {
  const mapped = routeResponseToMap(response);

  assert.deepEqual(mapped.routePoints, [[-21, -50], [-21.01, -50.01]]);
  assert.deepEqual(mapped.origin, [-21, -50]);
  assert.deepEqual(mapped.destination, [-21.01, -50.01]);
  assert.equal(mapped.distanceMeters, 1520.5);
  assert.equal(mapped.totalCost, 1800.4);
  assert.deepEqual(mapped.nodes, [1, 5, 8]);
  assert.deepEqual(mapped.segments, [2, 7]);
  assert.deepEqual(mapped.affectedSegments, [7]);
  assert.deepEqual(mapped.blockedSegments, [10]);
  assert.equal(mapped.problems[0].gravidade, 'ALTA');
});

test('rejects a response without a found route', () => {
  assert.throws(
    () => routeResponseToMap({ found: false }),
    /Não existe rota disponível/,
  );
});

test('rejects invalid GeoJSON coordinates', () => {
  assert.throws(
    () => geoJsonLineStringToLeaflet({ type: 'Point', coordinates: [1, 2] }),
    /LineString GeoJSON válida/,
  );
  assert.throws(
    () => geoJsonLineStringToLeaflet({ type: 'LineString', coordinates: [[Infinity, 2]] }),
    /coordenadas inválidas/,
  );
});

test('returns friendly server errors and does not hide unknown HTTP errors', async () => {
  const routeUnavailable = await routeErrorMessage({
    status: 422,
    json: async () => ({ detail: 'Não existe rota disponível entre origem e destino.' }),
  });
  const unknownError = await routeErrorMessage({
    status: 500,
    json: async () => ({}),
  });

  assert.equal(routeUnavailable, 'Não existe rota disponível entre origem e destino.');
  assert.equal(unknownError, 'Não foi possível calcular a rota (HTTP 500).');
});
