import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Plus, Sprout } from 'lucide-react';
import { Link } from 'react-router-dom';

import heroImg from '../assets/images/pexels-skylake-16668323.jpg';
import innovationImgA from '../assets/images/pexels-abdelhak-elghali-129199099-16216968.jpg';
import innovationImgB from '../assets/images/pexels-florence-mathiot-417781-37078680.jpg';
import cardMachinesImg from '../assets/images/pexels-abpllc-6680155.jpg';
import cardMapImg from '../assets/images/pexels-masoodaslami-32047260.jpg';
import cardTelemetryImg from '../assets/images/pexels-masoodaslami-32047280.jpg';

const navLinks = [
  { href: '#inicio', label: 'Início' },
  { href: '#plataforma', label: 'Plataforma' },
  { href: '#modulos', label: 'Módulos' },
  { href: '#faq', label: 'Dúvidas' },
];

// Números derivados do próprio escopo do produto (sem métricas de clientes inventadas).
const stats = [
  { value: '100%', label: 'Web e responsivo', detail: 'Acesse do escritório ou da cabine, sem instalar nada.' },
  { value: '9', label: 'Módulos integrados', detail: 'Fazendas, talhões, estruturas, estradas, máquinas, operações, rotas, telemetria e eventos.' },
  { value: '24/7', label: 'Telemetria via MQTT', detail: 'Leituras das máquinas recebidas continuamente e guardadas com horário e origem.' },
];

const moduleCards = [
  {
    key: 'maquinas',
    image: cardMachinesImg,
    title: 'Frota e operações conectadas',
    description: 'Cadastre máquinas, atribua operações a operadores e acompanhe cada etapa — do aceite à conclusão.',
  },
  {
    key: 'mapa',
    image: cardMapImg,
    title: 'Território mapeado com precisão',
    description: 'Desenhe talhões, estradas e estruturas dentro da área operacional, com validação espacial PostGIS.',
  },
  {
    key: 'telemetria',
    image: cardTelemetryImg,
    title: 'Telemetria e eventos em tempo real',
    description: 'Posições e medições chegam por MQTT e viram histórico, alertas e relatórios por operação.',
  },
];

