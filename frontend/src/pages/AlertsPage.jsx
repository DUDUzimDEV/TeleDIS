import React, { useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, BellRing, ClipboardList, Construction, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime } from '../utils/geoData';

const POLLING_MS = 15000;
const SEVERITY_RANK = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 };
const SEVERITY_TONE = { CRITICA: 'danger', ALTA: 'warning', MEDIA: 'info', BAIXA: 'neutral' };
const CATEGORY_LABEL = { telemetry: 'Telemetria', roads: 'Vias', operations: 'Operações' };

const asList = (value) => (Array.isArray(value) ? value : []);

function classifyTelemetryEvent(reading, machineNames) {
  const metric = String(reading?.metric || '');
  const numericValue = Number(reading?.valor);
  const machineLabel = machineNames.get(String(reading?.maquina_id)) || `Máquina ${reading?.maquina_id ?? '—'}`;
  const isNamedAlert = /alert|alarme/i.test(metric);
  const isLowFuel = /combustivel|fuel/i.test(metric) && Number.isFinite(numericValue) && numericValue < 15;
  const isHighTemp = /temperatura|temp/i.test(metric) && Number.isFinite(numericValue) && numericValue > 105;

  if (!isNamedAlert && !isLowFuel && !isHighTemp) return null;

  const severity = isHighTemp ? 'CRITICA' : 'ALTA';
  let title = reading.metric || 'Alerta de telemetria';
  if (isHighTemp) title = `Temperatura crítica (${numericValue}${reading?.unidade || '°C'})`;
  else if (isLowFuel) title = `Combustível baixo (${numericValue}${reading?.unidade || '%'})`;

  return {
    id: `telemetry-${reading.id}`,
    category: 'telemetry',
    severity,
    timestamp: reading.timestamp,
    title,
    detail: `${machineLabel} · ${reading.metric || 'Leitura'}: ${reading.valor ?? '—'} ${reading.unidade || ''}`.trim(),
    source: reading.source,
    actionTo: reading.maquina_id ? `/telemetria` : '/telemetria',
    actionLabel: 'Ver telemetria',
  };
}

