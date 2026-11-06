const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

function associationSource(item) {
  if (item.association_source) return item.association_source;
  return item.operation_id == null ? 'UNLINKED' : 'EXPLICIT';
}

export function buildOperationReportCsv(operation, telemetry) {
  const rows = [
    [
      'timestamp',
      'machine',
      'metric',
      'value',
      'unit',
      'source',
      'operation_id',
      'association_source',
    ],
    ...telemetry.map((item) => [
      item.timestamp,
      operation.machine_name || operation.machine_id,
      item.metric,
      item.valor,
      item.unidade,
      item.source,
      item.operation_id,
      associationSource(item),
    ]),
  ];

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}
