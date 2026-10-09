import React, { useMemo, useState } from 'react';
import { FileClock, Search } from 'lucide-react';

import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import useApiResource from '../hooks/useApiResource';
import { formatDateTime } from '../utils/geoData';

const actionLabels = {
  'auth.login': 'Login',
  'auth.logout': 'Logout',
  'farm.create': 'Fazenda criada',
  'farm.update': 'Fazenda alterada',
  'users.create': 'Usuário criado',
  'users.update': 'Usuário alterado',
  'users.permissions.update': 'Permissão alterada',
  'machines.create': 'Máquina criada',
  'machines.update': 'Máquina alterada',
  'fields.create': 'Talhão criado',
  'fields.update': 'Talhão alterado',
  'structures.create': 'Estrutura criada',
  'structures.update': 'Estrutura alterada',
  'roads.create': 'Estrada criada',
  'roads.update': 'Estrada alterada',
  'routes.create': 'Rota calculada',
  'routes.network.rebuild': 'Rede de rotas reconstruída',
  'road_problems.create': 'Problema viário registrado',
  'road_problems.status.update': 'Status de problema alterado',
};

export default function AuditPage() {
  const [search, setSearch] = useState('');
  const endpoint = '/api/v1/audit-logs?limit=500';
  const resource = useApiResource(endpoint);
  const logs = Array.isArray(resource.data) ? resource.data : [];
  const visibleLogs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return logs;
    return logs.filter((log) => [
      log.action,
      log.username,
      log.resource,
      log.resource_id,
      log.result,
      log.ip_address,
      JSON.stringify(log.details || {}),
    ].join(' ').toLowerCase().includes(query));
  }, [logs, search]);

  return (
    <div className="audit-screen">
      <PageHeading
        eyebrow="Rastreabilidade e conformidade"
        title="Logs de Auditoria"
        description="Atividades registradas pela API para a fazenda ativa. Os registros são apresentados como recebidos, sem inferir ações não auditadas."
      />
      {resource.error ? <ErrorState message={resource.error} onRetry={resource.reload} /> : null}
      <div className="audit-toolbar">
        <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ação, usuário, recurso ou IP" /></label>
        <span>{resource.loading ? '—' : `${visibleLogs.length} registro(s)`}</span>
      </div>
      {resource.loading ? <LoadingState label="Carregando trilha de auditoria..." /> : null}
      {!resource.loading && !resource.error && visibleLogs.length === 0 ? (
        <EmptyState
          title={logs.length ? 'Nenhum registro corresponde à busca' : 'Nenhum log disponível'}
          description="A API não retornou registros de auditoria para a fazenda ativa."
          icon={FileClock}
        />
      ) : null}
      {visibleLogs.length > 0 ? (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead><tr><th>Data e hora</th><th>Usuário</th><th>Ação</th><th>Recurso</th><th>ID</th><th>Resultado</th><th>IP</th><th>Detalhes</th></tr></thead>
            <tbody>{visibleLogs.map((log) => (
              <tr key={log.id}>
                <td>{formatDateTime(log.created_at)}</td>
                <td>{log.username || `Usuário ${log.user_id ?? 'desconhecido'}`}</td>
                <td><strong>{actionLabels[log.action] || log.action}</strong><small>{log.action}</small></td>
                <td>{log.resource || '—'}</td>
                <td>{log.resource_id ?? '—'}</td>
                <td>{log.result || '—'}</td>
                <td>{log.ip_address || '—'}</td>
                <td><details><summary>Ver</summary><pre>{JSON.stringify(log.details || {}, null, 2)}</pre></details></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
