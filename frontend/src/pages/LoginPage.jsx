import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
    <div className="auth-shell auth-shell--landing">
      <div className="auth-card auth-card--login">
        <div className="auth-brand">
          <div className="brand-mark">T</div>
          <div>
            <div className="brand-name">TeleDis</div>
            <small>Operação agrícola</small>
          </div>
        </div>

        <div className="auth-header-block">
          <span className="eyebrow eyebrow-dark">Acesso ao sistema</span>
          <h1>Entre na plataforma.</h1>
          <p>Conecte-se para acompanhar fazendas, máquinas, operações e dados do campo.</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Usuário
            <input type="text" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="Digite seu usuário" required />
          </label>

          <label>
            Senha
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="Digite sua senha" required />
          </label>

          {error ? <div className="page-warning" role="alert">{error}</div> : null}

          <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Entrando...' : 'Entrar na plataforma'}
          </button>
        </form>

        <div className="auth-footer-links">
          <Link to="/" className="auth-link">Voltar para a landing</Link>
        </div>
      </div>

      <aside className="auth-side-panel">
        <div className="auth-side-card">
          <span className="eyebrow">Visão operacional</span>
          <h2>Conectado do campo à decisão.</h2>
          <ul>
            <li>Fazendas e máquinas</li>
            <li>Operações e rotas</li>
            <li>Telemetria e monitoramento</li>
            <li>Segurança por fazenda e perfil</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
