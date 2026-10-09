import React from 'react';
import { Activity, KeyRound, UserRound } from 'lucide-react';

import PageHeading from '../components/ui/PageHeading';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import useApiResource from '../hooks/useApiResource';

export default function OperatorsPage() {
  const resource = useApiResource('/api/v1/auth/me');
  const currentUser = resource.data?.user || null;

  return (
    <div className="operators-screen">
      <PageHeading
        eyebrow="Administração de acesso"
        title="Operadores"
        description="Identidade autenticada e informações de perfil fornecidas pelo serviço de autenticação."
      />
      {resource.error ? <ErrorState message={resource.error} onRetry={resource.reload} /> : null}
      {resource.loading ? <LoadingState label="Validando sessão e perfil..." /> : null}
      {currentUser ? (
        <section className="operator-profile-workspace">
          <article className="operator-profile-card">
            <div className="operator-profile-cover" />
            <div className="operator-profile-body">
              <div className="operator-avatar"><UserRound size={28} /></div>
              <div className="operator-identity">
                <span className="section-overline">Sessão atual</span>
                <h2>{currentUser.username || 'Usuário autenticado'}</h2>
                <StatusBadge tone="success">Autenticado</StatusBadge>
              </div>
              <dl className="operator-facts">
                <div><dt>Usuário</dt><dd>{currentUser.username || '—'}</dd></div>
                <div><dt>Perfil retornado</dt><dd>{currentUser.role || 'Não informado'}</dd></div>
                <div><dt>Permissões</dt><dd>{Array.isArray(currentUser.permissions) ? currentUser.permissions.join(', ') : 'Não expostas pela API'}</dd></div>
              </dl>
            </div>
          </article>
          <aside className="operator-admin-panel">
            <header><KeyRound size={18} /><div><span className="section-overline">Acesso e atividade</span><h3>Dados de administração</h3></div></header>
            <div className="operator-admin-row"><span>Estado da sessão</span><StatusBadge tone="success">Válida</StatusBadge></div>
            <div className="operator-admin-row"><span>Último acesso</span><strong>Não fornecido pela API</strong></div>
            <div className="operator-admin-row"><span>Lista de usuários</span><strong>Endpoint não disponível</strong></div>
            <div className="operator-admin-note"><Activity size={17} /><p>O serviço atual expõe somente o perfil da sessão autenticada. Outros operadores e histórico de atividade não são inventados nesta tela.</p></div>
          </aside>
        </section>
      ) : !resource.loading && !resource.error ? (
        <EmptyState title="Perfil indisponível" description="A API de autenticação não retornou um usuário para a sessão atual." icon={UserRound} />
      ) : null}
    </div>
  );
}
