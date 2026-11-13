import React from 'react';
import { ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import StatusBadge from '../ui/StatusBadge';

const priorityTone = {
  CRITICA: 'danger',
  ALTA: 'warning',
  MEDIA: 'info',
  BAIXA: 'neutral',
  CONFORMIDADE: 'success',
};

export default function RecommendationCard({
  recommendations = [],
  title = 'Recomendações',
  loading = false,
}) {
  const items = Array.isArray(recommendations) ? recommendations : [];

  return (
    <div className="panel-box recommendation-card-panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <span className={`recommendation-count-badge ${items.some((item) => item.priority === 'CRITICA' || item.priority === 'ALTA') ? 'is-priority' : ''}`}>
          {loading ? '...' : `${items.length} ${items.length === 1 ? 'ativa' : 'ativas'}`}
        </span>
      </div>

      <div className="recommendation-list">
        {items.map((item) => (
          <article key={item.id || item.title} className={`recommendation-item ${item.priority === 'CONFORMIDADE' ? 'is-ok' : ''}`}>
            <div className="recommendation-item-header">
              <h4>
                {item.priority === 'CONFORMIDADE' ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
                {item.title}
              </h4>
              {item.priority ? (
                <StatusBadge tone={priorityTone[item.priority] || 'neutral'}>
                  {item.priority}
                </StatusBadge>
              ) : null}
            </div>
            <p>{item.reason}</p>
            {(item.source || item.actionTo) ? (
              <div className="recommendation-item-footer">
                {item.source ? <small>Origem: {item.source}</small> : <span />}
                {item.actionTo ? (
                  <Link className="recommendation-action-link" to={item.actionTo}>
                    {item.actionLabel || 'Abrir'}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
