import React, { useMemo, useState } from 'react';
import { Activity, Radio, RotateCw, Tractor } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime } from '../utils/geoData';

const asList = (value) => Array.isArray(value) ? value : [];
const LIVE_REFRESH_INTERVAL_MS = 5000;
const metricName = (reading) => reading.metric || 'Medição sem identificação';
const numericValue = (reading) => (
  reading.valor === null || reading.valor === undefined || reading.valor === ''
    ? Number.NaN
    : Number(reading.valor)
);

function MetricTrend({ metric, readings }) {
  const points = readings
    .map((reading) => ({ ...reading, numericValue: numericValue(reading) }))
    .filter((reading) => Number.isFinite(reading.numericValue))
    .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));

  if (!points.length) return null;

  const source = points[0].source;
  const sourceLabel = source === 'SIMULATED'
    ? 'DADO SIMULADO'
    : source === 'REAL' ? 'DADO REAL' : 'ORIGEM NÃO INFORMADA';
  const width = 720;
  const height = 190;
  const padding = 22;
  const values = points.map((point) => point.numericValue);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const coordinates = points.map((point, index) => {
    const x = points.length === 1
      ? width / 2
      : padding + (index * (width - padding * 2)) / (points.length - 1);
    const y = range === 0
      ? height / 2
      : height - padding - ((point.numericValue - minimum) / range) * (height - padding * 2);
    return { ...point, x, y };
  });

  return (
    <article className="telemetry-trend-card">
      <header>
        <div><span className="section-overline">Variação por leitura</span><h2>{metric}</h2></div>
        <div className="telemetry-trend-meta">
          <span className="telemetry-unit">{points[0].unidade || 'Unidade não informada'}</span>
          <StatusBadge tone={source === 'SIMULATED' ? 'warning' : source === 'REAL' ? 'success' : 'neutral'}>{sourceLabel}</StatusBadge>
        </div>
      </header>
      {points.length > 1 ? (
        <p className="telemetry-chart-range">
          Mín. {minimum.toLocaleString('pt-BR')} · Máx. {maximum.toLocaleString('pt-BR')}
        </p>
      ) : (
        <p className="telemetry-chart-range">Uma leitura disponível; a variação será exibida quando houver novos pontos.</p>
      )}
      <svg
        className="telemetry-trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Leituras de ${metric}, em ${points[0].unidade || 'unidade não informada'}, origem ${sourceLabel}`}
      >
        {[0, 1, 2].map((step) => {
          const y = padding + ((height - padding * 2) / 2) * step;
          return <line key={step} x1={padding} x2={width - padding} y1={y} y2={y} className="chart-grid" />;
        })}
        {coordinates.length > 1 ? (
          <polyline
            points={coordinates.map((point) => `${point.x},${point.y}`).join(' ')}
            className={`telemetry-trend-line${source === 'SIMULATED' ? ' simulated' : ''}`}
          />
        ) : null}
        {coordinates.map((point) => (
          <circle key={point.id} cx={point.x} cy={point.y} r="4" className={`telemetry-trend-dot${source === 'SIMULATED' ? ' simulated' : ''}`}>
            <title>{`${formatDateTime(point.timestamp)} · ${point.numericValue} ${point.unidade || ''}`}</title>
          </circle>
        ))}
      </svg>
      <div className="telemetry-chart-times">
        <span>{formatDateTime(points[0].timestamp)}</span>
        {points.length > 1 ? <span>{formatDateTime(points[points.length - 1].timestamp)}</span> : null}
      </div>
    </article>
  );
}

