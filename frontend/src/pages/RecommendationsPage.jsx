import React from 'react';
import { Compass, ShieldCheck } from 'lucide-react';

import PageHeading from '../components/ui/PageHeading';
import { EmptyState } from '../components/ui/PageState';

export default function RecommendationsPage() {
  return (
    <div className="recommendations-screen">
      <PageHeading
        eyebrow="Apoio à decisão"
        title="Recomendações operacionais"
        description="Área preparada para recomendações verificáveis, vinculadas a dados e justificativas."
      />
      <section className="recommendation-intro">
        <div className="recommendation-intro-icon"><Compass size={23} /></div>
        <div>
          <span className="section-overline">Serviço de recomendações</span>
          <h2>Decisões com contexto operacional</h2>
          <p>Esta interface não gera recomendações automaticamente. Nenhum endpoint de recomendações está disponível na API atual.</p>
        </div>
        <span className="future-service-badge"><ShieldCheck size={15} />Sem recomendações simuladas</span>
      </section>
      <section className="recommendation-empty-workspace">
        <EmptyState
          title="Não há recomendações disponíveis"
          description="Novas recomendações aparecerão aqui quando houver um serviço de dados implementado e disponível."
          icon={Compass}
        />
        <div className="recommendation-data-contract">
          <span className="section-overline">Informações esperadas quando houver serviço</span>
          <div><span>Título e contexto</span><span>Prioridade</span><span>Origem dos dados</span><span>Ação e justificativa</span><span>Status</span></div>
        </div>
      </section>
    </div>
  );
}
