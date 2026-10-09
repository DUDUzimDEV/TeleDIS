import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">T</div>
          <div>
            <div className="brand-name">TeleDis</div>
            <small>Operação agrícola</small>
          </div>
        </div>

        <h1>Inteligência operacional para o campo.</h1>
        <p>Acesse a fazenda e a operação vinculadas ao seu perfil.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            E-mail ou usuário
            <input type="text" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
          </label>

          <label>
            Senha
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
          </label>

          {error ? <div className="page-warning">{error}</div> : null}

          <button className="toolbar-button primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
