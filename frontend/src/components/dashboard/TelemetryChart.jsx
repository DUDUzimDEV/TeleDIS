import React from 'react';

export default function TelemetryChart({ data }) {
  const width = 780;
  const height = 230;
  const padding = 28;

  const allValues = data.flatMap((point) => [point.temperature, point.rpm, point.speed, point.fuel]);
  const maxValue = Math.max(...allValues) * 1.1;

  const linePoints = (key) =>
    data
      .map((point, index) => {
        const x = padding + (index * (width - padding * 2)) / (data.length - 1);
        const y = height - padding - (point[key] / maxValue) * (height - padding * 2);
        return `${x},${y}`;
      })
      .join(' ');

  return (
    <div className="panel-box chart-box">
      <div className="panel-header">
        <h3>Telemetria</h3>
        <span className="tag muted">Últimas 6 medições</span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="telemetry-chart" role="img" aria-label="Gráfico de telemetria">
        {[0, 1, 2, 3].map((step) => {
          const y = padding + ((height - padding * 2) / 3) * step;
          return <line key={step} x1={padding} x2={width - padding} y1={y} y2={y} className="chart-grid" />;
        })}

        <polyline points={linePoints('temperature')} className="series series-temperature" />
        <polyline points={linePoints('rpm')} className="series series-rpm" />
        <polyline points={linePoints('speed')} className="series series-speed" />
        <polyline points={linePoints('fuel')} className="series series-fuel" />

        {data.map((point, index) => {
          const x = padding + (index * (width - padding * 2)) / (data.length - 1);
          return (
            <g key={point.label}>
              <text x={x} y={height - 6} textAnchor="middle" className="chart-label">
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
