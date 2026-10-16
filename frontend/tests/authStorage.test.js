import assert from 'node:assert/strict';
import test from 'node:test';

import { clearStoredSession } from '../src/context/authStorage.js';

test('clears all persisted authentication and farm context values', () => {
  const values = new Map([
    ['teledis_token', 'stale-token'],
    ['teledis_user', '{"id":1}'],
    ['teledis_farms', '[{"id":1}]'],
    ['teledis_farm_id', '1'],
    ['unrelated_preference', 'compact'],
  ]);
  const storage = {
    removeItem: (key) => values.delete(key),
  };

  clearStoredSession(storage);

  assert.equal(values.has('teledis_token'), false);
  assert.equal(values.has('teledis_user'), false);
  assert.equal(values.has('teledis_farms'), false);
  assert.equal(values.has('teledis_farm_id'), false);
  assert.equal(values.get('unrelated_preference'), 'compact');
});
