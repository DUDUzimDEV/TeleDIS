import React from 'react';

export const roadProblemTypeOptions = [
  { value: 'BURACO', label: 'Buraco' },
  { value: 'LAMA', label: 'Lama' },
  { value: 'ALAGAMENTO', label: 'Alagamento' },
  { value: 'VIA_BLOQUEADA', label: 'Via bloqueada' },
  { value: 'PONTE_PROBLEMA', label: 'Problema em ponte' },
  { value: 'DESLIZAMENTO', label: 'Deslizamento' },
  { value: 'OUTRO', label: 'Outro' },
];

export const roadProblemSeverityOptions = [
  { value: 'BAIXA', label: 'Baixa' },
  { value: 'MEDIA', label: 'Média' },
  { value: 'ALTA', label: 'Alta' },
  { value: 'CRITICA', label: 'Crítica' },
];

export default function RoadProblemFormModal({
  isOpen,
  selectedRoad,
  selectedPoint,
  formData,
  error,
  isSaving,
  onClose,
  onChange,
  onConfirm,
}) {
  if (!isOpen || !selectedPoint) {
    return null;
  }

  return (
    <div className="field-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="road-problem-modal-title">
      <div className="field-modal">
        <div className="field-modal-header">
          <div>
            <p className="modal-kicker">Novo registro</p>
            <h3 id="road-problem-modal-title">Problema na via</h3>
          </div>
          <button type="button" className="close-button" onClick={onClose} disabled={isSaving} aria-label="Fechar formulário">
            ×
          </button>
        </div>

        <div className="road-problem-form-grid">
          <label>
            <span>Tipo</span>
            <select value={formData.type} onChange={(event) => onChange('type', event.target.value)}>
              {roadProblemTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Gravidade</span>
            <select value={formData.severity} onChange={(event) => onChange('severity', event.target.value)}>
              {roadProblemSeverityOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="road-problem-selected-road">
            <span>Estrada selecionada</span>
            <strong>{selectedRoad?.nome || 'Selecione uma estrada antes de marcar o ponto'}</strong>
          </div>

          <label className="road-problem-description-field">
            <span>Descrição <small>(opcional)</small></span>
            <textarea
              value={formData.description}
              onChange={(event) => onChange('description', event.target.value)}
              maxLength={1000}
              rows={3}
            />
          </label>

          <div className="road-problem-location" aria-label="Localização selecionada">
            <span>Latitude <strong>{selectedPoint.latitude.toFixed(6)}</strong></span>
            <span>Longitude <strong>{selectedPoint.longitude.toFixed(6)}</strong></span>
          </div>
          <p className="road-problem-snap-distance">
            Ponto encaixado na estrada{selectedPoint.snapDistanceMeters > 0.1
              ? ` (${selectedPoint.snapDistanceMeters.toFixed(1)} m do clique)`
              : ''}.
          </p>
          <p className="road-problem-default-status">Status inicial: <strong>Aberto</strong></p>
        </div>

        {error ? <p className="field-form-error" role="alert">{error}</p> : null}

        <div className="field-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={isSaving}>
            Cancelar
          </button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={isSaving || !selectedRoad}>
            {isSaving ? 'Salvando...' : 'Registrar problema'}
          </button>
        </div>
      </div>
    </div>
  );
}