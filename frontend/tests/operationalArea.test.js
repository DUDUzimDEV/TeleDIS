import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coordinatesFromPolygon,
  geometryFromPoints,
  validateOperationalArea,
} from '../src/utils/operationalArea.js';

const square = [
  [-21.1, -50.1],
  [-21.1, -50.09],
  [-21.09, -50.09],
  [-21.09, -50.1],
];

test('converts map vertices into a closed WGS84 GeoJSON polygon', () => {
  const geometry = geometryFromPoints(square);

  assert.equal(geometry.type, 'Polygon');
  assert.equal(geometry.coordinates[0].length, 5);
  assert.deepEqual(geometry.coordinates[0][0], geometry.coordinates[0][4]);
  assert.deepEqual(coordinatesFromPolygon(geometry), square);
});

test('accepts a valid operational perimeter', () => {
  assert.equal(validateOperationalArea(square).valid, true);
});

test('rejects fewer than three vertices, duplicates, and zero-area rings', () => {
  assert.equal(validateOperationalArea(square.slice(0, 2)).valid, false);
  assert.equal(validateOperationalArea([square[0], square[0], square[1]]).valid, false);
  assert.equal(validateOperationalArea([
    [-21.1, -50.1],
    [-21.1, -50.09],
    [-21.1, -50.08],
  ]).valid, false);
});

test('rejects out-of-range coordinates and self-intersecting polygons', () => {
  assert.equal(validateOperationalArea([[91, -50], ...square.slice(1)]).valid, false);
  assert.equal(validateOperationalArea([
    [-21.1, -50.1],
    [-21.09, -50.09],
    [-21.1, -50.09],
    [-21.09, -50.1],
  ]).valid, false);
});
