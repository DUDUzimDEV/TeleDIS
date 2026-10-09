import React from 'react';

const cropOptions = ['Cana-de-açúcar', 'Soja', 'Milho', 'Algodão', 'Outro'];

export default function FieldFormModal({
  isOpen,
  areaHa,
  formData,
  error,
  isSaving = false,
  onClose,
  onChange,
  onConfirm,
}) {
  if (!isOpen) {
    return null;
  }

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

        {error ? <p className="field-form-error">{error}</p> : null}

        <div className="field-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={isSaving}>
            Cancelar
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={isSaving}>
            {isSaving ? 'Salvando...' : 'Confirmar Talhão'}
          </button>
        </div>
      </div>
    </div>
  );
}