export default function AlertsPage() {
  const { can } = useAuth();
  const telemetryResource = useApiResource('/api/v1/telemetry', 0, {
    enabled: can('telemetry.view'),
    pollingIntervalMs: POLLING_MS,
  });
  const roadProblemsResource = useApiResource('/api/v1/road-problems', 0, {
    enabled: can('road_problems.view'),
    pollingIntervalMs: POLLING_MS,
  });
  const operationsResource = useApiResource('/api/v1/operations', 0, {
    enabled: can('operations.view'),
    pollingIntervalMs: POLLING_MS,
  });
  const machinesResource = useApiResource('/api/v1/machines', 0, {
    enabled: can('machines.view'),
    pollingIntervalMs: POLLING_MS,
  });
  const roadsResource = useApiResource('/api/v1/roads', 0, {
    enabled: can('roads.view'),
    pollingIntervalMs: POLLING_MS,
  });

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('recent');

  const machineNames = useMemo(
    () => new Map(asList(machinesResource.data).map((m) => [String(m.id), m.nome || m.code || `Máquina ${m.id}`])),
    [machinesResource.data],
  );
  const roadNames = useMemo(
    () => new Map(asList(roadsResource.data).map((r) => [String(r.id), r.nome || `Estrada ${r.id}`])),
    [roadsResource.data],
  );

  const unifiedEvents = useMemo(() => {
    const telemetryEvents = asList(telemetryResource.data)
      .map((reading) => classifyTelemetryEvent(reading, machineNames))
      .filter(Boolean);

    const roadEvents = asList(roadProblemsResource.data)
      .filter((problem) => ['ABERTO', 'EM_ANALISE'].includes(problem?.status))
      .map((problem) => {
        const severity = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'].includes(problem.gravidade)
          ? problem.gravidade
          : 'MEDIA';
        const roadName = problem.road_nome || roadNames.get(String(problem.road_id)) || `Estrada ${problem.road_id ?? '—'}`;
        return {
          id: `road-${problem.id}`,
          category: 'roads',
          severity,
          timestamp: problem.updated_at || problem.created_at,
          title: `${String(problem.tipo || 'PROBLEMA').replaceAll('_', ' ')} · ${roadName}`,
          detail: problem.descricao || `Status: ${String(problem.status || '').replaceAll('_', ' ')}`,
          actionTo: '/mapa',
          actionLabel: 'Abrir mapa',
        };
      });

    const operationEvents = asList(operationsResource.data)
      .filter((operation) => operation?.status === 'INTERROMPIDA')
      .map((operation) => {
        const machineLabel = operation.machine_id != null
          ? (machineNames.get(String(operation.machine_id)) || `Máquina ${operation.machine_id}`)
          : 'Sem máquina';
        return {
          id: `operation-${operation.id}`,
          category: 'operations',
          severity: 'ALTA',
          timestamp: operation.updated_at || operation.created_at,
          title: `Operação interrompida: ${operation.name || operation.code || `#${operation.id}`}`,
          detail: `${machineLabel}${operation.field_name ? ` · Talhão ${operation.field_name}` : ''}`,
          actionTo: `/operacoes/${operation.id}`,
          actionLabel: 'Abrir operação',
        };
      });

    return [...telemetryEvents, ...roadEvents, ...operationEvents];
  }, [machineNames, operationsResource.data, roadNames, roadProblemsResource.data, telemetryResource.data]);

  const filteredEvents = useMemo(() => {
    const filtered = unifiedEvents.filter((event) => (
      (categoryFilter === 'all' || event.category === categoryFilter)
      && (severityFilter === 'all' || event.severity === severityFilter)
    ));
    return [...filtered].sort((left, right) => {
      if (sortBy === 'severity') {
        const rankDiff = (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9);
        if (rankDiff !== 0) return rankDiff;
      }
      return new Date(right.timestamp || 0) - new Date(left.timestamp || 0);
    });
  }, [categoryFilter, severityFilter, sortBy, unifiedEvents]);

  const summary = useMemo(() => ({
    total: unifiedEvents.length,
    critical: unifiedEvents.filter((item) => item.severity === 'CRITICA').length,
    roads: unifiedEvents.filter((item) => item.category === 'roads').length,
    telemetryAndOps: unifiedEvents.filter((item) => item.category === 'telemetry' || item.category === 'operations').length,
  }), [unifiedEvents]);

  const loadingAny = telemetryResource.loading || roadProblemsResource.loading || operationsResource.loading;
  const partialErrors = [
    telemetryResource.error ? { label: 'Telemetria', message: telemetryResource.error, retry: telemetryResource.reload } : null,
    roadProblemsResource.error ? { label: 'Problemas nas vias', message: roadProblemsResource.error, retry: roadProblemsResource.reload } : null,
    operationsResource.error ? { label: 'Operações', message: operationsResource.error, retry: operationsResource.reload } : null,
  ].filter(Boolean);

  function reloadAll() {
    telemetryResource.reload();
    roadProblemsResource.reload();
    operationsResource.reload();
  }

  return (
    <div className="alerts-screen">
      <PageHeading
        eyebrow="Monitoramento operacional"
        title="Central de eventos e alertas"
        description="Linha do tempo unificada de telemetria MQTT, condições críticas das vias e interrupções de campo."
        actions={(
          <button type="button" className="toolbar-button outline" onClick={reloadAll} disabled={loadingAny}>
            <RefreshCw size={15} aria-hidden="true" />Atualizar eventos
          </button>
        )}
      />

      {partialErrors.map((err) => (
        <ErrorState key={err.label} message={`${err.label}: ${err.message}`} onRetry={err.retry} />
      ))}

      <section className="alert-summary-grid" aria-label="Resumo de eventos ativos">
        <article className="alert-summary-card">
          <small>Total ativo</small>
          <strong>{loadingAny && !summary.total ? '—' : summary.total}</strong>
        </article>
        <article className="alert-summary-card is-critical">
          <small>Críticos</small>
          <strong>{loadingAny && !summary.critical ? '—' : summary.critical}</strong>
        </article>
        <article className="alert-summary-card">
          <small>Vias abertas</small>
          <strong>{loadingAny && !summary.roads ? '—' : summary.roads}</strong>
        </article>
        <article className="alert-summary-card">
          <small>Telemetria / Operações</small>
          <strong>{loadingAny && !summary.telemetryAndOps ? '—' : summary.telemetryAndOps}</strong>
        </article>
      </section>

      <section className="alert-control-strip">
        <div className="alert-filters" role="group" aria-label="Filtrar por categoria">
          {[
            { value: 'all', label: 'Todos' },
            { value: 'telemetry', label: 'Telemetria' },
            { value: 'roads', label: 'Vias' },
            { value: 'operations', label: 'Operações' },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              className={categoryFilter === item.value ? 'active' : ''}
              onClick={() => setCategoryFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="alert-select-filters">
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} aria-label="Filtrar por gravidade">
            <option value="all">Todas as gravidades</option>
            <option value="CRITICA">CRITICA</option>
            <option value="ALTA">ALTA</option>
            <option value="MEDIA">MEDIA</option>
            <option value="BAIXA">BAIXA</option>
          </select>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Ordenar eventos">
            <option value="recent">Mais recentes</option>
            <option value="severity">Maior gravidade</option>
          </select>
        </div>
      </section>

      <section className="alert-event-workspace">
        <div className="alert-event-list">
          <header className="section-heading">
            <div><span className="section-overline">Feed consolidado (15s)</span><h2>Eventos ativos</h2></div>
            <span className="data-source-label"><Activity size={14} />MQTT · Vias · Operações</span>
          </header>
          {loadingAny && !unifiedEvents.length ? <LoadingState label="Consolidando eventos da fazenda..." /> : null}
          {!loadingAny && !filteredEvents.length ? (
            <EmptyState
              title={unifiedEvents.length ? 'Nenhum evento neste filtro' : 'Nenhum alerta ativo no momento'}
              description="Não há ocorrências abertas nas vias, interrupções de operação ou limites de telemetria ultrapassados."
              icon={BellRing}
            />
          ) : null}
          <ol className="alert-event-timeline">
            {filteredEvents.map((eventItem) => {
              const Icon = eventItem.category === 'roads'
                ? Construction
                : eventItem.category === 'operations'
                  ? ClipboardList
                  : AlertTriangle;
              return (
                <li
                  className={`alert-event-item ${eventItem.severity === 'CRITICA' || eventItem.severity === 'ALTA' ? 'is-alert' : ''}`}
                  key={eventItem.id}
                >
                  <span className="alert-event-symbol"><Icon size={16} /></span>
                  <time>{formatDateTime(eventItem.timestamp)}</time>
                  <div className="alert-event-copy">
                    <div>
                      <strong>{eventItem.title}</strong>
                      <StatusBadge tone="neutral">{CATEGORY_LABEL[eventItem.category]}</StatusBadge>
                      <StatusBadge tone={SEVERITY_TONE[eventItem.severity] || 'neutral'}>{eventItem.severity}</StatusBadge>
                    </div>
                    <p>
                      {eventItem.detail}
                      {eventItem.source === 'SIMULATED' ? (
                        <span className="event-source-tag is-simulated">[DADO SIMULADO]</span>
                      ) : eventItem.source === 'REAL' ? (
                        <span className="event-source-tag is-real">[DADO REAL]</span>
                      ) : null}
                    </p>
                  </div>
                  <Link className="alert-event-link" to={eventItem.actionTo}>
                    {eventItem.actionLabel}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </div>
  );
}
