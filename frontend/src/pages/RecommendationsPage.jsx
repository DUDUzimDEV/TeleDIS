import React, { useMemo } from 'react';
import { Compass, Cpu, Database, RefreshCw } from 'lucide-react';

import RecommendationCard from '../components/dashboard/RecommendationCard';
import PageHeading from '../components/ui/PageHeading';
import { ErrorState, LoadingState } from '../components/ui/PageState';
import { useAuth } from '../context/AuthContext';
import useApiResource from '../hooks/useApiResource';

const asList = (value) => (Array.isArray(value) ? value : []);
const ACTIVE_OP_STATUSES = ['ATRIBUIDA', 'ACEITA', 'EM_EXECUCAO', 'INTERROMPIDA'];

export default function RecommendationsPage() {
  const { can } = useAuth();
  const operationsResource = useApiResource('/api/v1/operations', 0, { enabled: can('operations.view') });
  const machinesResource = useApiResource('/api/v1/machines', 0, { enabled: can('machines.view') });
  const roadProblemsResource = useApiResource('/api/v1/road-problems', 0, { enabled: can('road_problems.view') });
  const telemetryResource = useApiResource('/api/v1/telemetry', 0, { enabled: can('telemetry.view') });
  const roadsResource = useApiResource('/api/v1/roads', 0, { enabled: can('roads.view') });

  const operations = asList(operationsResource.data);
  const machines = asList(machinesResource.data);
  const roadProblems = asList(roadProblemsResource.data);
  const telemetry = asList(telemetryResource.data);
  const roads = asList(roadsResource.data);

  const deterministicRecommendations = useMemo(() => {
    const items = [];
    const machineNames = new Map(machines.map((m) => [String(m.id), m.nome || m.code || `Máquina ${m.id}`]));
    const roadNames = new Map(roads.map((r) => [String(r.id), r.nome || `Estrada ${r.id}`]));

    const activeOrPlannedOps = operations.filter((op) => [...ACTIVE_OP_STATUSES, 'PLANEJADA'].includes(op?.status));
    const activeOps = operations.filter((op) => ACTIVE_OP_STATUSES.includes(op?.status));

    // 1. Risco Viário em Operação
    const criticalRoadProblems = roadProblems.filter((problem) => (
      ['ABERTO', 'EM_ANALISE'].includes(problem?.status)
      && ['CRITICA', 'ALTA'].includes(problem?.gravidade)
      && ['VIA_BLOQUEADA', 'ALAGAMENTO', 'DESLIZAMENTO'].includes(problem?.tipo)
    ));
    if (criticalRoadProblems.length > 0 && activeOrPlannedOps.length > 0) {
      const topProblem = criticalRoadProblems[0];
      const roadLabel = topProblem.road_nome || roadNames.get(String(topProblem.road_id)) || `Estrada ${topProblem.road_id ?? '—'}`;
      items.push({
        id: 'rule-road-risk',
        priority: topProblem.gravidade === 'CRITICA' ? 'CRITICA' : 'ALTA',
        title: `Risco viário em operação (${criticalRoadProblems.length} ocorrência${criticalRoadProblems.length > 1 ? 's' : ''})`,
        reason: `${String(topProblem.tipo || '').replaceAll('_', ' ')} em ${roadLabel} com ${activeOrPlannedOps.length} operação(ões) ativa(s) ou planejada(s). Revise o roteamento antes do deslocamento.`,
        source: 'Problemas nas vias + Operações',
        actionTo: '/rotas',
        actionLabel: 'Revisar rotas',
      });
    }

    // 2. Abastecimento Preventivo (máquina em operação ativa com última leitura de combustível < 20%)
    const latestFuelByMachine = new Map();
    [...telemetry]
      .sort((a, b) => new Date(b?.timestamp || 0) - new Date(a?.timestamp || 0))
      .forEach((reading) => {
        if (/combustivel|fuel/i.test(String(reading?.metric || ''))) {
          const key = String(reading.maquina_id);
          if (!latestFuelByMachine.has(key)) latestFuelByMachine.set(key, reading);
        }
      });

    activeOps.forEach((op) => {
      if (op.machine_id == null) return;
      const fuelReading = latestFuelByMachine.get(String(op.machine_id));
      const fuelValue = Number(fuelReading?.valor);
      if (fuelReading && Number.isFinite(fuelValue) && fuelValue < 20) {
        const machineName = machineNames.get(String(op.machine_id)) || `Máquina ${op.machine_id}`;
        items.push({
          id: `rule-fuel-${op.id}`,
          priority: fuelValue < 15 ? 'CRITICA' : 'ALTA',
          title: `Abastecimento preventivo: ${machineName}`,
          reason: `Última leitura de combustível em ${fuelValue}${fuelReading.unidade || '%'} durante a operação "${op.name || op.code}". Programe reabastecimento.`,
          source: 'Telemetria MQTT + Operação ativa',
          actionTo: '/telemetria',
          actionLabel: 'Ver telemetria',
        });
      }
    });

    // 3. Frota Disponível para Despacho
    const busyMachineIds = new Set(activeOps.filter((op) => op.machine_id != null).map((op) => String(op.machine_id)));
    const freeActiveMachines = machines.filter((m) => m?.status === 'active' && !busyMachineIds.has(String(m.id)));
    const unassignedPlannedOps = operations.filter((op) => op?.status === 'PLANEJADA' && op.machine_id == null);

    if (unassignedPlannedOps.length > 0 && freeActiveMachines.length > 0) {
      items.push({
        id: 'rule-dispatch-fleet',
        priority: 'MEDIA',
        title: `Frota disponível para despacho (${freeActiveMachines.length} máquina${freeActiveMachines.length > 1 ? 's' : ''} livre${freeActiveMachines.length > 1 ? 's' : ''})`,
        reason: `Há ${unassignedPlannedOps.length} operação(ões) planejada(s) sem máquina atribuída enquanto existem máquinas ativas disponíveis.`,
        source: 'Frota + Operações planejadas',
        actionTo: '/operacoes',
        actionLabel: 'Atribuir operações',
      });
    }

    // 4. Operações Interrompidas
    const interruptedOps = operations.filter((op) => op?.status === 'INTERROMPIDA');
    interruptedOps.forEach((op) => {
      items.push({
        id: `rule-interrupted-${op.id}`,
        priority: 'ALTA',
        title: `Operação interrompida: ${op.name || op.code || `#${op.id}`}`,
        reason: `Aguardando retomada ou encerramento pela coordenação/operador${op.field_name ? ` (Talhão ${op.field_name})` : ''}.`,
        source: 'Ciclo operacional',
        actionTo: `/operacoes/${op.id}`,
        actionLabel: 'Abrir operação',
      });
    });

    // 5. Conformidade positiva se nenhuma regra disparar
    if (items.length === 0) {
      items.push({
        id: 'rule-ok',
        priority: 'CONFORMIDADE',
        title: 'Operação em conformidade',
        reason: 'Nenhuma restrição crítica de via, combustível abaixo de 20%, pendência de despacho ou operação interrompida foi detectada nos dados atuais.',
        source: 'Regras determinísticas da fazenda',
      });
    }

    return items;
  }, [machines, operations, roadProblems, roads, telemetry]);

  const calculatedRoutesCount = useMemo(
    () => operations.filter((op) => op?.route_plan_id != null || op?.estimated_distance_m != null).length,
    [operations],
  );

  const loadingAny = operationsResource.loading || machinesResource.loading || roadProblemsResource.loading || telemetryResource.loading;
  const partialErrors = [
    operationsResource.error ? { label: 'Operações', message: operationsResource.error, retry: operationsResource.reload } : null,
    machinesResource.error ? { label: 'Máquinas', message: machinesResource.error, retry: machinesResource.reload } : null,
    roadProblemsResource.error ? { label: 'Problemas nas vias', message: roadProblemsResource.error, retry: roadProblemsResource.reload } : null,
    telemetryResource.error ? { label: 'Telemetria', message: telemetryResource.error, retry: telemetryResource.reload } : null,
  ].filter(Boolean);

  function reloadAll() {
    operationsResource.reload();
    machinesResource.reload();
    roadProblemsResource.reload();
    telemetryResource.reload();
    roadsResource.reload();
  }

  return (
    <div className="recommendations-screen">
      <PageHeading
        eyebrow="Inteligência operacional"
        title="Recomendações operacionais"
        description="Regras determinísticas em tempo real sobre a fazenda ativa e pipeline estruturado para acoplamento do módulo externo de IA."
        actions={(
          <button type="button" className="toolbar-button outline" onClick={reloadAll} disabled={loadingAny}>
            <RefreshCw size={15} aria-hidden="true" />Recalcular regras
          </button>
        )}
      />

      {partialErrors.map((err) => (
        <ErrorState key={err.label} message={`${err.label}: ${err.message}`} onRetry={err.retry} />
      ))}

      <section className="recommendation-intro">
        <div className="recommendation-intro-icon"><Compass size={23} /></div>
        <div>
          <span className="section-overline">Motor de regras determinístico</span>
          <h2>Ações recomendadas com base nos dados reais</h2>
          <p>
            Avalia problemas viários críticos, nível de combustível em operação ativa, disponibilidade de frota e operações interrompidas sem gerar previsões simuladas.
          </p>
        </div>
      </section>

      {loadingAny && !operations.length && !telemetry.length && !roadProblems.length ? (
        <LoadingState label="Analisando dados operacionais da fazenda..." />
      ) : (
        <RecommendationCard
          title="Recomendações baseadas em regras"
          recommendations={deterministicRecommendations}
          loading={loadingAny}
        />
      )}

      <section className="ai-pipeline-panel" aria-label="Prontidão para o módulo de Inteligência Artificial">
        <header className="ai-pipeline-header">
          <div className="ai-pipeline-icon"><Cpu size={20} aria-hidden="true" /></div>
          <div>
            <span className="section-overline">Pipeline de dados · Conector IA</span>
            <h2>Prontidão para o Módulo de Inteligência Artificial</h2>
            <p>
              Esta base histórica estruturada (MQTT + PostGIS + ciclo operacional) alimentará o motor preditivo externo da equipe quando acoplado a esta camada — nenhuma predição de IA é simulada aqui.
            </p>
          </div>
        </header>
        <div className="ai-pipeline-metrics">
          <article>
            <Database size={16} aria-hidden="true" />
            <div>
              <small>Leituras de telemetria</small>
              <strong>{telemetry.length}</strong>
            </div>
          </article>
          <article>
            <Database size={16} aria-hidden="true" />
            <div>
              <small>Operações registradas</small>
              <strong>{operations.length}</strong>
            </div>
          </article>
          <article>
            <Database size={16} aria-hidden="true" />
            <div>
              <small>Problemas viários catalogados</small>
              <strong>{roadProblems.length}</strong>
            </div>
          </article>
          <article>
            <Database size={16} aria-hidden="true" />
            <div>
              <small>Rotas calculadas</small>
              <strong>{calculatedRoutesCount}</strong>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
