import React, { useEffect, useMemo, useState } from 'react';
import { Eraser, Minus, Pencil, Plus } from 'lucide-react';

import OperationalAreaMap from './OperationalAreaMap';
import { coordinatesFromPolygon, geometryFromPoints, validateOperationalArea } from '../../utils/operationalArea';

export default function OperationalAreaEditor({
  initialGeometry = null,
  initialRadius = 500,
  center = null,
  maxRadius = 10000,
  onChange,
}) {
  const [points, setPoints] = useState(() => coordinatesFromPolygon(initialGeometry));
  const [radius, setRadius] = useState(Number(initialRadius));
  const [editing, setEditing] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [removed, setRemoved] = useState(false);
  const originalPoints = useMemo(() => coordinatesFromPolygon(initialGeometry), [initialGeometry]);
  const existingGeometryIsEditable = !initialGeometry || originalPoints.length >= 3;
  const validation = validateOperationalArea(points);
  const completedGeometry = points.length >= 3 && validation.valid ? geometryFromPoints(points) : null;

  useEffect(() => {
    setPoints(coordinatesFromPolygon(initialGeometry));
    setRadius(Number(initialRadius));
    setEditing(false);
    setSelectedPoint(null);
    setRemoved(false);
  }, [initialGeometry, initialRadius]);

  function updatePoints(nextPoints) {
    setPoints(nextPoints);
    setSelectedPoint(null);
    const result = validateOperationalArea(nextPoints);
    onChange(
      nextPoints.length >= 3 && result.valid ? geometryFromPoints(nextPoints) : null,
      radius,
      { dirty: true, hasDraft: nextPoints.length > 0, valid: result.valid, message: result.message },
    );
  }

  function beginEditing() {
    if (
      initialGeometry
      && !existingGeometryIsEditable
      && !window.confirm('Este perímetro possui múltiplos polígonos ou anéis internos. O editor de vértices simples não consegue preservar essa estrutura; continuar e desenhar substituirá a geometria atual.')
    ) return;
    setPoints(coordinatesFromPolygon(initialGeometry));
    setEditing(true);
    setRemoved(false);
  }

  function cancelEditing() {
    setPoints(originalPoints);
    setRadius(Number(initialRadius));
    setEditing(false);
    setRemoved(false);
    setSelectedPoint(null);
    onChange(initialGeometry, Number(initialRadius), { dirty: false, hasDraft: false, valid: true, message: '' });
  }

  function changeRadius(value) {
    const nextRadius = value === '' ? '' : Number(value);
    setRadius(nextRadius);
    onChange(
      completedGeometry,
      nextRadius,
      {
        dirty: true,
        hasDraft: points.length > 0,
        valid: validation.valid && nextRadius !== '' && nextRadius >= 0 && nextRadius <= maxRadius,
        message: nextRadius === '' || nextRadius < 0 || nextRadius > maxRadius
          ? `O raio deve estar entre 0 e ${maxRadius} metros.`
          : validation.message,
      },
    );
  }

  function clearDrawing() {
    if (
      initialGeometry
      && !removed
      && points.length
      && !window.confirm('Limpar o desenho atual marca o perímetro para remoção ao salvar. Deseja continuar?')
    ) return;
    updatePoints([]);
  }

  function removePerimeter() {
    if (!window.confirm('Deseja remover o perímetro operacional? Nenhum recurso será apagado; a API bloqueará a remoção se houver recursos que dependam dele.')) return;
    setPoints([]);
    setEditing(false);
    setSelectedPoint(null);
    setRemoved(true);
    onChange(null, radius, { dirty: true, hasDraft: false, valid: true, message: '' });
  }

  function removeSelectedPoint() {
    if (selectedPoint == null || points.length <= 3) return;
    updatePoints(points.filter((_, index) => index !== selectedPoint));
  }

  function insertPoint(afterIndex, point) {
    const nextPoints = [...points];
    nextPoints.splice(afterIndex + 1, 0, point);
    updatePoints(nextPoints);
    setEditing(true);
  }

  const radiusValid = radius !== '' && Number.isFinite(Number(radius)) && radius >= 0 && radius <= maxRadius;
  const geometryToShow = editing || removed ? null : initialGeometry;
  const pointsToShow = editing ? points : [];

  return (
    <section className="farm-operational-area">
      <div className="farm-area-heading">
        <div>
          <h3>Perímetro operacional</h3>
          <p>Delimite a área usada nas validações operacionais. Não representa um limite legal da propriedade.</p>
        </div>
        <strong className={initialGeometry && !removed ? 'configured' : 'unconfigured'}>
          {initialGeometry && !removed ? 'Cadastrado' : 'Não cadastrado'}
        </strong>
      </div>
      {editing || (initialGeometry && !removed) ? (
        <>
          {editing && initialGeometry && !existingGeometryIsEditable ? (
            <p className="farm-area-error" role="alert">
              A geometria atual tem uma estrutura múltipla ou anéis internos. Se continuar, o novo desenho a substituirá; cancele para preservá-la.
            </p>
          ) : null}
          <OperationalAreaMap
            geometry={geometryToShow}
            proximityZone={null}
            center={center}
            draftPoints={pointsToShow}
            isEditing={editing}
            validity={editing && points.length >= 3 ? (validation.valid ? 'valid' : 'invalid') : null}
            selectedPointIndex={selectedPoint}
            onAddPoint={(point) => updatePoints([...points, point])}
            onMovePoint={(index, point) => updatePoints(points.map((value, i) => (i === index ? point : value)))}
            onSelectPoint={setSelectedPoint}
            onInsertPoint={insertPoint}
          />
          {editing && points.length > 0 ? (
            <p className={`operational-area-feedback ${validation.valid ? 'valid' : 'invalid'}`} role="status">
              {validation.message}
            </p>
          ) : null}
          <label className="farm-area-radius">Faixa de proximidade (m)
            <input type="number" min="0" max={maxRadius} step="10" value={radius} disabled={!editing} onChange={(event) => changeRadius(event.target.value)} />
          </label>
          <small className="farm-area-help">Talhões e estruturas devem ficar dentro do perímetro. Estradas podem alcançar a faixa de proximidade.</small>
          {editing ? (
            <div className="operational-area-actions">
              <button type="button" className="toolbar-button outline" onClick={clearDrawing}><Eraser size={15} />Limpar desenho</button>
              <button type="button" className="toolbar-button outline" onClick={removeSelectedPoint} disabled={selectedPoint == null || points.length <= 3} aria-label="Remover vértice selecionado"><Minus size={15} />Remover vértice</button>
              <button type="button" className="toolbar-button outline" onClick={cancelEditing}>Cancelar edição</button>
            </div>
          ) : (
            <div className="operational-area-actions">
              <button type="button" className="toolbar-button outline" onClick={beginEditing}><Pencil size={15} />Editar perímetro</button>
              {initialGeometry ? <button type="button" className="toolbar-button outline danger" onClick={removePerimeter}>Remover perímetro</button> : null}
            </div>
          )}
          {editing && points.length >= 3 && !validation.valid ? <small className="farm-area-error">{validation.message}</small> : null}
          {editing && points.length >= 3 && validation.valid && !radiusValid ? <small className="farm-area-error">Informe uma faixa entre 0 e {maxRadius} metros.</small> : null}
        </>
      ) : (
        <div className="farm-area-empty">
          {removed ? (
            <>
              <span>A remoção será aplicada ao salvar a fazenda.</span>
              <button type="button" className="toolbar-button outline" onClick={cancelEditing}>Cancelar remoção</button>
            </>
          ) : (
            <>
              <span>Área operacional não cadastrada.</span>
              <button type="button" className="toolbar-button outline" onClick={beginEditing}><Plus size={15} />Desenhar perímetro</button>
            </>
          )}
        </div>
      )}
      {editing && points.length === 0 ? (
        <p className="farm-area-help">Clique no mapa para adicionar três ou mais vértices. Use os pontos intermediários para inserir vértices em segmentos existentes.</p>
      ) : null}
      {editing && !completedGeometry && points.length > 0 ? <span className="farm-area-error">O perímetro incompleto não será enviado.</span> : null}
      {editing && !radiusValid ? <span className="farm-area-error">O raio informado está fora do intervalo permitido.</span> : null}
    </section>
  );
}
