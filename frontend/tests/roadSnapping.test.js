import assert from 'node:assert/strict';
import test from 'node:test';

import { snapPointToRoad } from '../src/utils/roadSnapping.js';

const road = [
  [-21.1, -50.1],
  [-21.1, -50.099],
];

test('a click near a road snaps onto its segment within tolerance', () => {
  const click = [-21.10009, -50.0995];
  const snapped = snapPointToRoad(click, road);

  assert.ok(snapped);
  assert.ok(snapped.distanceMeters > 9 && snapped.distanceMeters < 11);
  assert.ok(Math.abs(snapped.coordinates[0] - road[0][0]) < 1e-8);
  assert.ok(snapped.coordinates[1] > road[0][1] && snapped.coordinates[1] < road[1][1]);
});

test('a click too far from the road is rejected', () => {
  assert.equal(snapPointToRoad([-21.101, -50.0995], road), null);
});

test('roads without a segment cannot be snapped', () => {
  assert.equal(snapPointToRoad([-21.1, -50.1], [[-21.1, -50.1]]), null);
});