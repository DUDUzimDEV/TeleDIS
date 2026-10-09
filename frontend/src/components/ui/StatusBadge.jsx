import React from 'react';

const statusTone = (value = '') => {
  const normalized = String(value).toLowerCase();
  if (/ativo|ativa|online|operando|resolvido|normal/.test(normalized)) return 'success';
  if (/manuten|an.lise|aten|m.dia/.test(normalized)) return 'warning';
  if (/cr.tic|bloque|aberto|alta|falha|offline|parado/.test(normalized)) return 'danger';
  if (/inform|baixo|local/.test(normalized)) return 'info';
  return 'neutral';
};

export default function StatusBadge({ children, tone }) {
  const label = children || 'Indefinido';
  return <span className={`status-badge tone-${tone || statusTone(label)}`}>{label}</span>;
}
