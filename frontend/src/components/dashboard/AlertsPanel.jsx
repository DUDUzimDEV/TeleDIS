import React from 'react';
import StatusBadge from '../ui/StatusBadge';

export default function AlertsPanel({ alerts }) {
  return (
    <div className="panel-box alerts-bento-panel">
      <div className="panel-header">
        <div>
          <span className="section-overline">Monitoramento</span>
          <h3>Alertas recentes</h3>
        </div>
        <StatusBadge tone="neutral">Hoje</StatusBadge>
      </div>

      <div className="alert-list">
        {alerts.map((alert) => {
          const sev = String(alert.severity || '').toLowerCase();
          const tone = sev === 'critica' || sev === 'alta' ? 'danger' : sev === 'media' ? 'warning' : 'neutral';
          return (
            <div key={`${alert.machine}-${alert.hour}`} className="alert-item">
              <div className="alert-title-row">
                <strong>{alert.machine}</strong>
                <StatusBadge tone={tone}>{alert.severity}</StatusBadge>
              </div>
              <p>{alert.type}</p>
              <small className="mono">{alert.hour}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}
