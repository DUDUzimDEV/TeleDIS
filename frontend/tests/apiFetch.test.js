import assert from 'node:assert/strict';
import test from 'node:test';

import { apiFetch, onUnauthorized } from '../src/api/apiClient.js';

const unauthorizedResponse = { status: 401 };

function installRequestGlobals({ token = 'session-token', status = 401 } = {}) {
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const values = new Map(token ? [['teledis_token', token]] : []);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.fetch = async () => ({ ...unauthorizedResponse, status });
  return {
    values,
    restore() {
      globalThis.localStorage = originalStorage;
      globalThis.fetch = originalFetch;
    },
  };
}

test('invalidates a stored session after an authenticated 401', async () => {
  const globals = installRequestGlobals();
  let invalidations = 0;
  const unsubscribe = onUnauthorized(() => { invalidations += 1; });
  try {
    const response = await apiFetch('/api/v1/machines');
    assert.equal(response.status, 401);
    assert.equal(invalidations, 1);
  } finally {
    unsubscribe();
    globals.restore();
  }
});

test('does not invalidate a session when login credentials are rejected', async () => {
  const globals = installRequestGlobals();
  let invalidations = 0;
  const unsubscribe = onUnauthorized(() => { invalidations += 1; });
  try {
    await apiFetch('/api/v1/auth/login', { method: 'POST' });
    assert.equal(invalidations, 0);
  } finally {
    unsubscribe();
    globals.restore();
  }
});

test('does not invalidate a session for unauthenticated requests', async () => {
  const globals = installRequestGlobals({ token: null });
  let invalidations = 0;
  const unsubscribe = onUnauthorized(() => { invalidations += 1; });
  try {
    await apiFetch('/api/v1/machines');
    assert.equal(invalidations, 0);
  } finally {
    unsubscribe();
    globals.restore();
  }
});

test('does not invalidate a newer session when an old request returns 401', async () => {
  const globals = installRequestGlobals();
  let resolveResponse;
  let invalidations = 0;
  globalThis.fetch = () => new Promise((resolve) => { resolveResponse = resolve; });
  const unsubscribe = onUnauthorized(() => { invalidations += 1; });
  try {
    const pendingRequest = apiFetch('/api/v1/machines');
    globals.values.set('teledis_token', 'new-session-token');
    resolveResponse(unauthorizedResponse);
    await pendingRequest;
    assert.equal(invalidations, 0);
  } finally {
    unsubscribe();
    globals.restore();
  }
});
