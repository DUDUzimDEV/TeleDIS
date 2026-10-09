import React from 'react';

export const structureTypeOptions = [
  { value: 'OFICINA', label: 'Oficina' },
  { value: 'GALPAO', label: 'Galpão' },
  { value: 'ABASTECIMENTO', label: 'Abastecimento' },
  { value: 'SEDE', label: 'Sede' },
  { value: 'ALMOXARIFADO', label: 'Almoxarifado' },
  { value: 'APOIO', label: 'Ponto de apoio' },
  { value: 'OUTRO', label: 'Outro' },
];

export default function StructureFormModal({
  isOpen,
  structureTypes,
  structureType,
  selectedPoint,
  formData,
  error,
  isSaving,
  onClose,
  onTypeChange,
  onChange,
  onConfirm,
}) {
  if (!isOpen || !selectedPoint) {
    return null;
  }

  return (
    <div className="field-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="structure-modal-title">
      <div className="field-modal">
        <div className="field-modal-header">
          <div>
            <p className="modal-kicker">Nova estrutura</p>
            <h3 id="structure-modal-title">Confirmar localização</h3>
          </div>
          <button type="button" className="close-button" onClick={onClose} disabled={isSaving} aria-label="Fechar formulário">
            ×
          </button>
        </div>

        <div className="structure-form-grid">
          <label>
            <span>Nome da estrutura</span>
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
            <select value={structureType} onChange={(event) => onTypeChange(event.target.value)}>
              {structureTypes.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="structure-description-field">
            <span>Descrição <small>(opcional)</small></span>
            <textarea
              value={formData.description}
              onChange={(event) => onChange('description', event.target.value)}
              maxLength={1000}
              rows={3}
            />
          </label>

          <div className="structure-location" aria-label="Localização selecionada">
            <span>Latitude <strong>{selectedPoint.latitude.toFixed(6)}</strong></span>
            <span>Longitude <strong>{selectedPoint.longitude.toFixed(6)}</strong></span>
          </div>
        </div>

        {error ? <p className="field-form-error" role="alert">{error}</p> : null}

        <div className="field-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={isSaving}>
            Cancelar
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={isSaving}>
            {isSaving ? 'Salvando...' : 'Cadastrar estrutura'}
          </button>
        </div>
      </div>
    </div>
  );
}