import React, { useMemo, useState } from 'react';
import { Activity, BellRing, CircleHelp } from 'lucide-react';

import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime } from '../utils/geoData';

const asList = (value) => Array.isArray(value) ? value : [];
const isAlertMetric = (reading) => /alert|alarme/i.test(String(reading.metric || ''));

export default function AlertsPage() {
  const resource = useApiResource('/api/v1/telemetry');
  const [filter, setFilter] = useState('all');
  const readings = asList(resource.data);
  const filtered = useMemo(() => readings.filter((reading) => (
    filter === 'all' || (filter === 'alerts' ? isAlertMetric(reading) : !isAlertMetric(reading))
  )), [filter, readings]);
  const alertCount = readings.filter(isAlertMetric).length;

  return (
    <div className="alerts-screen">
      <PageHeading
        eyebrow="Monitoramento operacional"
        title="Central de eventos"
        description="Registros retornados pela API de telemetria; a API atual não classifica gravidade de alertas."
      />
      {resource.error ? <ErrorState message={resource.error} onRetry={resource.reload} /> : null}
      <section className="alert-control-strip">
        <div className="alert-counter"><span className="alert-counter-icon"><BellRing size={18} /></span><span><small>Registros recebidos</small><strong>{resource.loading ? '—' : readings.length}</strong></span></div>
        <div className="alert-counter alert-counter-priority"><span className="alert-counter-icon"><CircleHelp size={18} /></span><span><small>Sinais identificados como alerta</small><strong>{resource.loading ? '—' : alertCount}</strong></span></div>
        <div className="alert-filters" role="group" aria-label="Filtrar eventos">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button>
          <button type="button" className={filter === 'alerts' ? 'active' : ''} onClick={() => setFilter('alerts')}>Alertas nomeados</button>
          <button type="button" className={filter === 'readings' ? 'active' : ''} onClick={() => setFilter('readings')}>Outras leituras</button>
        </div>
      </section>
      <section className="alert-event-workspace">
        <div className="alert-event-list">
          <header className="section-heading">
            <div><span className="section-overline">Feed da API</span><h2>Eventos e leituras</h2></div>
            <span className="data-source-label"><Activity size={14} />Telemetria</span>
          </header>
          {resource.loading ? <LoadingState label="Carregando registros..." /> : null}
          {!resource.loading && !resource.error && !filtered.length ? (
            <EmptyState
              title={readings.length ? 'Nenhum registro neste filtro' : 'Nenhum evento disponível'}
              description="Não há ocorrências retornadas pela API. Gravidade e estado de tratamento não estão disponíveis neste endpoint."
              icon={BellRing}
            />
          ) : null}
          <ol className="alert-event-timeline">
            {filtered.map((reading) => (
              <li className={`alert-event-item ${isAlertMetric(reading) ? 'is-alert' : ''}`} key={reading.id}>
                <span className="alert-event-symbol"><Activity size={16} /></span>
                <time>{formatDateTime(reading.timestamp)}</time>
                <div className="alert-event-copy">
                  <div><strong>{reading.metric || 'Leitura de telemetria'}</strong><StatusBadge tone={isAlertMetric(reading) ? 'warning' : 'info'}>{isAlertMetric(reading) ? 'Alerta nomeado' : 'Informativo'}</StatusBadge></div>
                  <p>Máquina {reading.maquina_id} · {reading.valor ?? '—'} {reading.unidade || ''}</p>
                </div>
                <span className="severity-not-provided">Gravidade não informada</span>
              </li>
            ))}
          </ol>
        </div>
        <aside className="alert-capability-note">
          <span className="capability-icon"><CircleHelp size={19} /></span>
          <h3>Classificação disponível</h3>
          <p>A API de telemetria fornece medição, valor, unidade, máquina e horário. Gravidade, status de tratamento e origem detalhada não são fornecidos; por isso não são inferidos nesta tela.</p>
        </aside>
      </section>
    </div>
  );
}
