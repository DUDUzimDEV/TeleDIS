import React, { useMemo, useState } from 'react';
import { Building2, MapPin, Search } from 'lucide-react';

import EntityMap from '../components/map/EntityMap';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import useApiResource from '../hooks/useApiResource';

const asList = (value) => Array.isArray(value) ? value : [];
const typeLabels = {
  OFICINA: 'Oficina',
  GALPAO: 'Galpão',
  ABASTECIMENTO: 'Abastecimento',
  SEDE: 'Sede',
  ALMOXARIFADO: 'Almoxarifado',
  APOIO: 'Apoio',
  OUTRO: 'Outro',
};

export default function StructuresPage() {
  const resource = useApiResource('/api/v1/structures');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const structures = asList(resource.data);
  const types = [...new Set(structures.map((item) => item.tipo).filter(Boolean))];
  const visibleStructures = useMemo(() => structures.filter((item) => (
    (filter === 'all' || item.tipo === filter)
    && `${item.nome || ''} ${item.tipo || ''} ${item.descricao || ''}`.toLowerCase().includes(search.toLowerCase())
  )), [filter, search, structures]);
  const selected = structures.find((item) => item.id === selectedId) || visibleStructures[0] || null;

  return (
    <div className="infrastructure-screen">
      <PageHeading
        eyebrow="Infraestrutura da propriedade"
        title="Estruturas"
        description="Instalações e pontos de apoio georreferenciados."
      />
      {resource.error ? <ErrorState message={resource.error} onRetry={resource.reload} /> : null}
      <div className="infrastructure-filters">
        <label className="search-field">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar estrutura" aria-label="Buscar estrutura" />
        </label>
        <div className="filter-tabs" role="group" aria-label="Filtrar estruturas por tipo">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos <span>{structures.length}</span></button>
          {types.map((type) => (
            <button type="button" className={filter === type ? 'active' : ''} key={type} onClick={() => setFilter(type)}>
              {typeLabels[type] || type}
            </button>
          ))}
        </div>
      </div>

      <section className="infrastructure-workspace">
        <div className="infrastructure-map-panel">
          <header className="map-panel-toolbar">
            <div><MapPin size={17} /><strong>Infraestrutura mapeada</strong></div>
            <span>{resource.loading ? 'Carregando…' : `${visibleStructures.length} pontos`}</span>
          </header>
          {structures.length ? (
            <EntityMap
              structures={visibleStructures}
              visibleLayers={{ fields: false, roads: false, structures: true, problems: false, machines: false }}
              zoom={14}
            />
          ) : resource.loading ? <LoadingState label="Carregando estruturas..." /> : (
            <EmptyState title="Sem estruturas cadastradas" description="A API não retornou pontos de infraestrutura." icon={Building2} />
          )}
        </div>
        <aside className="infrastructure-list-panel">
          <div className="list-panel-heading"><strong>Instalações</strong><span>{visibleStructures.length}</span></div>
          {resource.loading ? <LoadingState label="Carregando lista..." /> : null}
          {!resource.loading && !resource.error && !visibleStructures.length ? (
            <EmptyState title={structures.length ? 'Nenhum resultado' : 'Lista vazia'} description={structures.length ? 'Altere o filtro ou a busca.' : 'Não há instalações retornadas pela API.'} icon={Building2} />
          ) : null}
          <div className="infrastructure-list">
            {visibleStructures.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`infrastructure-item ${selected?.id === item.id ? 'selected' : ''}`}
              >
                <span className={`structure-type-icon type-${String(item.tipo || '').toLowerCase()}`}><Building2 size={17} /></span>
                <span><strong>{item.nome}</strong><small>{typeLabels[item.tipo] || item.tipo || 'Tipo não informado'}</small></span>
              </button>
            ))}
          </div>
          {selected ? (
            <div className="structure-detail-sheet">
              <span className="section-overline">Ficha da instalação</span>
              <h2>{selected.nome}</h2>
              <dl>
                <div><dt>Tipo</dt><dd>{typeLabels[selected.tipo] || selected.tipo}</dd></div>
                <div><dt>Descrição</dt><dd>{selected.descricao || 'Não informada'}</dd></div>
                <div><dt>Coordenadas</dt><dd>{selected.geometry?.coordinates?.map((number) => Number(number).toFixed(5)).join(', ') || 'Não disponível'}</dd></div>
              </dl>
            </div>
          ) : null}
        </aside>
      </section>
    </div>
  );
}