export default function TelemetryPage() {
  const { can } = useAuth();
  const [searchParams] = useSearchParams();
  const [machineFilter, setMachineFilter] = useState(() => searchParams.get('machineId') || 'all');
  const [metricFilter, setMetricFilter] = useState('all');
  const machineQueryEnabled = machineFilter !== 'all' && can('telemetry.history');
  const resource = useApiResource('/api/v1/telemetry', 0, {
    enabled: can('telemetry.view') && !machineQueryEnabled,
    pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
  });
  const machineResource = useApiResource(
    machineFilter !== 'all' ? `/api/v1/telemetry/${machineFilter}` : '',
    0,
    {
      enabled: machineQueryEnabled,
      pollingIntervalMs: LIVE_REFRESH_INTERVAL_MS,
    },
  );
  const readings = machineQueryEnabled
    ? asList(machineResource.data?.historico)
    : asList(resource.data);
  const activeResource = machineQueryEnabled ? machineResource : resource;
  const machinesResource = useApiResource('/api/v1/machines', 0, { enabled: can('machines.view') });
  const machineNames = useMemo(() => new Map(asList(machinesResource.data).map(m => [String(m.id), m.nome || m.code || `Máquina ${m.id}`])), [machinesResource.data]);

  const machineOptions = useMemo(() => [...new Set(readings.map((reading) => String(reading.maquina_id)))]
    .sort((left, right) => Number(left) - Number(right)), [readings]);
  const metricOptions = useMemo(() => [...new Set(readings.map(metricName))]
    .sort((left, right) => left.localeCompare(right, 'pt-BR')), [readings]);
  const filteredReadings = useMemo(() => readings
    .filter((reading) => machineFilter === 'all' || String(reading.maquina_id) === machineFilter)
    .filter((reading) => metricFilter === 'all' || metricName(reading) === metricFilter)
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp)), [machineFilter, metricFilter, readings]);
  const trendGroups = useMemo(() => {
    const groups = new Map();
    filteredReadings.forEach((reading) => {
      const metric = metricName(reading);
      const source = reading.source || 'UNKNOWN';
      const key = `${metric}\u0000${source}`;
      if (!groups.has(key)) groups.set(key, { metric, source, readings: [] });
      groups.get(key).readings.push(reading);
    });
    return [...groups.values()];
  }, [filteredReadings]);
  const machineCount = new Set(filteredReadings.map((reading) => reading.maquina_id)).size;
  const metricCount = new Set(filteredReadings.map(metricName)).size;
  const simulatedCount = filteredReadings.filter((reading) => reading.source === 'SIMULATED').length;

  return (
    <div className="telemetry-page">
      <PageHeading
        eyebrow="Monitoramento de ativos"
        title="Telemetria"
        description="Consulte medições recebidas pela API e compare a variação por métrica, máquina, origem e horário."
        actions={(
          <button className="toolbar-button outline" type="button" onClick={activeResource.reload} disabled={activeResource.loading}>
            <RotateCw size={15} aria-hidden="true" />Atualizar leituras
          </button>
        )}
      />

      {activeResource.error ? <ErrorState message={activeResource.error} onRetry={activeResource.reload} /> : null}

      <section className="telemetry-summary" aria-label="Resumo das leituras filtradas">
        <article><span>Leituras no recorte</span><strong>{resource.loading ? '—' : filteredReadings.length}</strong><small>Registros retornados pela API</small></article>
        <article><span>Máquinas presentes</span><strong>{resource.loading ? '—' : machineCount}</strong><small>Com leitura neste conjunto</small></article>
        <article><span>Métricas disponíveis</span><strong>{resource.loading ? '—' : metricCount}</strong><small>Tipos de medição recebidos</small></article>
        {simulatedCount ? (
          <article className="telemetry-simulated-summary"><span>Leituras simuladas</span><strong>{simulatedCount}</strong><small>Identificadas pela origem informada</small></article>
        ) : null}
      </section>

      <section className="telemetry-data-panel">
        <div className="telemetry-controls">
          <label>
            Máquina
            <select value={machineFilter} onChange={(event) => setMachineFilter(event.target.value)}>
              <option value="all">Todas as máquinas</option>
              {machineFilter !== 'all' && !machineOptions.includes(machineFilter) ? (
                <option value={machineFilter}>Máquina {machineFilter}</option>
              ) : null}
              {machineOptions.map((machineId) => <option key={machineId} value={machineId}>Máquina {machineId}</option>)}
            </select>
          </label>
          <label>
            Métrica
            <select value={metricFilter} onChange={(event) => setMetricFilter(event.target.value)}>
              <option value="all">Todas as métricas</option>
              {metricOptions.map((metric) => <option key={metric} value={metric}>{metric}</option>)}
            </select>
          </label>
          <p><Radio size={15} aria-hidden="true" />Atualização automática a cada 5 s. {machineQueryEnabled ? 'A consulta individual retorna até 20 leituras desta máquina.' : 'A API retorna até 20 leituras recentes da fazenda; o recorte não representa um histórico completo.'}</p>
        </div>

        {activeResource.loading && !readings.length ? <LoadingState label="Carregando leituras de telemetria..." /> : null}
        {!activeResource.loading && !activeResource.error && readings.length === 0 ? (
          <EmptyState
            title="Nenhuma leitura disponível."
            description="Os dados aparecerão quando uma máquina enviar telemetria para esta fazenda."
            icon={Activity}
          />
        ) : null}
        {!activeResource.loading && readings.length > 0 && filteredReadings.length === 0 ? (
          <EmptyState
            title="Nenhuma leitura corresponde aos filtros."
            description="Altere a máquina ou a métrica selecionada para consultar os registros recebidos."
            icon={Activity}
          />
        ) : null}

        {!activeResource.loading && filteredReadings.length > 0 ? (
          <>
            <section className="telemetry-trends" aria-label="Gráficos das métricas">
              {trendGroups.map(({ metric, source, readings: metricReadings }) => (
                <MetricTrend key={`${metric}-${source}`} metric={metric} readings={metricReadings} />
              ))}
            </section>

            <div className="telemetry-table-wrap">
              <table className="telemetry-table">
                <caption>Leituras retornadas para o recorte selecionado</caption>
                <thead><tr><th scope="col">Horário</th><th scope="col">Máquina</th><th scope="col">Métrica</th><th scope="col">Valor</th><th scope="col">Origem</th></tr></thead>
                <tbody>
                  {filteredReadings.map((reading) => (
                    <tr key={reading.id}>
                      <td><time dateTime={reading.timestamp}>{formatDateTime(reading.timestamp)}</time></td>
                      <td>Máquina {reading.maquina_id}</td>
                      <td>{metricName(reading)}</td>
                      <td className="telemetry-value">{reading.valor ?? '—'} {reading.unidade || ''}</td>
                      <td><StatusBadge tone={reading.source === 'SIMULATED' ? 'warning' : 'neutral'}>{reading.source === 'SIMULATED' ? 'DADO SIMULADO' : reading.source === 'REAL' ? 'DADO REAL' : 'ORIGEM NÃO INFORMADA'}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
      <p className="telemetry-scope-note"><Tractor size={15} aria-hidden="true" />As leituras são limitadas ao contexto da fazenda e às permissões da sessão ativa.</p>
      {can('machines.view') ? <Link className="telemetry-machine-link" to="/maquinas">Consultar cadastro da frota</Link> : null}
    </div>
  );
}
