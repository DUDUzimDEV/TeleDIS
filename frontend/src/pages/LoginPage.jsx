import React, { useState } from 'react';
import { Eye, EyeOff, Sprout } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';

import loginHero from '../assets/images/pexels-cmphotos-22737752.jpg';

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (!response.ok) {
        throw new Error('Credenciais inválidas. Verifique usuário e senha.');
      }

      const payload = await response.json();
      signIn(payload);
      if ((payload.farms || []).length > 1) {
        navigate('/selecionar-fazenda', { replace: true });
      } else {
        navigate(payload.user?.role === 'OPERATOR' ? '/operacao' : '/dashboard', { replace: true });
      }
    } catch (loginError) {
      setError(loginError.message || 'Não foi possível entrar no sistema.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="lg-shell">
      {/* ===== COLUNA ESQUERDA (VISUAL) ===== */}
      <aside className="lg-visual">
        <img
          src={loginHero}
          className="lg-visual-img object-cover w-full h-full"
          alt="Capa do Login"
        />

        <div className="lg-visual-overlay" aria-hidden="true" />

        <div className="lg-visual-text-box">
          <div className="lg-visual-brand">
            <span className="lg-visual-badge"><Sprout size={20} strokeWidth={2.2} aria-hidden="true" /></span>
            <h2>
              Conectando o <em>campo</em>,
              <br />
              impulsionando decisões
            </h2>
          </div>

          <p className="lg-visual-caption">
            Máquinas, operações, rotas e telemetria em uma única plataforma.
          </p>
        </div>
      </aside>

      {/* ===== COLUNA DIREITA (FORMULÁRIO) ===== */}
      <main className="lg-panel">
        <div className="lg-form-wrap">
          <Link to="/" className="lg-logo" aria-label="Voltar para a página inicial">
            <span className="lg-logo-mark">T</span>
            <span>TeleDis</span>
          </Link>

          <h1 className="lg-title">Entre no TeleDis</h1>
          <p className="lg-subtitle">
            Para acessar a plataforma, utilize seu usuário e senha cadastrados pela sua fazenda.
          </p>

          <form onSubmit={handleSubmit} className="lg-form" noValidate={false}>
            <div className="lg-field">
              <label htmlFor="login-username">Usuário <span className="lg-required">*</span></label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="Seu usuário"
                required
              />
            </div>

            <div className="lg-field">
              <label htmlFor="login-password">Senha <span className="lg-required">*</span></label>
              <div className="lg-password">
                <input
                  id="login-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Sua senha"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
            </div>

            {error ? <div className="lg-error" role="alert">{error}</div> : null}

            <button className="lg-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Entrando...' : 'Entrar'}
            </button>

            <p className="lg-help">
              Esqueceu a senha? <span>Fale com o administrador da fazenda.</span>
            </p>
          </form>
        </div>

        <footer className="lg-footer">
          <span>© {new Date().getFullYear()} TeleDis. Todos os direitos reservados.</span>
          <Link to="/">Voltar ao site</Link>
        </footer>
      </main>
    </div>
  );
}
