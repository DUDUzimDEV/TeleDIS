import React from 'react';

export default function AlertsPanel({ alerts }) {
  return (
    <div className="panel-box">
      <div className="panel-header">
        <h3>Alertas recentes</h3>
        <span className="tag muted">Hoje</span>
      </div>

      <div className="alert-list">
        {alerts.map((alert) => (
          <div key={`${alert.machine}-${alert.hour}`} className="alert-item">
            <div className="alert-title-row">
              <strong>{alert.machine}</strong>
              <span className={`severity severity-${alert.severity.toLowerCase()}`}>{alert.severity}</span>
            </div>
            <p>{alert.type}</p>
            <small>{alert.hour}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
