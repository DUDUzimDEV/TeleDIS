import React, { useMemo, useState } from 'react';
import { MapPin, Search, Tractor } from 'lucide-react';
import { Link } from 'react-router-dom';

import EntityMap from '../components/map/EntityMap';
import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime } from '../utils/geoData';

const asList = (value) => Array.isArray(value) ? value : [];

export default function MachinesPage() {
  const machinesResource = useApiResource('/api/v1/machines');
  const locationsResource = useApiResource('/api/v1/locations');
  const telemetryResource = useApiResource('/api/v1/telemetry');
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const machines = asList(machinesResource.data);
  const locations = asList(locationsResource.data);
  const readings = asList(telemetryResource.data);
  const selected = machines.find((machine) => machine.id === selectedId) || machines[0] || null;
  const latestLocation = selected
    ? [...locations].filter((location) => location.maquina_id === selected.id)
      .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0]
    : null;
  const latestReadings = selected
    ? readings.filter((reading) => reading.maquina_id === selected.id)
      .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
    : [];
  const types = [...new Set(machines.map((machine) => machine.tipo).filter(Boolean))];
  const statuses = [...new Set(machines.map((machine) => machine.status).filter(Boolean))];
  const filteredMachines = useMemo(() => machines.filter((machine) => (
    `${machine.nome || ''} ${machine.tipo || ''} ${machine.id}`.toLowerCase().includes(search.toLowerCase())
    && (statusFilter === 'all' || machine.status === statusFilter)
    && (typeFilter === 'all' || machine.tipo === typeFilter)
  )), [machines, search, statusFilter, typeFilter]);

  const activeCount = machines.filter((machine) => /ativo|active|operando/i.test(machine.status || '')).length;
  const maintenanceCount = machines.filter((machine) => /manuten/i.test(machine.status || '')).length;
  const stoppedCount = machines.length - activeCount - maintenanceCount;
  const machineMapData = locations.map((location) => ({
    ...location,
    nome: machines.find((machine) => machine.id === location.maquina_id)?.nome,
    status: machines.find((machine) => machine.id === location.maquina_id)?.status,
  }));

  return (
    <div className="fleet-screen">
      <PageHeading
        eyebrow="Gestão de ativos"
        title="Frota"
        description="Estado cadastral e últimas informações recebidas para cada máquina."
        actions={<span className="updated-label">Dados consultados nas APIs de frota e telemetria</span>}
      />

      <section className="fleet-summary" aria-label="Resumo da frota">
        <div><span>Total cadastrado</span><strong>{machinesResource.loading ? '—' : machines.length}</strong></div>
        <div><span>Ativas</span><strong className="text-success">{machinesResource.loading ? '—' : activeCount}</strong></div>
        <div><span>Em manutenção</span><strong className="text-warning">{machinesResource.loading ? '—' : maintenanceCount}</strong></div>
        <div><span>Outros status</span><strong>{machinesResource.loading ? '—' : stoppedCount}</strong></div>
      </section>

      {machinesResource.error ? <ErrorState message={machinesResource.error} onRetry={machinesResource.reload} /> : null}
      {locationsResource.error ? <ErrorState message={locationsResource.error} onRetry={locationsResource.reload} /> : null}
      {telemetryResource.error ? <ErrorState message={telemetryResource.error} onRetry={telemetryResource.reload} /> : null}

      <div className="fleet-toolbar">
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar máquina ou tipo" aria-label="Buscar máquina" />
        </label>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filtrar por tipo">
          <option value="all">Todos os tipos</option>
          {types.map((type) => <option value={type} key={type}>{type}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por status">
          <option value="all">Todos os status</option>
          {statuses.map((status) => <option value={status} key={status}>{status}</option>)}
        </select>
      </div>

      <section className="fleet-workspace">
        <div className="fleet-list-panel">
          <div className="list-panel-heading"><strong>Máquinas</strong><span>{filteredMachines.length}</span></div>
          {machinesResource.loading ? <LoadingState label="Carregando frota..." /> : null}
          {!machinesResource.loading && !machinesResource.error && !filteredMachines.length ? (
            <EmptyState title={machines.length ? 'Nenhuma máquina encontrada' : 'Frota sem registros'} description={machines.length ? 'Ajuste os filtros para ver outros itens.' : 'A API não retornou máquinas cadastradas.'} icon={Tractor} />
          ) : null}
          <div className="fleet-list">
            {filteredMachines.map((machine) => (
              <button
                type="button"
                key={machine.id}
                className={`fleet-list-item ${selected?.id === machine.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(machine.id)}
              >
                <span className="asset-icon"><Tractor size={17} /></span>
                <span className="asset-details">
                  <strong>{machine.nome || `Máquina ${machine.id}`}</strong>
                  <small>{machine.tipo || 'Tipo não informado'} · #{machine.id}</small>
                </span>
                <StatusBadge>{machine.status}</StatusBadge>
              </button>
            ))}
          </div>
        </div>

        <article className="machine-detail-panel">
          {selected ? (
            <>
              <header className="machine-detail-header">
                <div>
                  <span className="section-overline">Ficha de ativo · #{selected.id}</span>
                  <h2>{selected.nome || `Máquina ${selected.id}`}</h2>
                </div>
                <StatusBadge>{selected.status}</StatusBadge>
              </header>
              <div className="machine-detail-meta">
                <div><span>Tipo</span><strong>{selected.tipo || 'Não informado pela API'}</strong></div>
                <div><span>Último GPS</span><strong>{formatDateTime(latestLocation?.timestamp)}</strong></div>
                <div><span>Latitude</span><strong>{latestLocation?.latitude ?? '—'}</strong></div>
                <div><span>Longitude</span><strong>{latestLocation?.longitude ?? '—'}</strong></div>
              </div>

              <div className="machine-readings">
                <div className="section-heading compact-heading">
                  <div><span className="section-overline">Telemetria disponível</span><h3>Últimas medições</h3></div>
                </div>
                {telemetryResource.loading ? <LoadingState label="Consultando telemetria..." /> : null}
                {!telemetryResource.loading && !latestReadings.length ? (
                  <EmptyState title="Sem medições disponíveis" description="Não há leituras recentes associadas a esta máquina." />
                ) : null}
                {latestReadings.slice(0, 6).map((reading) => (
                  <div className="reading-row" key={reading.id}>
                    <span>{reading.metric}</span>
                    <strong>{reading.valor} {reading.unidade || ''}</strong>
                    <time>{formatDateTime(reading.timestamp)}</time>
                  </div>
                ))}
              </div>

              <div className="machine-location-block">
                <div className="section-heading compact-heading">
                  <div><span className="section-overline">Geolocalização</span><h3>Último ponto recebido</h3></div>
                  <Link to="/mapa" className="text-link"><MapPin size={15} />Ver mapa</Link>
                </div>
                {latestLocation ? (
                  <EntityMap
                    className="machine-mini-map"
                    machines={[{ ...latestLocation, nome: selected.nome, status: selected.status }]}
                    visibleLayers={{ fields: false, structures: false, roads: false, problems: false, machines: true }}
                    zoom={14}
                  />
                ) : (
                  <EmptyState title="Localização não disponível" description="A API não retornou um ponto de GPS para esta máquina." icon={MapPin} />
                )}
              </div>
            </>
          ) : (
            <EmptyState title="Selecione uma máquina" description="Os detalhes e dados disponíveis aparecerão aqui." icon={Tractor} />
          )}
        </article>
      </section>
    </div>
  );
}
