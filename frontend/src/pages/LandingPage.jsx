import React from 'react';
import { Activity, BellRing, ClipboardList, MapPinned, Route, Sprout, Tractor, Warehouse } from 'lucide-react';
import { Link } from 'react-router-dom';

const problemItems = ['Máquinas', 'Operadores', 'Talhões', 'Estradas', 'Operações', 'Rotas', 'Dados'];

const solutionFlow = ['Fazenda', 'Estruturas', 'Máquinas', 'Operações', 'Rotas', 'Execução', 'Telemetria', 'Dados'];

const featureCards = [
  { title: 'Fazendas', description: 'Visão clara do contexto produtivo e operacional por unidade de negócio.', icon: Sprout },
  { title: 'Máquinas', description: 'Consulte o cadastro da frota, estados operacionais e as últimas posições recebidas.', icon: Tractor },
  { title: 'Talhões', description: 'Mapeamento e organização do território produtivo para decisões no campo.', icon: MapPinned },
  { title: 'Estruturas', description: 'Cadastro de estruturas, bases e pontos de apoio no ambiente agrícola.', icon: Warehouse },
  { title: 'Estradas', description: 'Planejamento e acompanhamento de acessos e deslocamentos logísticos.', icon: Route },
  { title: 'Operações', description: 'Coordenação de tarefas e execução em cada unidade de produção.', icon: ClipboardList },
  { title: 'Rotas', description: 'Definição de trajetos e sequências de deslocamento para a frota.', icon: MapPinned },
  { title: 'Telemetria', description: 'Consulte medições e posições enviadas pelas máquinas, com horário e origem do dado.', icon: Activity },
  { title: 'Eventos e ocorrências', description: 'Acompanhe leituras de telemetria e problemas viários registrados no sistema.', icon: BellRing },
];

const securityItems = [
  'Sessões autenticadas',
  'RBAC por perfil e permissões',
  'Contexto da fazenda ativa',
  'Ações condicionadas às permissões',
  'Auditoria disponível para perfis autorizados',
];

const technologyItems = ['React', 'Vite', 'FastAPI', 'PostgreSQL', 'PostGIS', 'MQTT', 'Docker'];

