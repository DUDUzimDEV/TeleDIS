import assert from 'node:assert/strict';
import test from 'node:test';

import { getCommunicationStatus, getLatestTimestamp, LIVE_DATA_STALE_AFTER_MS } from '../src/utils/liveStatus.js';

test('marks only records up to the live threshold as online', () => {
  const now = Date.parse('2026-10-16T18:00:00.000Z');

  assert.equal(
    getCommunicationStatus(new Date(now - LIVE_DATA_STALE_AFTER_MS).toISOString(), now),
    'ONLINE',
  );
  assert.equal(
    getCommunicationStatus(new Date(now - LIVE_DATA_STALE_AFTER_MS - 1).toISOString(), now),
    'STALE',
  );
});

test('does not classify missing, invalid, or future timestamps as online', () => {
  const now = Date.parse('2026-10-16T18:00:00.000Z');

  assert.equal(getCommunicationStatus(null, now), 'NO_DATA');
  assert.equal(getCommunicationStatus('not-a-date', now), 'NO_DATA');
  assert.equal(getCommunicationStatus(new Date(now + 1).toISOString(), now), 'STALE');
});

test('selects the latest valid timestamp across available sources', () => {
  assert.equal(
    getLatestTimestamp('2026-10-16T17:00:00.000Z', 'invalid', '2026-10-16T17:01:00.000Z'),
    Date.parse('2026-10-16T17:01:00.000Z'),
  );
  assert.equal(getLatestTimestamp(null, 'invalid'), null);
});
