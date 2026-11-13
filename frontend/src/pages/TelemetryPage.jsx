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
  const values = points.map((point) => point.numericValue);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const latestPoint = points[points.length - 1];
  const recentPoints = points.slice(-24);
  const peakThreshold = minimum + range * 0.78;

  return (
    <article className="telemetry-trend-card">
      <header>
        <div>
          <span className="section-overline">Variação por leitura</span>
          <h2>{metric}</h2>
        </div>
        <div className="telemetry-trend-meta">
          <StatusBadge tone={source === 'SIMULATED' ? 'warning' : source === 'REAL' ? 'success' : 'neutral'}>{sourceLabel}</StatusBadge>
        </div>
      </header>
      <div className="telemetry-trend-latest">
        <strong className="telemetry-latest-value">
          {latestPoint.numericValue.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
        </strong>
        <span className="telemetry-unit mono">{latestPoint.unidade || 'un'}</span>
        {points.length > 1 ? (
          <small className="telemetry-chart-range mono">
            Mín. {minimum.toLocaleString('pt-BR')} · Máx. {maximum.toLocaleString('pt-BR')}
          </small>
        ) : (
          <small className="telemetry-chart-range">1 leitura disponível</small>
        )}
      </div>
      <div
        className="telemetry-bar-chart"
        role="img"
        aria-label={`Leituras de ${metric}, em ${latestPoint.unidade || 'unidade não informada'}, origem ${sourceLabel}`}
      >
        {recentPoints.map((point) => {
          const ratio = range === 0 ? 0.65 : 0.18 + ((point.numericValue - minimum) / range) * 0.82;
          const isPeak = range > 0 && point.numericValue >= peakThreshold;
          const barTone = source === 'SIMULATED'
            ? (isPeak ? 'amber' : 'obsidian')
            : (isPeak ? 'agro' : 'obsidian');
          return (
            <div
              key={point.id || `${point.timestamp}-${point.numericValue}`}
              className="telemetry-bar-column"
              title={`${formatDateTime(point.timestamp)} · ${point.numericValue} ${point.unidade || ''}`}
            >
              <span
                className={`telemetry-bar-fill telemetry-bar-fill--${barTone}`}
                style={{ height: `${Math.round(ratio * 100)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="telemetry-chart-times mono">
        <span>{formatDateTime(recentPoints[0].timestamp)}</span>
        {recentPoints.length > 1 ? <span>{formatDateTime(latestPoint.timestamp)}</span> : null}
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
        <article><span>Leituras no recorte</span><strong>{activeResource.loading ? '—' : filteredReadings.length}</strong><small>Registros retornados pela API</small></article>
        <article><span>Máquinas presentes</span><strong>{activeResource.loading ? '—' : machineCount}</strong><small>Com leitura neste conjunto</small></article>
        <article><span>Métricas disponíveis</span><strong>{activeResource.loading ? '—' : metricCount}</strong><small>Tipos de medição recebidos</small></article>
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
                <option value={machineFilter}>{machineNames.get(machineFilter) || `Máquina ${machineFilter}`}</option>
              ) : null}
              {machineOptions.map((machineId) => <option key={machineId} value={machineId}>{machineNames.get(machineId) || `Máquina ${machineId}`}</option>)}
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
                      <td>{machineNames.get(String(reading.maquina_id)) || `Máquina ${reading.maquina_id}`}</td>
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
