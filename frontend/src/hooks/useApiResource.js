import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';

export function getApiData(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

export default function useApiResource(
  endpoint,
  refreshKey = 0,
  { enabled = true, pollingIntervalMs = 0 } = {},
) {
  const { activeFarmId } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [requestKey, setRequestKey] = useState(0);
  const dataRef = useRef(null);

  const reload = useCallback(() => setRequestKey((key) => key + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const resourceKey = `${activeFarmId || ''}:${endpoint}`;
    let pollingTimer;

    async function load() {
      if (!enabled) {
        dataRef.current = null;
        setData(null);
        setError('');
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const hasCurrentData = dataRef.current?.key === resourceKey;
      setLoading(!hasCurrentData);
      setRefreshing(hasCurrentData);
      setError('');

      try {
        const response = await apiFetch(endpoint, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}.`);
        }

        const payload = await response.json();
        const nextData = { key: resourceKey, value: getApiData(payload) };
        dataRef.current = nextData;
        setData(nextData);
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(`${endpoint}: ${requestError.message || 'não foi possível carregar os dados.'}`);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
          if (enabled && pollingIntervalMs > 0) {
            pollingTimer = window.setTimeout(load, pollingIntervalMs);
          }
        }
      }
    }

    load();
    return () => {
      controller.abort();
      window.clearTimeout(pollingTimer);
    };
  }, [endpoint, refreshKey, requestKey, activeFarmId, enabled, pollingIntervalMs]);

  const resourceKey = `${activeFarmId || ''}:${endpoint}`;
  return {
    data: enabled && data?.key === resourceKey ? data.value : null,
    loading,
    refreshing,
    error,
    reload,
  };
}
