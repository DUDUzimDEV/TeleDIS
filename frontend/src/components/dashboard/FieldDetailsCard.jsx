import React from 'react';

export default function FieldDetailsCard({ details }) {
  return (
    <div className="panel-box">
      <div className="panel-header">
        <h3>Detalhes do talhão</h3>
        <span className="tag success">{details.status}</span>
      </div>

      <div className="field-summary">
        <h4>{details.name}</h4>
        <ul>
          <li>
            <span>Cultura</span>
            <strong>{details.crop}</strong>
          </li>
          <li>
            <span>Área</span>
            <strong>{details.area}</strong>
          </li>
          <li>
            <span>Status</span>
            <strong>{details.status}</strong>
          </li>
        </ul>
      </div>
    </div>
  );
}
