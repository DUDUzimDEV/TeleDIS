import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiResponseError, readApiResponse } from '../src/api/apiClient.js';

function response({ status = 200, statusText = 'OK', contentType, body = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
  };
}

test('preserves HTTP status and plain-text error without trying to parse JSON', async () => {
  const error = await readApiResponse(response({
    status: 500,
    statusText: 'Internal Server Error',
    contentType: 'text/plain; charset=utf-8',
    body: 'Internal Server Error',
  })).then(
    () => null,
    (requestError) => requestError,
  );

  assert.ok(error instanceof ApiResponseError);
  assert.equal(error.status, 500);
  assert.match(error.message, /HTTP 500: Internal Server Error/);
  assert.equal(error.responseBody, 'Internal Server Error');
});

test('reads structured API errors from JSON media types', async () => {
  await assert.rejects(
    readApiResponse(response({
      status: 409,
      statusText: 'Conflict',
      contentType: 'application/problem+json',
      body: JSON.stringify({ detail: { message: 'Área incompatível.' } }),
    })),
    (error) => {
      assert.ok(error instanceof ApiResponseError);
      assert.equal(error.status, 409);
      assert.match(error.message, /HTTP 409: Área incompatível\./);
      assert.equal(error.payload.detail.message, 'Área incompatível.');
      return true;
    },
  );
});

test('rejects a successful non-JSON response with its original status', async () => {
  await assert.rejects(
    readApiResponse(response({
      status: 200,
      contentType: 'text/html',
      body: '<html>Unexpected server page</html>',
    })),
    (error) => {
      assert.ok(error instanceof ApiResponseError);
      assert.equal(error.status, 200);
      assert.match(error.message, /resposta não JSON/);
      return true;
    },
  );
});
