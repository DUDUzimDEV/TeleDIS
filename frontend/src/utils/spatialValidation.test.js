import assert from 'node:assert/strict';
import test from 'node:test';

import { distanceMeters, isPointInGeoJsonGeometry } from './spatialValidation.js';

test('isPointInGeoJsonGeometry correctly identifies points inside a simple Polygon', () => {
  const polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [-47.930, -15.780],
        [-47.920, -15.780],
        [-47.920, -15.770],
        [-47.930, -15.770],
        [-47.930, -15.780],
      ],
    ],
  };

  // Inside
  assert.equal(isPointInGeoJsonGeometry(-15.775, -47.925, polygon), true);

  // Outside
  assert.equal(isPointInGeoJsonGeometry(-15.760, -47.925, polygon), false);
  assert.equal(isPointInGeoJsonGeometry(-15.775, -47.940, polygon), false);

  // Directly on boundary edge
  assert.equal(isPointInGeoJsonGeometry(-15.780, -47.925, polygon), true);
});

test('isPointInGeoJsonGeometry respects interior rings (holes)', () => {
  const polygonWithHole = {
    type: 'Polygon',
    coordinates: [
      // Outer ring: 0 to 10
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      // Hole ring: 3 to 7
      [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
        [3, 3],
      ],
    ],
  };

  // Inside outer ring, outside hole
  assert.equal(isPointInGeoJsonGeometry(1, 1, polygonWithHole), true);
  assert.equal(isPointInGeoJsonGeometry(8, 8, polygonWithHole), true);

  // Inside hole (should be false)
  assert.equal(isPointInGeoJsonGeometry(5, 5, polygonWithHole), false);

  // Completely outside
  assert.equal(isPointInGeoJsonGeometry(12, 5, polygonWithHole), false);
});

test('isPointInGeoJsonGeometry supports MultiPolygon geometries', () => {
  const multiPolygon = {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
      [
        [
          [10, 10],
          [12, 10],
          [12, 12],
          [10, 12],
          [10, 10],
        ],
      ],
    ],
  };

  // Inside poly 1
  assert.equal(isPointInGeoJsonGeometry(1, 1, multiPolygon), true);
  // Inside poly 2
  assert.equal(isPointInGeoJsonGeometry(11, 11, multiPolygon), true);
  // Between poly 1 and 2 (outside)
  assert.equal(isPointInGeoJsonGeometry(5, 5, multiPolygon), false);
});

test('isPointInGeoJsonGeometry handles Feature and invalid coordinates gracefully', () => {
  const feature = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-50, -20],
          [-40, -20],
          [-40, -10],
          [-50, -10],
          [-50, -20],
        ],
      ],
    },
  };

  assert.equal(isPointInGeoJsonGeometry(-15, -45, feature), true);
  assert.equal(isPointInGeoJsonGeometry(-25, -45, feature), false);
  assert.equal(isPointInGeoJsonGeometry(NaN, -45, feature), false);
  assert.equal(isPointInGeoJsonGeometry(-15, null, feature), false);
  assert.equal(isPointInGeoJsonGeometry(-15, -45, null), false);
  assert.equal(isPointInGeoJsonGeometry(-15, -45, {}), false);
});

test('distanceMeters calculates distance correctly and handles edge cases', () => {
  assert.equal(distanceMeters(0, 0, 0, 0), 0);
  assert.equal(distanceMeters(NaN, 0, 0, 0), 0);

  // ~111km per degree of latitude
  const dist = distanceMeters(0, 0, 1, 0);
  assert.ok(dist > 111000 && dist < 112000, `Expected ~111km, got ${dist}`);

  // Small displacement (~1.5m tolerance check)
  const smallDist = distanceMeters(-15.775000, -47.925000, -15.775010, -47.925000);
  assert.ok(smallDist > 1.0 && smallDist < 1.3, `Expected ~1.1m, got ${smallDist}`);
});
