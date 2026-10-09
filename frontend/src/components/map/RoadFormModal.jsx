import React from 'react';

export const roadTypeOptions = [
  { value: 'PRINCIPAL', label: 'Via principal' },
  { value: 'SECUNDARIA', label: 'Via secundária' },
  { value: 'ACESSO', label: 'Acesso' },
  { value: 'SERVICO', label: 'Via de serviço' },
  { value: 'OUTRA', label: 'Outra' },
];

export default function RoadFormModal({
  isOpen,
  roadTypes,
  roadType,
  lengthMeters,
  formData,
  error,
  isSaving,
  onClose,
  onTypeChange,
  onChange,
  onConfirm,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="field-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="road-modal-title">
      <div className="field-modal">
        <div className="field-modal-header">
          <div>
            <p className="modal-kicker">Nova via</p>
            <h3 id="road-modal-title">Configurar estrada</h3>
          </div>
          <button type="button" className="close-button" onClick={onClose} disabled={isSaving} aria-label="Fechar formulário">
            ×
          </button>
        </div>

        <div className="road-form-grid">
          <label>
            <span>Nome da via</span>
            <input
              type="text"
              value={formData.name}
              onChange={(event) => onChange('name', event.target.value)}
              maxLength={120}
              autoFocus
            />
          </label>

          <label>
            <span>Tipo</span>
            <select value={roadType} onChange={(event) => onTypeChange(event.target.value)}>
              {roadTypes.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="road-description-field">
            <span>Descrição <small>(opcional)</small></span>
            <textarea
              value={formData.description}
              onChange={(event) => onChange('description', event.target.value)}
              maxLength={1000}
              rows={3}
            />
          </label>

          <div className="road-length-box">
            <span>Comprimento aproximado</span>
            <strong>{lengthMeters.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m</strong>
            <small>O comprimento oficial será calculado pelo PostGIS.</small>
          </div>
        </div>

        {error ? <p className="field-form-error" role="alert">{error}</p> : null}

        <div className="field-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={isSaving}>
            Cancelar
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={isSaving}>
            {isSaving ? 'Salvando estrada...' : 'Cadastrar estrada'}
          </button>
        </div>
      </div>
    </div>
  );
}