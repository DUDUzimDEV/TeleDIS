import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOperationReportCsv } from './operationReportCsv.js';

test('CSV preserves operation IDs and explicit versus temporal associations', () => {
  const csv = buildOperationReportCsv(
    { machine_name: 'Máquina "A"', machine_id: 7 },
    [
      {
        timestamp: '2026-10-01T14:10:00Z',
        metric: 'temperatura',
        valor: 21.5,
        unidade: 'C',
        source: 'SIMULATED',
        operation_id: 42,
        association_source: 'EXPLICIT',
      },
      {
        timestamp: '2026-10-01T14:11:00Z',
        metric: 'velocidade',
        valor: 4.2,
        unidade: 'km/h',
        source: 'SIMULATED',
        operation_id: null,
        association_source: 'TEMPORAL_FALLBACK',
      },
    ],
  );

  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(
    lines[0],
    '"timestamp","machine","metric","value","unit","source","operation_id","association_source"',
  );
  assert.equal(
    lines[1],
    '"2026-10-01T14:10:00Z","Máquina ""A""","temperatura","21.5","C","SIMULATED","42","EXPLICIT"',
  );
  assert.equal(
    lines[2],
    '"2026-10-01T14:11:00Z","Máquina ""A""","velocidade","4.2","km/h","SIMULATED","","TEMPORAL_FALLBACK"',
  );
});

test('legacy rows without linkage metadata are exported as UNLINKED', () => {
  const csv = buildOperationReportCsv(
    { machine_id: 9 },
    [{
      timestamp: '2026-10-01T14:10:00+00:00',
      metric: 'temperatura',
      valor: 19,
    }],
  );

  assert.ok(csv.includes(
    '"2026-10-01T14:10:00+00:00","9","temperatura","19","","","","UNLINKED"',
  ));
  assert.ok(csv.includes('"2026-10-01T14:10:00+00:00"'));
});
