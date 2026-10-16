import assert from 'node:assert/strict';
import test from 'node:test';

import { geoLineToLeaflet } from '../src/utils/geoData.js';

test('converts persisted GeoJSON LineString geometries and Features to Leaflet order', () => {
  const coordinates = [[-50.4, -21.1], [-50.3, -21.2]];
  const expected = [[-21.1, -50.4], [-21.2, -50.3]];

  assert.deepEqual(geoLineToLeaflet({ type: 'LineString', coordinates }), expected);
  assert.deepEqual(geoLineToLeaflet({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: {},
  }), expected);
});
