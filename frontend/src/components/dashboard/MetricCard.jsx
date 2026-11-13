import React from 'react';

export default function MetricCard({ label, value, change, tone = 'positive' }) {
  return (
    <article className="metric-card">
      <header className="metric-card-header">
        <span className="metric-label">{label}</span>
      </header>
      <strong className="metric-value">{value}</strong>
      {change ? (
        <div className="metric-card-footer">
          <small className={`metric-change metric-change--${tone}`}>{change}</small>
        </div>
      ) : null}
    </article>
  );
}
