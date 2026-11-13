import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

const cropOptions = ['Cana-de-açúcar', 'Soja', 'Milho', 'Algodão', 'Outro'];

export default function FieldFormModal({
  isOpen,
  areaHa,
  formData,
  error,
  isSaving = false,
  farmId,
  onClose,
  onChange,
  onConfirm,
}) {
  if (!isOpen) {
    return null;
  }

  const errorMessage = typeof error === 'string' ? error : error?.message || '';
  const errorCode = typeof error === 'object' ? error?.code : '';
  const isAreaError = Boolean(
    ['OPERATIONAL_AREA_NOT_CONFIGURED', 'OUTSIDE_OPERATIONAL_AREA'].includes(errorCode)
    || /área operacional|fora da área|perímetro/i.test(errorMessage),
  );

  return (
    <div className="field-modal-backdrop" role="dialog" aria-modal="true">
      <div className="field-modal">
        <div className="field-modal-header">
          <div>
            <p className="modal-kicker">Novo Talhão</p>
            <h3>Configurar talhão</h3>
          </div>
          <button type="button" className="close-button" onClick={onClose} disabled={isSaving} aria-label="Fechar formulário">
            ×
          </button>
        </div>

        <div className="field-form-grid">
          <label>
            <span>Nome do Talhão</span>
            <input
              type="text"
              value={formData.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder="Talhão 01"
            />
          </label>

          <label>
            <span>Cultura</span>
            <select value={formData.crop} onChange={(event) => onChange('crop', event.target.value)}>
              {cropOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Safra</span>
            <input
              type="text"
              value={formData.season}
              onChange={(event) => onChange('season', event.target.value)}
              placeholder="2026/27"
            />
          </label>

          <div className="field-area-box">
            <span>Área</span>
            <strong>{areaHa.toFixed(2)} ha</strong>
            <small>{(areaHa * 10000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m²</small>
          </div>
        </div>

        {errorMessage ? (
          <div className="field-form-error-banner" role="alert">
            <div className="field-form-error-content">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
            {isAreaError && farmId ? (
              <Link
                to={`/fazendas/${farmId}/area-operacional`}
                className="button button-secondary button-small field-form-error-action"
                onClick={onClose}
              >
                Configurar área operacional
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="field-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={isSaving}>
            Voltar ao mapa para ajustar pontos
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={isSaving}>
            {isSaving ? 'Salvando...' : 'Confirmar Talhão'}
          </button>
        </div>
      </div>
    </div>
  );
}
