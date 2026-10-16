import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eraser, Minus, Save } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { apiFetch, readApiResponse } from '../api/apiClient';
import OperationalAreaMap from '../components/map/OperationalAreaMap';
import PageHeading from '../components/ui/PageHeading';
import { ErrorState, LoadingState } from '../components/ui/PageState';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { coordinatesFromPolygon, geometryFromPoints, validateOperationalArea } from '../utils/operationalArea';

export default function OperationalAreaPage() {
  const { farmId } = useParams();
  const { activeFarm, activeFarmId, can } = useAuth();
  const [areaUrl, setAreaUrl] = useState('');
  const areaResource = useApiResource(areaUrl, 0, { enabled: Boolean(areaUrl) });
  const [geometryDraft, setGeometryDraft] = useState(null);
  const [draftPoints, setDraftPoints] = useState([]);
  const [radiusDraft, setRadiusDraft] = useState(500);
  const [isEditing, setIsEditing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [success, setSuccess] = useState('');
  const [conflicts, setConflicts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const area = areaResource.data;
  const basePath = `/api/v1/farms/${farmId}/operational-area`;
  const canUpdate = can('farm.update');
  const maxRadius = Number(area?.max_proximity_radius_m ?? 10000);

  useEffect(() => {
    if (String(activeFarmId) !== String(farmId)) {
      setAreaUrl('');
      return;
    }
    setAreaUrl(basePath);
  }, [activeFarmId, basePath, farmId]);

  useEffect(() => {
    if (!area) return;
    setGeometryDraft(area.geometry || null);
    setDraftPoints(coordinatesFromPolygon(area.geometry));
    setRadiusDraft(Number(area.proximity_radius_m ?? 500));
    setIsEditing(false);
    setPreview(null);
    setPreviewError('');
    setConflicts([]);
    setSelectedPoint(null);
  }, [area]);

  const effectiveGeometry = useMemo(
    () => draftPoints.length >= 3 ? geometryFromPoints(draftPoints) : geometryDraft,
    [draftPoints, geometryDraft],
  );
  const effectiveGeometryKey = JSON.stringify(effectiveGeometry);
  const localValidation = validateOperationalArea(draftPoints);
  const previewIsCurrent = preview?.requestGeometry === effectiveGeometryKey
    && preview?.requestRadius === Number(radiusDraft);

  useEffect(() => {
    if (
      !isEditing || !canUpdate || !effectiveGeometry || draftPoints.length < 3
      || radiusDraft === '' || Number(radiusDraft) < 0 || Number(radiusDraft) > maxRadius
    ) {
      setPreview(null);
      setPreviewError('');
      setConflicts([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreview(null);
      setPreviewError('');
      try {
        const response = await apiFetch(`${basePath}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            geometry: effectiveGeometry,
            proximity_radius_m: Number(radiusDraft),
          }),
          signal: controller.signal,
        });
        const payload = await readApiResponse(response);
        if (controller.signal.aborted) return;
        setPreview({
          ...payload.data,
          requestGeometry: effectiveGeometryKey,
          requestRadius: Number(radiusDraft),
        });
        setConflicts(payload.data.conflicts || []);
      } catch (error) {
        if (error.name !== 'AbortError' && !controller.signal.aborted) {
          console.error('Falha ao validar a área operacional.', { endpoint: `${basePath}/preview`, error });
          setPreviewError(error.message || 'Não foi possível validar o desenho.');
        }
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [basePath, canUpdate, draftPoints.length, effectiveGeometry, effectiveGeometryKey, isEditing, maxRadius, radiusDraft]);

  function beginEdit() {
    setIsEditing(true);
    setRequestError('');
    setSuccess('');
    setConflicts([]);
    setSelectedPoint(null);
    setGeometryDraft(area?.geometry || null);
    setDraftPoints(coordinatesFromPolygon(area?.geometry));
  }

  function cancelEdit() {
    setGeometryDraft(area?.geometry || null);
    setDraftPoints(coordinatesFromPolygon(area?.geometry));
    setRadiusDraft(Number(area?.proximity_radius_m ?? 500));
    setIsEditing(false);
    setPreview(null);
    setPreviewError('');
    setRequestError('');
    setConflicts([]);
    setSelectedPoint(null);
  }

  function insertPoint(afterIndex, point) {
    const nextPoints = [...draftPoints];
    nextPoints.splice(afterIndex + 1, 0, point);
    setDraftPoints(nextPoints);
    setSelectedPoint(afterIndex + 1);
  }

  function removeSelectedPoint() {
    if (selectedPoint == null || draftPoints.length <= 3) return;
    const nextPoints = draftPoints.filter((_, index) => index !== selectedPoint);
    const validation = validateOperationalArea(nextPoints);
    if (!validation.valid) {
      setRequestError(validation.message);
      return;
    }
    setRequestError('');
    setDraftPoints(nextPoints);
    setSelectedPoint(null);
  }

  async function saveArea() {
    if (!effectiveGeometry || draftPoints.length < 3 || saving) return;
    setSaving(true);
    setRequestError('');
    setSuccess('');
    try {
      const response = await apiFetch(basePath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: effectiveGeometry,
          proximity_radius_m: Number(radiusDraft),
        }),
      });
      const payload = await readApiResponse(response);
      setGeometryDraft(payload.data.geometry);
      setDraftPoints(coordinatesFromPolygon(payload.data.geometry));
      setRadiusDraft(Number(payload.data.proximity_radius_m));
      setIsEditing(false);
      setPreview(null);
      setSuccess('Área operacional e zona de proximidade salvas.');
      areaResource.reload();
    } catch (error) {
      setConflicts(error.payload?.detail?.resources || []);
      console.error('Falha ao salvar a área operacional.', { endpoint: basePath, error });
      setRequestError(error.message || 'Não foi possível salvar a área operacional.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteArea() {
    if (!area?.configured || saving || !window.confirm(
      'Remover a área operacional? O sistema não apagará recursos. A remoção é bloqueada enquanto houver recursos espaciais cadastrados.',
    )) return;
    setSaving(true);
    setRequestError('');
    setSuccess('');
    try {
      const response = await apiFetch(basePath, { method: 'DELETE' });
      const payload = await readApiResponse(response);
      setGeometryDraft(null);
      setDraftPoints([]);
      setIsEditing(false);
      setSuccess('Área removida. Nenhum recurso foi excluído.');
      areaResource.reload();
    } catch (error) {
      setConflicts(error.payload?.detail?.resources || []);
      console.error('Falha ao remover a área operacional.', { endpoint: basePath, error });
      setRequestError(error.message || 'Não foi possível remover a área.');
    } finally {
      setSaving(false);
    }
  }

  const center = area?.center?.coordinates || null;
  const validity = previewError || (previewIsCurrent && preview && !preview.valid_for_existing_resources)
    ? 'invalid'
    : previewIsCurrent && preview?.valid_for_existing_resources
      ? 'valid'
      : isEditing && draftPoints.length >= 3
        ? 'pending'
        : null;
  const visibleGeometry = isEditing ? null : area?.geometry;
  const visibleZone = isEditing ? (previewIsCurrent ? preview?.proximity_zone : null) : area?.proximity_zone;

  return (
    <div className="operational-area-screen">
      <PageHeading
        eyebrow={activeFarm?.name || `Fazenda ${farmId}`}
        title="Área operacional"
        description="Defina o contexto geográfico usado para validar talhões, estruturas e estradas. Esta área é operacional, não representa um limite legal de propriedade."
        actions={<Link className="toolbar-button outline" to="/fazendas"><ArrowLeft size={16} />Voltar às fazendas</Link>}
      />

      {String(activeFarmId) !== String(farmId) ? (
        <ErrorState message="Selecione esta fazenda como ativa antes de consultar ou alterar sua área operacional." />
      ) : null}
      {areaResource.loading ? <LoadingState label="Carregando área operacional..." /> : null}
      {areaResource.error ? <ErrorState message={areaResource.error} onRetry={areaResource.reload} /> : null}
      {requestError ? <ErrorState message={requestError} /> : null}
      {previewError ? <ErrorState message={previewError} /> : null}
      {success ? <div className="field-success-banner" role="status">{success}</div> : null}

      {!areaResource.loading && !areaResource.error && !area?.configured ? (
        <div className="operational-area-notice" role="status">
          Área operacional não configurada. Nenhuma área foi presumida; desenhe o contorno utilizado pela operação.
        </div>
      ) : null}

      {conflicts.length ? (
        <section className="operational-area-conflicts" role="alert">
          <strong>A alteração não é compatível com todos os recursos existentes.</strong>
          <span>Amplie a área ou a zona de proximidade, ou revise os recursos listados. Nenhum recurso foi removido.</span>
          <ul>{conflicts.map((item) => (
            <li key={`${item.resource_type}-${item.id}`}>
              {item.resource_type} #{item.id}{item.name ? ` · ${item.name}` : ''}
            </li>
          ))}</ul>
        </section>
      ) : null}

      <section className="operational-area-workspace">
        <OperationalAreaMap
          geometry={visibleGeometry}
          proximityZone={visibleZone}
          center={center}
          draftPoints={isEditing ? draftPoints : []}
          isEditing={isEditing && canUpdate}
          validity={validity}
          selectedPointIndex={selectedPoint}
          onAddPoint={(point) => setDraftPoints((points) => [...points, point])}
          onMovePoint={(index, point) => setDraftPoints((points) => points.map((value, i) => i === index ? point : value))}
          onSelectPoint={setSelectedPoint}
          onInsertPoint={insertPoint}
        />
        <aside className="operational-area-controls">
          <div>
            <span className="section-overline">Desenho geográfico</span>
            <h2>{isEditing ? 'Editar contorno' : area?.configured ? 'Área salva' : 'Definir área'}</h2>
            <p>{isEditing
              ? area?.geometry && draftPoints.length === 0
                ? area.geometry.type === 'MultiPolygon'
                  ? 'A área atual possui múltiplos polígonos. Desenhar aqui irá substituí-la por um único polígono; cancele para preservar a geometria atual.'
                  : 'A área atual possui anéis internos ou um formato não editável diretamente. Desenhar aqui irá substituí-la por um novo polígono; cancele para preservar a geometria atual.'
                : 'Clique para adicionar vértices. Arraste os pontos para ajustar. Clique nos pontos intermediários para inserir vértices.'
              : 'A área e a faixa de proximidade são exibidas no mapa em camadas distintas.'}</p>
          </div>
          <label>Zona de proximidade (metros)
            <input
              type="number"
              min="0"
              max={maxRadius}
              step="10"
              value={radiusDraft}
              disabled={!canUpdate || (!isEditing && area?.configured)}
              onFocus={() => { if (!isEditing && canUpdate) beginEdit(); }}
              onChange={(event) => {
                setRadiusDraft(event.target.value === '' ? '' : Number(event.target.value));
                if (!isEditing) setIsEditing(true);
              }}
            />
          </label>
          <small>Valor permitido: 0 a {maxRadius.toLocaleString('pt-BR')} m. Estradas podem ficar dentro desta faixa; talhões e estruturas devem ficar dentro da área.</small>
          <div className="operational-area-legend">
            <span><i className="operational-area-swatch" />Área operacional</span>
            <span><i className="operational-zone-swatch" />Zona de proximidade</span>
            <span><i className="operational-draft-swatch" />Novo contorno</span>
          </div>
          {validity ? (
            <p className={`operational-area-feedback ${validity}`}>
              {validity === 'valid'
                ? <><CheckIcon /> Geometria compatível com os recursos atuais.</>
                : validity === 'invalid'
                  ? <>Área inválida ou recursos existentes fora do limite. Consulte os detalhes abaixo.</>
                  : 'Validando a geometria e os recursos com o backend...'}
            </p>
          ) : null}
          {previewIsCurrent && preview?.valid_for_existing_resources && isEditing ? (
            <p className="operational-area-feedback valid">
              Zona calculada pelo PostGIS: {Number(radiusDraft).toLocaleString('pt-BR')} m.
            </p>
          ) : null}
          {isEditing ? (
            <div className="operational-area-actions">
              <button type="button" className="toolbar-button outline" onClick={() => setDraftPoints([])} disabled={saving}>
                <Eraser size={16} />Limpar desenho
              </button>
              <button type="button" className="toolbar-button outline" onClick={removeSelectedPoint} disabled={saving || selectedPoint == null || draftPoints.length <= 3}>
                <Minus size={16} />Remover vértice
              </button>
              <button type="button" className="toolbar-button primary" onClick={saveArea} disabled={
                saving || draftPoints.length < 3 || !previewIsCurrent || !preview?.valid_for_existing_resources
                || !localValidation.valid || radiusDraft === '' || Number(radiusDraft) < 0 || Number(radiusDraft) > maxRadius
              }>
                <Save size={16} />{saving ? 'Salvando...' : 'Salvar área'}
              </button>
              <button type="button" className="toolbar-button outline" onClick={cancelEdit} disabled={saving}>Cancelar alteração</button>
            </div>
          ) : canUpdate ? (
            <div className="operational-area-actions">
              <button type="button" className="toolbar-button primary" onClick={beginEdit}>
                {area?.configured ? 'Editar área' : 'Desenhar área'}
              </button>
              {area?.configured ? (
                <button type="button" className="toolbar-button outline danger" onClick={deleteArea} disabled={saving}>Remover área</button>
              ) : null}
            </div>
          ) : <p className="operation-data-note">Seu perfil pode visualizar, mas não alterar a área operacional.</p>}
          {!center ? <p className="operation-data-note">Não há coordenada conhecida para centralizar o mapa. A visualização inicial mostra o Brasil sem presumir a localização da fazenda.</p> : null}
        </aside>
      </section>
    </div>
  );
}

function CheckIcon() {
  return <span aria-hidden="true">✓</span>;
}
