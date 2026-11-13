import React from 'react';
import StatusBadge from '../ui/StatusBadge';

export default function FieldDetailsCard({ details }) {
  return (
    <div className="panel-box field-details-bento">
      <div className="panel-header">
        <div>
          <span className="section-overline">Talhão</span>
          <h3>{details.name}</h3>
        </div>
        <StatusBadge tone="success">{details.status}</StatusBadge>
      </div>

      <div className="field-summary-bento">
        <div>
          <span>Cultura</span>
          <strong>{details.crop}</strong>
        </div>
        <div>
          <span>Área</span>
          <strong className="mono">{details.area}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{details.status}</strong>
        </div>
      </div>
    </div>
  );
}
