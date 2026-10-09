import React, { useMemo, useState } from 'react';
import { AlertOctagon, MapPin, Plus, Search, TriangleAlert } from 'lucide-react';

import { apiFetch } from '../api/apiClient';
import EntityMap from '../components/map/EntityMap';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime, geoPointToLeaflet } from '../utils/geoData';

const asList = (value) => Array.isArray(value) ? value : [];
const severityRank = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 };

export default function RoadProblemsPage() {
  const resource = useApiResource('/api/v1/road-problems');
  const { can } = useAuth();
  const roadsResource = useApiResource('/api/v1/roads', 0, { enabled: can('road_problems.create') });
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    road_id: '',
    tipo: 'BURACO',
    gravidade: 'MEDIA',
    descricao: '',
    latitude: '',
    longitude: '',
  });
  const problems = asList(resource.data);
  const openCount = problems.filter((item) => item.status === 'ABERTO').length;
  const reviewCount = problems.filter((item) => item.status === 'EM_ANALISE').length;
  const criticalCount = problems.filter((item) => item.gravidade === 'CRITICA' && !['RESOLVIDO', 'INATIVO'].includes(item.status)).length;
  const resolvedCount = problems.filter((item) => item.status === 'RESOLVIDO').length;
  const visibleProblems = useMemo(() => problems
    .filter((item) => statusFilter === 'all' || item.status === statusFilter)
    .filter((item) => `${item.tipo || ''} ${item.road_nome || ''} ${item.descricao || ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((left, right) => (severityRank[left.gravidade] ?? 9) - (severityRank[right.gravidade] ?? 9)),
  [problems, search, statusFilter]);
  const selected = problems.find((item) => item.id === selectedId) || visibleProblems[0] || null;
  const selectedCoordinates = selected ? geoPointToLeaflet(selected.geometry) : null;
  const roads = Array.isArray(roadsResource.data) ? roadsResource.data : [];

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setCreateError('Este dispositivo não oferece suporte à geolocalização.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setDraft((current) => ({
          ...current,
          latitude: String(coords.latitude),
          longitude: String(coords.longitude),
        }));
        setCreateError('');
      },
      (error) => setCreateError(`Não foi possível obter sua localização: ${error.message}`),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function createProblem(event) {
    event.preventDefault();
    setSaving(true);
    setCreateError('');
    try {
      const response = await apiFetch('/api/v1/road-problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          road_id: Number(draft.road_id),
          tipo: draft.tipo,
          gravidade: draft.gravidade,
          descricao: draft.descricao || null,
          geometry: {
            type: 'Point',
            coordinates: [Number(draft.longitude), Number(draft.latitude)],
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      setCreateOpen(false);
      setDraft({ road_id: '', tipo: 'BURACO', gravidade: 'MEDIA', descricao: '', latitude: '', longitude: '' });
      resource.reload();
    } catch (error) {
      setCreateError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="incidents-screen">
      <PageHeading
        eyebrow="Gestão de incidentes"
        title="Problemas nas vias"
        description="Ocorrências viárias cadastradas e seus estados de tratamento."
        actions={can('road_problems.create') ? <button type="button" className="primary-button" onClick={() => setCreateOpen((open) => !open)}><Plus size={16} /> Registrar problema</button> : null}
      />
      {resource.error ? <ErrorState message={resource.error} onRetry={resource.reload} /> : null}
      {createOpen ? (
        <form className="road-problem-create-form" onSubmit={createProblem}>
          <h2>Registrar problema na via</h2>
          {roadsResource.error ? <ErrorState message={roadsResource.error} onRetry={roadsResource.reload} /> : null}
          <label>Estrada<select required value={draft.road_id} onChange={(event) => setDraft({ ...draft, road_id: event.target.value })}><option value="">Selecione a estrada</option>{roads.map((road) => <option key={road.id} value={road.id}>{road.nome || `Estrada ${road.id}`}</option>)}</select></label>
          <label>Tipo<select value={draft.tipo} onChange={(event) => setDraft({ ...draft, tipo: event.target.value })}>{['BURACO', 'LAMA', 'ALAGAMENTO', 'VIA_BLOQUEADA', 'PONTE_PROBLEMA', 'DESLIZAMENTO', 'OUTRO'].map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label>
          <label>Gravidade<select value={draft.gravidade} onChange={(event) => setDraft({ ...draft, gravidade: event.target.value })}>{['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'].map((severity) => <option key={severity} value={severity}>{severity}</option>)}</select></label>
          <label className="road-problem-description">Descrição<textarea maxLength="1000" rows="2" value={draft.descricao} onChange={(event) => setDraft({ ...draft, descricao: event.target.value })} /></label>
          <div className="road-problem-location-inputs">
            <label>Latitude<input required type="number" step="any" min="-90" max="90" value={draft.latitude} onChange={(event) => setDraft({ ...draft, latitude: event.target.value })} /></label>
            <label>Longitude<input required type="number" step="any" min="-180" max="180" value={draft.longitude} onChange={(event) => setDraft({ ...draft, longitude: event.target.value })} /></label>
            <button type="button" className="secondary-button" onClick={useCurrentLocation}>Usar minha localização</button>
          </div>
          {createError ? <p className="road-problem-form-error" role="alert">{createError}</p> : null}
          <button type="submit" className="primary-button" disabled={saving || roads.length === 0}>{saving ? 'Enviando...' : 'Enviar ocorrência'}</button>
          <button type="button" className="secondary-button" onClick={() => setCreateOpen(false)}>Cancelar</button>
        </form>
      ) : null}
      <section className="incident-counters">
        <div className="incident-counter counter-open"><span>Abertos</span><strong>{resource.loading ? '—' : openCount}</strong></div>
        <div className="incident-counter counter-review"><span>Em análise</span><strong>{resource.loading ? '—' : reviewCount}</strong></div>
        <div className="incident-counter counter-critical"><span>Críticos ativos</span><strong>{resource.loading ? '—' : criticalCount}</strong></div>
        <div className="incident-counter counter-resolved"><span>Resolvidos</span><strong>{resource.loading ? '—' : resolvedCount}</strong></div>
      </section>
      <section className="incident-workspace">
        <div className="incident-table-panel">
          <div className="incident-toolbar">
            <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tipo, estrada ou descrição" aria-label="Buscar problema viário" /></label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por status">
              <option value="all">Todos os status</option>
              {['ABERTO', 'EM_ANALISE', 'RESOLVIDO', 'INATIVO'].map((status) => <option value={status} key={status}>{status.replace('_', ' ')}</option>)}
            </select>
          </div>
          {resource.loading ? <LoadingState label="Carregando ocorrências..." /> : null}
          {!resource.loading && !resource.error && !visibleProblems.length ? (
            <EmptyState title={problems.length ? 'Nenhuma ocorrência no filtro' : 'Sem ocorrências registradas'} description="A lista contém somente registros retornados pela API de problemas viários." icon={AlertOctagon} />
          ) : null}
          {visibleProblems.length ? (
            <div className="incident-table-scroll">
              <table className="incident-table">
                <thead><tr><th>Tipo</th><th>Estrada</th><th>Gravidade</th><th>Status</th><th>Data</th></tr></thead>
                <tbody>
                  {visibleProblems.map((problem) => (
                    <tr key={problem.id} className={selected?.id === problem.id ? 'selected-row' : ''} onClick={() => setSelectedId(problem.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setSelectedId(problem.id); }}>
                      <td><strong>{problem.tipo}</strong><small>{problem.descricao || 'Sem descrição'}</small></td>
                      <td>{problem.road_nome || `Estrada ${problem.road_id}`}</td>
                      <td><StatusBadge tone={problem.gravidade === 'CRITICA' || problem.gravidade === 'ALTA' ? 'danger' : problem.gravidade === 'MEDIA' ? 'warning' : 'neutral'}>{problem.gravidade}</StatusBadge></td>
                      <td><StatusBadge>{problem.status}</StatusBadge></td>
                      <td>{formatDateTime(problem.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        <aside className="incident-detail-panel">
          {selected ? (
            <>
              <header className="incident-detail-heading">
                <span className="incident-detail-icon"><TriangleAlert size={18} /></span>
                <div><span className="section-overline">Ocorrência #{selected.id}</span><h2>{selected.tipo}</h2></div>
              </header>
              <div className="incident-status-row"><StatusBadge tone={selected.gravidade === 'CRITICA' || selected.gravidade === 'ALTA' ? 'danger' : 'warning'}>{selected.gravidade}</StatusBadge><StatusBadge>{selected.status}</StatusBadge></div>
              <dl className="incident-details">
                <div><dt>Estrada</dt><dd>{selected.road_nome || `ID ${selected.road_id}`}</dd></div>
                <div><dt>Registrado</dt><dd>{formatDateTime(selected.created_at)}</dd></div>
                <div><dt>Descrição</dt><dd>{selected.descricao || 'Não informada'}</dd></div>
                <div><dt>Impacto na rota</dt><dd>Consulte o planejador; não há campo de impacto individual neste registro.</dd></div>
              </dl>
              {selectedCoordinates ? (
                <EntityMap
                  className="incident-mini-map"
                  roadProblems={[selected]}
                  visibleLayers={{ fields: false, roads: false, structures: false, problems: true, machines: false }}
                  zoom={15}
                />
              ) : <EmptyState title="Localização indisponível" description="O registro não contém um ponto geográfico válido." icon={MapPin} />}
            </>
          ) : resource.loading ? <LoadingState label="Carregando detalhe..." /> : (
            <EmptyState title="Selecione uma ocorrência" description="Os detalhes geográficos e operacionais serão exibidos aqui." icon={MapPin} />
          )}
        </aside>
      </section>
    </div>
  );
}
