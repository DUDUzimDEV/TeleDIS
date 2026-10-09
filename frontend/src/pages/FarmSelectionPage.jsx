import React, { useState } from 'react';
import { ArrowRight, Building2, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import PageHeading from '../components/ui/PageHeading';
import { ErrorState, LoadingState } from '../components/ui/PageState';

export default function FarmSelectionPage() {
  const { farms, selectFarm, error, loading } = useAuth();
  const navigate = useNavigate();
  const [selectingId, setSelectingId] = useState(null);
  const [selectionError, setSelectionError] = useState('');

  async function handleSelect(farm) {
    setSelectingId(farm.id);
    setSelectionError('');
    try {
      await selectFarm(farm.id);
      navigate(farm.role === 'OPERATOR' ? '/operacao' : '/dashboard', { replace: true });
    } catch (selectError) {
      setSelectionError(selectError.message);
    } finally {
      setSelectingId(null);
    }
  }

  return (
    <main className="farm-selection-shell">
      <section className="farm-selection-panel">
        <PageHeading
          eyebrow="Contexto de trabalho"
          title="Selecione a fazenda"
          description="Os dados e as permissões serão carregados somente para a unidade selecionada."
        />
        {error || selectionError ? <ErrorState message={selectionError || error} /> : null}
        {loading ? <LoadingState label="Carregando contexto..." /> : null}
        <div className="farm-selection-list">
          {farms.map((farm) => (
            <button
              type="button"
              className="farm-selection-card"
              key={farm.id}
              onClick={() => handleSelect(farm)}
              disabled={loading || selectingId !== null}
            >
              <span className="farm-selection-icon"><Building2 size={22} /></span>
              <span className="farm-selection-copy">
                <strong>{farm.name}</strong>
                <small><MapPin size={14} />{[farm.municipality, farm.state].filter(Boolean).join(' - ') || 'Localização não informada'}</small>
                <small>{farm.role}</small>
              </span>
              <span className="farm-selection-action">{selectingId === farm.id ? 'Abrindo...' : <ArrowRight size={18} />}</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
