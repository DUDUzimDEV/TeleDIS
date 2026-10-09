import React from 'react';
import { AlertTriangle, LoaderCircle, RotateCw } from 'lucide-react';

export function LoadingState({ label = 'Carregando dados...' }) {
  return (
    <div className="state-panel loading-state" role="status">
      <LoaderCircle size={18} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, icon: Icon }) {
  return (
    <div className="state-panel empty-state">
      {Icon ? <Icon size={22} aria-hidden="true" /> : null}
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="state-panel error-state" role="alert">
      <AlertTriangle size={19} aria-hidden="true" />
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="quiet-button" onClick={onRetry}>
          <RotateCw size={15} aria-hidden="true" />
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}
