import React from 'react';

export default function MetricCard({ label, value, change }) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <small className="metric-change">{change}</small>
    </div>
  );
}