const faqItems = [
  {
    question: 'O que é o TeleDis?',
    answer: 'É uma plataforma web de gestão e inteligência operacional agrícola que reúne fazendas, máquinas, operações, rotas e telemetria em um só lugar.',
  },
  {
    question: 'Preciso instalar algum aplicativo?',
    answer: 'Não. O TeleDis roda no navegador e se adapta a computadores, tablets e celulares — incluindo o Modo Cabine para operadores.',
  },
  {
    question: 'Como os dados das máquinas chegam à plataforma?',
    answer: 'As máquinas publicam leituras via MQTT. O backend consome essas mensagens, valida e armazena o histórico associado à operação em andamento.',
  },
  {
    question: 'Quem pode ver e editar as informações?',
    answer: 'O acesso é controlado por perfil e por fazenda (RBAC). Cada usuário só enxerga e executa as ações permitidas para o seu papel.',
  },
];

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > 80);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="lp-page">
      {/* ===================== NAVBAR PRINCIPAL ===================== */}
      <header className="lp-nav">
        <Link to="/" className="lp-nav-logo">TELEDIS</Link>

        <nav
          className={`lp-center-nav lp-nav-links ${isScrolled ? 'opacity-0 invisible' : 'opacity-100 visible'}`}
          aria-label="Navegação principal"
        >
          {navLinks.map((link, index) => (
            <a key={link.href} href={link.href} className={index === 0 ? 'is-active' : undefined}>
              {link.label}
            </a>
          ))}
        </nav>

        <Link to="/login" className="lp-pill-cta">
          Entrar
          <span className="lp-pill-cta-icon"><ArrowUpRight size={14} strokeWidth={2.4} aria-hidden="true" /></span>
        </Link>
      </header>

      {/* ===================== PÍLULA FLUTUANTE CLONE ===================== */}
      <div
        className={`lp-floating-pill ${isScrolled ? 'active' : ''}`}
        aria-label="Navegação rápida"
      >
        {navLinks.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}

        <Link to="/login" className="primary-button lp-pill-cta">
          Entrar
          <span className="lp-pill-cta-icon"><ArrowUpRight size={14} strokeWidth={2.4} aria-hidden="true" /></span>
        </Link>
      </div>

      {/* ===================== HERO ===================== */}
      <section className="lp-hero" id="inicio">
        <img
          src={heroImg}
          alt="Inteligência operacional no campo"
          className="lp-hero-bg"
          loading="eager"
        />
        <div className="lp-hero-overlay" aria-hidden="true" />

        <div className="lp-hero-content">
          <span className="lp-hero-tag">Gestão operacional agrícola</span>
          <h1>
            Inteligência operacional
            <br />
            para o campo
          </h1>
          <p>
            Conectamos máquinas, operadores, talhões e rotas em uma única plataforma — para decidir com dados,
            não com suposições.
          </p>
          <Link to="/login" className="lp-pill-cta lp-pill-cta--lg">
            Acessar a plataforma
            <span className="lp-pill-cta-icon"><ArrowUpRight size={16} strokeWidth={2.4} aria-hidden="true" /></span>
          </Link>
        </div>
      </section>

      {/* ===================== INNOVATING (ESCURA) ===================== */}
      <section className="lp-innovate" id="plataforma">
        <div className="lp-container lp-innovate-grid">
          <div className="lp-innovate-left">
            <h2 className="lp-display">
              Inovando o futuro
              <br />
              da operação agrícola
            </h2>

            <div className="lp-innovate-photos">
              <img
                src={innovationImgA}
                alt="Operação no talhão agrícola"
                className="lp-photo lp-photo--tall"
                loading="lazy"
              />
              <img
                src={innovationImgB}
                alt="Manejo e cuidados na lavoura"
                className="lp-photo lp-photo--short"
                loading="lazy"
              />
            </div>
          </div>

          <div className="lp-innovate-right">
            <p className="lp-innovate-lead">
              O TeleDis combina mapas, telemetria e fluxo de operações para que a fazenda trabalhe de forma mais
              rápida, segura e rastreável — do planejamento à execução no talhão.
            </p>

            <ul className="lp-stats">
              {stats.map((stat) => (
                <li key={stat.label} className="lp-stat">
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                  <small>{stat.detail}</small>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ===================== WHERE TECHNOLOGY MEETS (CLARA) ===================== */}
      <section className="lp-modules" id="modulos">
        <div className="lp-container">
          <div className="lp-section-head">
            <h2 className="lp-display lp-display--dark">
              Onde a tecnologia encontra
              <br />
              as raízes do campo
            </h2>
            <p>
              Cada módulo resolve uma parte real da rotina agrícola e conversa com os demais, formando uma visão
              única da operação.
            </p>
          </div>

          <div className="lp-card-grid">
            {moduleCards.map((card) => (
              <article key={card.key} className="lp-card">
                <img
                  src={card.image}
                  alt={card.title}
                  className="lp-card-img"
                  loading="lazy"
                />
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== FAQ ===================== */}
      <section className="lp-faq" id="faq">
        <div className="lp-container lp-faq-grid">
          <div className="lp-faq-head">
            <h2 className="lp-display lp-display--dark">
              Tem dúvidas?
              <br />
              A gente responde.
            </h2>
            <p>Respostas rápidas sobre a plataforma, os dados e a segurança de acesso.</p>
          </div>

          <div className="lp-faq-list">
            {faqItems.map((item, index) => {
              const isOpen = openFaq === index;
              return (
                <div key={item.question} className={`lp-faq-item${isOpen ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="lp-faq-question"
                    aria-expanded={isOpen}
                    aria-controls={`lp-faq-answer-${index}`}
                    onClick={() => setOpenFaq(isOpen ? -1 : index)}
                  >
                    <span>{item.question}</span>
                    <span className="lp-faq-icon" aria-hidden="true"><Plus size={16} strokeWidth={2.4} /></span>
                  </button>
                  <div id={`lp-faq-answer-${index}`} className="lp-faq-answer" role="region" hidden={!isOpen}>
                    <p>{item.answer}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===================== FOOTER ===================== */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lg-visual-badge"><Sprout size={18} aria-hidden="true" /></span>
            <strong>TeleDis</strong>
          </div>
          <span>© {new Date().getFullYear()} TeleDis · Plataforma de gestão e inteligência operacional agrícola.</span>
          <Link to="/login" className="lp-footer-link">Entrar na plataforma</Link>
        </div>
      </footer>
    </div>
  );
}