export default function LandingPage() {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-brand">
          <div className="brand-mark">T</div>
          <div>
            <div className="brand-name">TeleDis</div>
          </div>
        </div>

        <nav className="landing-nav" aria-label="Navegação principal">
          <a href="#problema">Problema</a>
          <a href="#solucao">Solução</a>
          <a href="#funcionalidades">Funcionalidades</a>
          <a href="#seguranca">Segurança</a>
          <a href="#tecnologia">Tecnologia</a>
        </nav>

        <Link to="/login" className="button button-primary button-small">
          Entrar
        </Link>
      </header>

      <main>
        <section className="hero-section">
          <div className="hero-copy reveal">
            <span className="eyebrow">Gestão e inteligência operacional agrícola</span>
            <h1>Inteligência operacional para o campo.</h1>
            <p>
              Conecte máquinas, operações, rotas e dados agrícolas em uma única plataforma.
            </p>
            <div className="hero-actions">
              <Link to="/login" className="button button-primary">
                Entrar na plataforma
              </Link>
              <a href="#funcionalidades" className="button button-secondary">
                Ver funcionalidades
              </a>
            </div>

            <div className="hero-capabilities" aria-label="Áreas conectadas pela plataforma">
              <div>
                <strong>Território</strong>
                <span>fazendas, talhões e estruturas</span>
              </div>
              <div>
                <strong>Operação</strong>
                <span>máquinas, equipes e rotas</span>
              </div>
              <div>
                <strong>Dados</strong>
                <span>telemetria e histórico</span>
              </div>
            </div>
          </div>

          <div className="hero-visual reveal">
            <div className="visual-panel">
              <div className="map-surface" role="img" aria-label="Ilustração conceitual de talhões, estrada, rota e máquina">
                <div className="map-grid" />
                <div className="map-line line-a" />
                <div className="map-line line-b" />
                <div className="map-pin pin-a" aria-hidden="true">T</div>
                <div className="map-pin pin-b" aria-hidden="true">M</div>
                <div className="map-pin pin-c" aria-hidden="true">E</div>
                <div className="map-card floating-card"><span>Prévia conceitual</span><strong>Mapa operacional</strong></div>
              </div>
              <p className="visual-disclaimer">Ilustração demonstrativa; não representa dados ou uma fazenda reais.</p>
            </div>
          </div>
        </section>

        <section className="info-section" id="problema">
          <div className="section-heading reveal">
            <span className="eyebrow">O problema</span>
            <h2>Operação agrícola fragmentada.</h2>
          </div>

          <div className="chips-grid reveal">
            {problemItems.map((item) => (
              <div key={item} className="chip-item" aria-label={item}><span>{item}</span></div>
            ))}
          </div>
        </section>

        <section className="info-section solution-section" id="solucao">
          <div className="section-heading reveal">
            <span className="eyebrow">A solução</span>
            <h2>Uma visão conectada do campo.</h2>
          </div>

          <div className="flow-steps reveal" aria-label="Fluxo da solução">
            {solutionFlow.map((step, index) => (
              <React.Fragment key={step}>
                <div className="flow-step">
                  <span>{step}</span>
                </div>
                {index < solutionFlow.length - 1 ? <div className="flow-arrow" aria-hidden="true">→</div> : null}
              </React.Fragment>
            ))}
          </div>
        </section>

        <section className="info-section" id="funcionalidades">
          <div className="section-heading reveal">
            <span className="eyebrow">Funcionalidades</span>
            <h2>Todo o ciclo operacional em um único lugar.</h2>
          </div>

          <div className="feature-grid reveal">
            {featureCards.map((feature) => (
              <article key={feature.title} className="feature-card">
                <div className="feature-icon" aria-hidden="true"><feature.icon size={20} strokeWidth={1.8} /></div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="info-section operational-map-section">
          <div className="section-heading reveal">
            <span className="eyebrow">Mapa operacional</span>
            <h2>Visão estratégica do território.</h2>
          </div>

          <div className="operational-map reveal">
            <div className="mini-map">
              <div className="map-grid mini" />
              <div className="map polygon-one" />
              <div className="map polygon-two" />
              <div className="map-line mini-line-a" />
              <div className="map-line mini-line-b" />
              <div className="map-pin mini-pin-a" aria-hidden="true">M</div>
              <div className="map-pin mini-pin-b" aria-hidden="true">R</div>
              <div className="map-pin mini-pin-c" aria-hidden="true">E</div>
              <div className="legend-row">
                <span><i className="legend-dot green" />Talhões</span>
                <span><i className="legend-dot amber" />Máquinas</span>
                <span><i className="legend-dot blue" />Rotas</span>
              </div>
            </div>
            <p className="visual-disclaimer">Composição ilustrativa para apresentar as camadas do mapa; os dados da plataforma dependem dos cadastros e das leituras recebidas.</p>
          </div>
        </section>

        <section className="info-section technology-section" id="tecnologia">
          <div className="section-heading reveal">
            <span className="eyebrow">Tecnologia</span>
            <h2>Uma base construída para operações conectadas.</h2>
            <p>Aplicação web, serviços de API, dados geográficos e mensageria trabalham juntos na plataforma.</p>
          </div>
          <ul className="technology-list reveal" aria-label="Tecnologias utilizadas">
            {technologyItems.map((technology) => <li key={technology}>{technology}</li>)}
          </ul>
        </section>

        <section className="info-section" id="seguranca">
          <div className="section-heading reveal">
            <span className="eyebrow">Segurança</span>
            <h2>Controle operacional com segurança de negócio.</h2>
          </div>

          <div className="security-grid reveal">
            {securityItems.map((item) => (
              <div key={item} className="security-item">
                <span className="security-check" aria-hidden="true">✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="cta-section reveal">
          <div>
            <span className="eyebrow">Pronto para operar com mais clareza?</span>
            <h2>Transforme o campo em uma operação conectada.</h2>
          </div>
          <Link to="/login" className="button button-primary">
            Entrar na plataforma
          </Link>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-brand">
          <div className="landing-brand">
            <div className="brand-mark">T</div>
            <div>
              <div className="brand-name">TeleDis</div>
              <div className="brand-subtitle">Operação agrícola</div>
            </div>
          </div>
          <p>Gestão operacional agrícola com dados, mapas e telemetria em um só lugar.</p>
        </div>
        <nav className="landing-footer-nav" aria-label="Links do rodapé">
          <strong>Explore</strong>
          <a href="#funcionalidades">Funcionalidades</a>
          <a href="#solucao">Como funciona</a>
          <a href="#tecnologia">Tecnologia</a>
          <Link to="/login">Entrar na plataforma</Link>
        </nav>
        <div className="landing-footer-meta">
          <strong>TeleDis</strong>
          <span>Plataforma de gestão e inteligência operacional agrícola.</span>
        </div>
      </footer>
    </div>
  );
}
