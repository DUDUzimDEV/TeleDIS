import React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Keep technical trace in console for debugging while rendering fallback UI
    console.error('TeleDis UI ErrorBoundary:', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = this.state.error?.message || 'Erro inesperado ao renderizar a interface.';

    return (
      <main className="app-error-boundary" role="alert">
        <section className="app-error-boundary-card">
          <div className="app-error-boundary-icon">
            <AlertTriangle size={24} aria-hidden="true" />
          </div>
          <h1>Algo interrompeu esta tela</h1>
          <p>
            Ocorreu um erro inesperado na interface do TeleDis. Recarregue a página para restabelecer o painel.
          </p>
          <details className="app-error-boundary-details">
            <summary>Detalhes técnicos</summary>
            <pre>{message}</pre>
          </details>
          <button type="button" className="app-error-boundary-reload" onClick={this.handleReload}>
            <RotateCw size={16} aria-hidden="true" />
            Recarregar
          </button>
        </section>
      </main>
    );
  }
}
