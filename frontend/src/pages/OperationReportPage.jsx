import React, { useMemo } from 'react';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import PageHeading from '../components/ui/PageHeading';
import { ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime } from '../utils/geoData';

const asList = (value) => Array.isArray(value) ? value : [];
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

function durationBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (!start || !end || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return '—';
  const minutes = Math.max(0, Math.round((endDate - startDate) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

export default function OperationReportPage() {
  const { id } = useParams();
  const { can, activeFarm } = useAuth();
  const operationResource = useApiResource(`/api/v1/operations/${id}`);
  const historyResource = useApiResource(`/api/v1/operations/${id}/history`);
  const locationsResource = useApiResource(`/api/v1/operations/${id}/locations`);
  const operationTelemetryResource = useApiResource(`/api/v1/operations/${id}/telemetry`);
  const operation = operationResource.data;
  const telemetry = useMemo(
    () => asList(operationTelemetryResource.data),
    [operationTelemetryResource.data],
  );
  const locations = asList(locationsResource.data?.locations);
  const statuses = asList(historyResource.data?.statuses);
  const routes = asList(historyResource.data?.routes);

  function exportCsv() {
    const rows = [
      ['timestamp', 'machine', 'metric', 'value', 'unit', 'source', 'operation_id'],
      ...telemetry.map((item) => [
        item.timestamp,
        operation.machine_name || operation.machine_id,
        item.metric,
        item.valor,
        item.unidade,
        item.source,
        item.operation_id ?? '',
      ]),
    ];
    const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `teledis-operacao-${id}-telemetria.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (operationResource.loading) return <LoadingState label="Preparando relatório operacional..." />;
  if (operationResource.error) return <ErrorState message={operationResource.error} onRetry={operationResource.reload} />;
  if (!operation) return <ErrorState message="A operação solicitada não foi encontrada." />;

  return (
    <article className="operation-report">
      <PageHeading
        eyebrow={`Relatório operacional · #${operation.id}`}
        title={operation.name || operation.code || `Operação ${operation.id}`}
        description="Documento consolidado a partir dos dados persistidos pelo TeleDis."
        actions={<div className="report-actions"><Link className="button button-secondary" to={`/operacoes/${id}`}><ArrowLeft size={16} />Voltar</Link><button className="button button-secondary" type="button" onClick={() => window.print()}><Printer size={16} />Imprimir / PDF</button><button className="button button-primary" type="button" onClick={exportCsv} disabled={!telemetry.length}><Download size={16} />Exportar CSV</button></div>}
      />
      <header className="report-document-header"><div><span>TeleDis · Relatório operacional</span><strong>{operation.name || `Operação #${operation.id}`}</strong><small>{activeFarm?.name || 'Fazenda ativa'} · {formatDateTime(operation.completed_at || operation.updated_at || operation.created_at)}</small></div><StatusBadge>{operation.status}</StatusBadge></header>
      <section className="report-facts">
        <div><span>Operação</span><strong>{operation.name || operation.code || `#${operation.id}`}</strong></div>
        <div><span>Máquina</span><strong>{operation.machine_name || operation.machine_id || '—'}</strong></div>
        <div><span>Talhão</span><strong>{operation.field_name || operation.field_id || '—'}</strong></div>
        <div><span>Equipe</span><strong>{operation.team_name || operation.team_id || '—'}</strong></div>
        <div><span>Operador</span><strong>{operation.operator_name || operation.operator_id || '—'}</strong></div>
        <div><span>Início</span><strong>{formatDateTime(operation.started_at || operation.created_at)}</strong></div>
        <div><span>Fim</span><strong>{formatDateTime(operation.finished_at || operation.completed_at)}</strong></div>
        <div><span>Duração</span><strong>{durationBetween(operation.started_at || operation.created_at, operation.finished_at || operation.completed_at)}</strong></div>
        <div><span>Plano de rota</span><strong>{operation.route_plan_id ? `#${operation.route_plan_id}` : '—'}</strong></div>
        <div><span>Posições GPS</span><strong>{locationsResource.data?.comparison?.gps_sample_count ?? locations.length}</strong></div>
        <div><span>Versões de rota</span><strong>{routes.length}</strong></div>
        <div><span>Leituras de telemetria</span><strong>{telemetry.length}</strong></div>
      </section>
      <section className="report-section"><h2>Histórico de status</h2>{statuses.length ? <ol className="report-timeline">{statuses.map((item, index) => <li key={item.id || `${item.new_status}-${index}`}><span /><div><strong>{String(item.new_status || item.status || 'Atualização').replaceAll('_', ' ')}</strong><time>{formatDateTime(item.created_at)}</time></div></li>)}</ol> : <p>Nenhum histórico adicional foi retornado.</p>}</section>
      <section className="report-section"><h2>Telemetria no intervalo da operação</h2>{telemetry.length ? <div className="report-table-wrap"><table><thead><tr><th>Horário</th><th>Métrica</th><th>Valor</th><th>Unidade</th><th>Origem</th><th>Operação</th></tr></thead><tbody>{telemetry.map((item) => <tr key={item.id || `${item.timestamp}-${item.metric}`}><td>{formatDateTime(item.timestamp)}</td><td>{item.metric}</td><td>{item.valor ?? '—'}</td><td>{item.unidade || '—'}</td><td>{item.source || '—'}</td><td>{item.operation_id ?? 'Histórico temporal'}</td></tr>)}</tbody></table></div> : <p>Nenhuma leitura da máquina foi retornada dentro da janela temporal desta operação.</p>}<p className="operation-data-note">Vínculo explícito tem precedência; registros sem `operation_id` são exibidos apenas como histórico temporal e não como associação persistida.</p></section>
      <footer className="report-footer">Gerado pelo TeleDis · {formatDateTime(new Date().toISOString())}</footer>
    </article>
  );
}
