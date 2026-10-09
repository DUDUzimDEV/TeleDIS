import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';

export function getApiData(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

export default function useApiResource(endpoint, refreshKey = 0, { enabled = true } = {}) {
  const { activeFarmId } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestKey, setRequestKey] = useState(0);

  const reload = useCallback(() => setRequestKey((key) => key + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      if (!enabled) {
        setData(null);
        setError('');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      setData(null);

      try {
        const response = await apiFetch(endpoint, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}.`);
        }

        const payload = await response.json();
        setData(getApiData(payload));
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(`${endpoint}: ${requestError.message || 'não foi possível carregar os dados.'}`);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    load();
    return () => controller.abort();
  }, [endpoint, refreshKey, requestKey, activeFarmId, enabled]);

  return { data, loading, error, reload };
}
