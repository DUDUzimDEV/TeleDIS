import React, { useState } from 'react';
import { Map, MapPin, Plus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import EntityMap from '../components/map/EntityMap';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';

const asList = (value) => Array.isArray(value) ? value : [];

export default function FieldsPage() {
  const { activeFarmId, can } = useAuth();
  const fieldsResource = useApiResource('/api/v1/fields');
  const operationalAreaResource = useApiResource(
    activeFarmId && can('farm.view') ? `/api/v1/farms/${activeFarmId}/operational-area` : '',
    0,
  );
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState(() => Number(searchParams.get('fieldId')) || null);
  const fields = asList(fieldsResource.data);
  const selected = fields.find((field) => field.id === selectedId) || fields[0] || null;

  const isAreaConfigured = operationalAreaResource.data?.configured;

  return (
    <div className="territory-screen">
      <PageHeading
        eyebrow="Gestão territorial"
        title="Talhões"
        description="Áreas cadastradas na operação, exibidas a partir das geometrias oficiais."
        actions={
          can('fields.create') ? (
            <Link to="/mapa?mode=field" className="button button-primary button-small">
              <Plus size={16} /> Novo talhão
            </Link>
          ) : null
        }
      />

      {!operationalAreaResource.loading && !operationalAreaResource.error && operationalAreaResource.data && !isAreaConfigured ? (
        <div className="operational-area-warning-banner" role="alert">
          <div>
            <strong>Área operacional não configurada</strong>
            <p>O cadastro de talhões exige que a área operacional da fazenda esteja definida para validação espacial.</p>
          </div>
          {activeFarmId ? (
            <Link to={`/fazendas/${activeFarmId}/area-operacional`} className="button button-primary button-small">
              Configurar área operacional
            </Link>
          ) : null}
        </div>
      ) : null}

      {fieldsResource.error ? <ErrorState message={fieldsResource.error} onRetry={fieldsResource.reload} /> : null}
      <section className="territory-workspace">
        <aside className="territory-list-panel">
          <div className="list-panel-heading"><strong>Áreas cadastradas</strong><span>{fieldsResource.loading ? '…' : fields.length}</span></div>
          {fieldsResource.loading ? <LoadingState label="Carregando talhões..." /> : null}
          {!fieldsResource.loading && !fieldsResource.error && !fields.length ? (
            <div className="territory-empty-wrapper">
              <EmptyState title="Nenhum talhão cadastrado" description="Cadastre uma área pelo Mapa Operacional para exibi-la aqui." icon={Map} />
              {can('fields.create') ? (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
                  <Link to="/mapa?mode=field" className="button button-primary button-small">
                    <Plus size={16} /> Desenhar talhão no mapa
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="territory-list">
            {fields.map((field) => (
              <button
                type="button"
                key={field.id}
                className={`territory-list-item ${selected?.id === field.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(field.id)}
              >
                <span className="territory-index">{String(field.id).padStart(2, '0')}</span>
                <span><strong>{field.nome}</strong><small>{field.cultura || 'Cultura não informada'}</small></span>
                <strong className="area-value">{field.area_ha == null ? '—' : `${Number(field.area_ha).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha`}</strong>
              </button>
            ))}
          </div>
          {selected ? (
            <div className="territory-selected-details">
              <span className="section-overline">Área selecionada</span>
              <h2>{selected.nome}</h2>
              <dl>
                <div><dt>Cultura</dt><dd>{selected.cultura || '—'}</dd></div>
                <div><dt>Safra</dt><dd>{selected.safra || '—'}</dd></div>
                <div><dt>Área oficial</dt><dd>{selected.area_ha == null ? '—' : `${Number(selected.area_ha).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha`}</dd></div>
                <div><dt>Geometria</dt><dd>{selected.geometry?.type || 'Não disponível'}</dd></div>
              </dl>
            </div>
          ) : null}
        </aside>
        <div className="territory-map-panel">
          <header className="map-panel-toolbar">
            <div><MapPin size={17} /><strong>Mapa cadastral</strong></div>
            <span>Fonte: geometria dos talhões · PostGIS</span>
          </header>
          {fields.length ? (
            <EntityMap
              fields={fields}
              selectedFieldId={selected?.id}
              onSelectField={setSelectedId}
              visibleLayers={{ fields: true, roads: false, structures: false, problems: false, machines: false }}
              zoom={14}
            />
          ) : fieldsResource.loading ? <LoadingState label="Carregando mapa..." /> : (
            <EmptyState title="Mapa sem geometrias" description="Não há polígonos retornados pela API." icon={Map} />
          )}
        </div>
      </section>
    </div>
  );
}
