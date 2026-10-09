import React, { useState } from 'react';
import { Building2, MapPin, Plus, Sprout } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { apiFetch } from '../api/apiClient';
import OperationalAreaEditor from '../components/map/OperationalAreaEditor';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';

const emptyFarm = () => ({
  name: '',
  code: '',
  tax_identifier: '',
  municipality: '',
  state: '',
  area_ha: '',
});

const emptyAreaDraft = () => ({
  geometry: null,
  radius: 500,
  dirty: false,
  hasDraft: false,
  valid: true,
  message: '',
});

function responseError(payload, status) {
  const detail = payload?.detail;
  if (typeof detail === 'string') return detail;
  if (detail?.message) {
    const resources = Array.isArray(detail.resources) && detail.resources.length
      ? ` Recursos afetados: ${detail.resources.map((resource) => `${resource.resource_type} #${resource.id}`).join(', ')}.`
      : '';
    return `${detail.message}${resources}`;
  }
  if (Array.isArray(detail)) return detail.map((item) => item.msg).join(' ');
  return `A solicitação falhou (HTTP ${status}).`;
}

async function readResponse(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(responseError(payload, response.status));
  return payload;
}

export default function FarmsPage() {
  const resource = useApiResource('/api/v1/farms');
  const navigate = useNavigate();
  const { activeFarmId, can, farms: contextFarms, refreshFarms, selectFarm } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editFarmId, setEditFarmId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [editArea, setEditArea] = useState(null);
  const [editAreaDraft, setEditAreaDraft] = useState(emptyAreaDraft());
  const [draft, setDraft] = useState(emptyFarm);
  const [createAreaDraft, setCreateAreaDraft] = useState(emptyAreaDraft);
  const farms = Array.isArray(resource.data) ? resource.data : [];

  async function createFarm(event) {
    event.preventDefault();
    if (createAreaDraft.hasDraft && !createAreaDraft.valid) {
      setFormError(createAreaDraft.message || 'Corrija o perímetro antes de salvar a fazenda.');
      return;
    }
    setSaving(true);
    setFormError('');
    const body = {
      ...draft,
      area_ha: draft.area_ha ? Number(draft.area_ha) : null,
      ...(createAreaDraft.geometry ? {
        operational_area: {
          geometry: createAreaDraft.geometry,
          proximity_radius_m: Number(createAreaDraft.radius),
        },
      } : {}),
    };
    try {
      await readResponse(await apiFetch('/api/v1/farms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      setCreateOpen(false);
      setDraft(emptyFarm());
      setCreateAreaDraft(emptyAreaDraft());
      await refreshFarms();
      resource.reload();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivateFarm(farm) {
    setFormError('');
    try {
      if (String(farm.id) === String(activeFarmId)) {
        const otherFarm = contextFarms.find((item) => String(item.id) !== String(farm.id));
        if (!otherFarm) {
          setFormError('Selecione ou crie outra fazenda antes de desativar a última fazenda ativa da conta.');
          return;
        }
        await selectFarm(otherFarm.id);
        navigate(otherFarm.role === 'OPERATOR' ? '/operacao' : '/dashboard');
      }
      await readResponse(await apiFetch(`/api/v1/farms/${farm.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'inactive' }),
      }));
      await refreshFarms();
      resource.reload();
    } catch (error) {
      setFormError(error.message);
    }
  }

  async function openFarm(farm) {
    try {
      await selectFarm(farm.id);
      navigate(farm.role === 'OPERATOR' ? '/operacao' : '/dashboard');
    } catch (error) {
      setFormError(error.message);
    }
  }

  async function openEditFarm(farm) {
    setFormError('');
    setSaving(true);
    try {
      await selectFarm(farm.id);
      const areaPayload = await readResponse(await apiFetch(`/api/v1/farms/${farm.id}/operational-area`));
      setEditFarmId(farm.id);
      setEditDraft({
        name: farm.name,
        tax_identifier: farm.tax_identifier || '',
        municipality: farm.municipality || '',
        state: farm.state || '',
        area_ha: farm.area_ha ?? '',
      });
      setEditArea(areaPayload.data);
      setEditAreaDraft(emptyAreaDraft());
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateFarm(event) {
    event.preventDefault();
    if (editAreaDraft.hasDraft && !editAreaDraft.valid) {
      setFormError(editAreaDraft.message || 'Corrija o perímetro antes de salvar a fazenda.');
      return;
    }
    setSaving(true);
    setFormError('');
    const body = {
      ...editDraft,
      tax_identifier: editDraft.tax_identifier || null,
      municipality: editDraft.municipality || null,
      state: editDraft.state || null,
      area_ha: editDraft.area_ha ? Number(editDraft.area_ha) : null,
      ...(editAreaDraft.dirty ? {
        operational_area: editAreaDraft.geometry ? {
          geometry: editAreaDraft.geometry,
          proximity_radius_m: Number(editAreaDraft.radius),
        } : null,
      } : {}),
    };
    try {
      await readResponse(await apiFetch(`/api/v1/farms/${editFarmId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      setEditFarmId(null);
      setEditArea(null);
      setEditAreaDraft(emptyAreaDraft());
      await refreshFarms();
      resource.reload();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function openOperationalArea(farm) {
    try {
      await selectFarm(farm.id);
      navigate(`/fazendas/${farm.id}/area-operacional`);
    } catch (error) {
      setFormError(error.message);
    }
  }

  function cancelEdit() {
    setEditFarmId(null);
    setEditArea(null);
    setEditAreaDraft(emptyAreaDraft());
  }

  function toggleCreateForm() {
    if (createOpen) {
      setDraft(emptyFarm());
      setCreateAreaDraft(emptyAreaDraft());
      setFormError('');
      setCreateOpen(false);
      return;
    }
    setFormError('');
    setCreateAreaDraft(emptyAreaDraft());
    setCreateOpen(true);
  }

  return (
    <div className="farms-screen">
      <PageHeading
        eyebrow="Organizações e unidades operacionais"
        title="Fazendas"
        description="Acesso e contexto das fazendas vinculadas à sua conta."
        actions={can('farm.create') ? <button type="button" className="primary-button" onClick={toggleCreateForm}><Plus size={16} /> Nova fazenda</button> : null}
      />
      {resource.error ? <ErrorState message={resource.error} onRetry={resource.reload} /> : null}
      {formError ? <ErrorState message={formError} /> : null}
      {createOpen ? (
        <form className="farm-create-form" onSubmit={createFarm}>
          <h2>Cadastrar fazenda</h2>
          <label>Nome<input required minLength="2" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Código<input required minLength="2" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase().replace(/\s+/g, '-') })} /></label>
          <label>Identificação administrativa<input value={draft.tax_identifier} onChange={(event) => setDraft({ ...draft, tax_identifier: event.target.value })} /></label>
          <label>Município<input value={draft.municipality} onChange={(event) => setDraft({ ...draft, municipality: event.target.value })} /></label>
          <label>Estado (UF)<input maxLength="2" value={draft.state} onChange={(event) => setDraft({ ...draft, state: event.target.value.toUpperCase() })} /></label>
          <label>Área total (ha)<input type="number" min="0.01" step="0.01" value={draft.area_ha} onChange={(event) => setDraft({ ...draft, area_ha: event.target.value })} /></label>
          <div className="farm-form-wide">
            <OperationalAreaEditor
              key="new-farm-area"
              initialGeometry={null}
              initialRadius={500}
              onChange={(geometry, radius, status) => setCreateAreaDraft({ geometry, radius, ...status })}
            />
          </div>
          {formError ? <p role="alert">{formError}</p> : null}
          <button type="submit" className="primary-button" disabled={saving || (createAreaDraft.hasDraft && !createAreaDraft.valid)}>{saving ? 'Salvando...' : 'Criar fazenda'}</button>
          <button type="button" className="secondary-button" onClick={() => { setCreateOpen(false); setCreateAreaDraft(emptyAreaDraft()); }}>Cancelar</button>
        </form>
      ) : null}
      {resource.loading ? <LoadingState label="Carregando fazendas..." /> : null}
      {!resource.loading && !resource.error && farms.length === 0 ? <EmptyState title="Nenhuma fazenda vinculada" description="Peça a um proprietário que associe sua conta a uma fazenda." icon={Sprout} /> : null}
      <section className="farm-card-grid">
        {farms.map((farm) => (
          <article className={`farm-management-card ${String(farm.id) === String(activeFarmId) ? 'active' : ''}`} key={farm.id}>
            <header><span><Building2 size={19} /></span><StatusBadge tone={farm.status === 'active' ? 'success' : 'neutral'}>{farm.status === 'active' ? 'Ativa' : 'Inativa'}</StatusBadge></header>
            <h2>{farm.name}</h2>
            <p className="farm-card-location"><MapPin size={15} />{[farm.municipality, farm.state].filter(Boolean).join(' - ') || 'Localização não informada'}</p>
            <dl>
              <div><dt>Código</dt><dd>{farm.code}</dd></div>
              <div><dt>Perfil nesta fazenda</dt><dd>{farm.role}</dd></div>
              <div><dt>Área cadastrada</dt><dd>{farm.area_ha == null ? 'Não informada' : `${Number(farm.area_ha).toLocaleString('pt-BR')} ha`}</dd></div>
              <div><dt>Perímetro operacional</dt><dd>{farm.operational_area_configured ? 'Cadastrado' : 'Não cadastrado'}</dd></div>
              {farm.tax_identifier ? <div><dt>Identificação</dt><dd>{farm.tax_identifier}</dd></div> : null}
            </dl>
            {editFarmId === farm.id ? (
              <form className="farm-edit-form" onSubmit={updateFarm}>
                <label>Nome<input required value={editDraft.name || ''} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} /></label>
                <label>Identificação administrativa<input value={editDraft.tax_identifier || ''} onChange={(event) => setEditDraft({ ...editDraft, tax_identifier: event.target.value })} /></label>
                <label>Município<input value={editDraft.municipality || ''} onChange={(event) => setEditDraft({ ...editDraft, municipality: event.target.value })} /></label>
                <label>Estado (UF)<input maxLength="2" value={editDraft.state || ''} onChange={(event) => setEditDraft({ ...editDraft, state: event.target.value.toUpperCase() })} /></label>
                <label>Área (ha)<input type="number" min="0.01" step="0.01" value={editDraft.area_ha || ''} onChange={(event) => setEditDraft({ ...editDraft, area_ha: event.target.value })} /></label>
                {editArea ? (
                  <div className="farm-form-wide">
                    <OperationalAreaEditor
                      key={`farm-area-${farm.id}`}
                      initialGeometry={editArea.geometry}
                      initialRadius={editArea.proximity_radius_m}
                      maxRadius={editArea.max_proximity_radius_m}
                      onChange={(geometry, radius, status) => setEditAreaDraft({ geometry, radius, ...status })}
                    />
                  </div>
                ) : <LoadingState label="Carregando perímetro operacional..." />}
                <button type="submit" className="primary-button" disabled={saving || !editArea || (editAreaDraft.hasDraft && !editAreaDraft.valid)}>{saving ? 'Salvando...' : 'Salvar fazenda'}</button>
                <button type="button" className="secondary-button" onClick={cancelEdit} disabled={saving}>Cancelar</button>
              </form>
            ) : null}
            <footer>
              {String(farm.id) === String(activeFarmId) ? <strong className="active-farm-label">Fazenda ativa</strong> : <button type="button" className="secondary-button" onClick={() => openFarm(farm)}>Abrir fazenda</button>}
              {farm.permissions?.includes('farm.update') ? <button type="button" className="table-action" onClick={() => openOperationalArea(farm)}>Área operacional</button> : null}
              {farm.permissions?.includes('farm.update') ? <button type="button" className="table-action" disabled={saving} onClick={() => openEditFarm(farm)}>Editar fazenda</button> : null}
              {farm.permissions?.includes('farm.delete') && farm.status === 'active' ? <button type="button" className="table-action danger" onClick={() => deactivateFarm(farm)}>Desativar</button> : null}
            </footer>
          </article>
        ))}
      </section>
    </div>
  );
}
