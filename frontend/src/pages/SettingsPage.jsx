import React, { useState } from 'react';
import { Activity, Database, Gauge, Map, Radio, Shield, SlidersHorizontal } from 'lucide-react';
import { version } from '../../package.json';

import PageHeading from '../components/ui/PageHeading';
import { ErrorState, LoadingState } from '../components/ui/PageState';
import StatusBadge from '../components/ui/StatusBadge';
import useApiResource from '../hooks/useApiResource';

const sections = [
  { id: 'general', label: 'Geral', icon: SlidersHorizontal },
  { id: 'system', label: 'Sistema', icon: Gauge },
  { id: 'telemetry', label: 'Telemetria', icon: Activity },
  { id: 'mqtt', label: 'MQTT', icon: Radio },
  { id: 'maps', label: 'Mapas', icon: Map },
  { id: 'security', label: 'Segurança', icon: Shield },
  { id: 'diagnostics', label: 'Diagnóstico', icon: Database },
];

function ResponseValue({ resource, label }) {
  if (resource.loading) return <span className="settings-loading">Verificando...</span>;
  if (resource.error) return <span className="settings-unknown">Sem resposta</span>;
  return <span className="settings-reported">{resource.data?.[label] || 'Resposta recebida'}</span>;
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('general');
  const apiResource = useApiResource('/api/v1/health');
  const databaseResource = useApiResource('/api/v1/health/database');
  const mqttResource = useApiResource('/api/v1/health/mqtt');
  const activeLabel = sections.find((section) => section.id === activeSection)?.label;

  return (
    <div className="settings-screen">
      <PageHeading
        eyebrow="Administração do sistema"
        title="Configurações"
        description="Diagnóstico e informações do ambiente. Esta tela não altera parâmetros do servidor."
      />
      <div className="settings-console">
        <nav className="settings-nav" aria-label="Seções de configuração">
          <span className="settings-nav-label">Administração</span>
          {sections.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={activeSection === id ? 'active' : ''} onClick={() => setActiveSection(id)}>
              <Icon size={17} aria-hidden="true" />{label}
            </button>
          ))}
        </nav>
        <section className="settings-content">
          <header className="settings-section-heading">
            <div><span className="section-overline">TeleDis · {activeLabel}</span><h2>{activeLabel}</h2></div>
            <span className="settings-version">Frontend v{version}</span>
          </header>

          {activeSection === 'general' ? (
            <div className="settings-info-list">
              <div><span>Ambiente do frontend</span><strong>{import.meta.env.MODE}</strong><small>Modo de execução informado pelo Vite</small></div>
              <div><span>Idioma da interface</span><strong>Português (Brasil)</strong><small>Preferência visual do cliente</small></div>
              <div><span>Configuração persistente</span><strong>Não editável nesta interface</strong><small>Variáveis e segredos permanecem no ambiente do servidor</small></div>
            </div>
          ) : null}

          {activeSection === 'system' || activeSection === 'diagnostics' ? (
            <div className="diagnostic-list">
              {[
                { title: 'API TeleDis', icon: Activity, resource: apiResource, valueKey: 'service', statusKey: 'status' },
                { title: 'Banco de dados', icon: Database, resource: databaseResource, valueKey: 'database', statusKey: 'status' },
                { title: 'Broker MQTT', icon: Radio, resource: mqttResource, valueKey: 'mqtt', statusKey: 'status' },
              ].map(({ title, icon: Icon, resource, valueKey, statusKey }) => (
                <article className="diagnostic-row" key={title}>
                  <span className="diagnostic-icon"><Icon size={18} /></span>
                  <div><strong>{title}</strong><small>Resposta reportada pelo endpoint de diagnóstico</small></div>
                  {resource.error ? <StatusBadge tone="danger">Sem resposta</StatusBadge> : resource.loading ? <StatusBadge>Verificando</StatusBadge> : <StatusBadge tone="success">{resource.data?.[statusKey] || 'Resposta'}</StatusBadge>}
                  <span className="diagnostic-value"><ResponseValue resource={resource} label={valueKey} /></span>
                </article>
              ))}
              <p className="diagnostic-disclaimer">Os endpoints existentes reportam configuração/resposta do serviço; eles não executam testes de conectividade profunda do PostgreSQL ou do broker MQTT.</p>
            </div>
          ) : null}

          {activeSection === 'telemetry' ? (
            <section className="settings-placeholder">
              <Activity size={22} /><h3>Telemetria</h3>
              <p>As leituras são recebidas pelo serviço de telemetria. Parâmetros de publicação e limites não são expostos por uma API de configuração.</p>
            </section>
          ) : null}
          {activeSection === 'mqtt' ? (
            <section className="settings-placeholder">
              <Radio size={22} /><h3>Mensageria MQTT</h3>
              {mqttResource.error ? <ErrorState message={mqttResource.error} onRetry={mqttResource.reload} /> : mqttResource.loading ? <LoadingState label="Consultando diagnóstico MQTT..." /> : (
                <p>Resposta do endpoint: <strong>{mqttResource.data?.mqtt || 'Não informada'}</strong>. O endpoint não confirma uma conexão ativa com o broker.</p>
              )}
            </section>
          ) : null}
          {activeSection === 'maps' ? (
            <section className="settings-placeholder">
              <Map size={22} /><h3>Cartografia</h3>
              <p>O mapa utiliza Leaflet e OpenStreetMap. Dados geográficos vêm dos endpoints de talhões, estruturas, estradas, problemas e localizações.</p>
            </section>
          ) : null}
          {activeSection === 'security' ? (
            <section className="settings-placeholder">
              <Shield size={22} /><h3>Segurança da sessão</h3>
              <p>A autenticação existente usa JWT. Tokens são utilizados pelo cliente nas chamadas protegidas; políticas e expiração devem ser ajustadas no servidor.</p>
            </section>
          ) : null}

          {[apiResource, databaseResource, mqttResource].some((resource) => resource.error) ? (
            <div className="settings-errors">
              {apiResource.error ? <ErrorState message={apiResource.error} onRetry={apiResource.reload} /> : null}
              {databaseResource.error ? <ErrorState message={databaseResource.error} onRetry={databaseResource.reload} /> : null}
              {mqttResource.error ? <ErrorState message={mqttResource.error} onRetry={mqttResource.reload} /> : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
