import test from 'node:test';
import assert from 'node:assert/strict';

import { getOperationActions } from '../src/utils/operationWorkflow.js';

const permissions = (...values) => new Set(values);

test('operator actions follow the allowed operation lifecycle', () => {
  const operatorPermissions = permissions('operations.execute');
  const actionsFor = (status) => getOperationActions({ status }, 'OPERATOR', operatorPermissions).map(({ action }) => action);

  assert.deepEqual(actionsFor('ATRIBUIDA'), ['accept', 'cancel']);
  assert.deepEqual(actionsFor('ACEITA'), ['start', 'cancel']);
  assert.deepEqual(actionsFor('EM_EXECUCAO'), ['interrupt', 'complete']);
  assert.deepEqual(actionsFor('INTERROMPIDA'), ['resume', 'cancel']);
  assert.deepEqual(actionsFor('CONCLUIDA'), []);
  assert.deepEqual(actionsFor('CANCELADA'), []);
});

test('administrative cancellation is limited to cancellable states', () => {
  const managerPermissions = permissions('operations.assign');
  const actionsFor = (status) => getOperationActions({ status }, 'COORDINATOR', managerPermissions).map(({ action }) => action);

  assert.deepEqual(actionsFor('PLANEJADA'), ['cancel']);
  assert.deepEqual(actionsFor('EM_EXECUCAO'), []);
  assert.deepEqual(actionsFor('CONCLUIDA'), []);
});

test('viewer and operator without execution permission cannot mutate operations', () => {
  const operation = { status: 'ACEITA' };

  assert.deepEqual(getOperationActions(operation, 'ANALYST', permissions()), []);
  assert.deepEqual(getOperationActions(operation, 'OPERATOR', permissions('operations.view')), []);
});
