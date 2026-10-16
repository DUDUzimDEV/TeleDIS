import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { apiFetch, onUnauthorized } from '../api/apiClient';
import { clearStoredSession } from './authStorage';

const AuthContext = createContext(null);

function readUser() {
  try {
    return JSON.parse(localStorage.getItem('teledis_user') || 'null');
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('teledis_token'));
  const [user, setUser] = useState(readUser);
  const [farms, setFarms] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('teledis_farms') || '[]');
    } catch {
      return [];
    }
  });
  const [activeFarmId, setActiveFarmId] = useState(() => localStorage.getItem('teledis_farm_id'));
  const [permissions, setPermissions] = useState(() => {
    const selectedId = localStorage.getItem('teledis_farm_id');
    return farmsForStoredFarm(selectedId);
  });
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');

  const invalidateSession = useCallback(() => {
    clearStoredSession();
    setToken(null);
    setUser(null);
    setFarms([]);
    setActiveFarmId(null);
    setPermissions([]);
    setError('');
  }, []);

  useEffect(() => onUnauthorized(invalidateSession), [invalidateSession]);

  function farmsForStoredFarm(id) {
    try {
      const stored = JSON.parse(localStorage.getItem('teledis_farms') || '[]');
      return stored.find((farm) => String(farm.id) === String(id))?.permissions || [];
    } catch {
      return [];
    }
  }

  const finishFarmContext = useCallback(async (farmId) => {
    const response = await apiFetch('/api/v1/auth/me', { farmId });
    if (!response.ok) {
      const contextError = new Error(
        `Não foi possível validar o contexto da fazenda (HTTP ${response.status}).`,
      );
      contextError.status = response.status;
      throw contextError;
    }
    const payload = await response.json();
    const activeFarm = payload.farm;
    setUser(payload.user);
    setPermissions(payload.permissions || []);
    setFarms((current) => {
      const next = current.map((farm) => String(farm.id) === String(activeFarm.id)
        ? { ...farm, ...activeFarm, role: payload.user.role, permissions: payload.permissions || [] }
        : farm);
      localStorage.setItem('teledis_farms', JSON.stringify(next));
      return next;
    });
    localStorage.setItem('teledis_user', JSON.stringify(payload.user));
    return payload;
  }, []);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      if (!token) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const response = await apiFetch('/api/v1/farms', { skipFarm: true });
        if (!response.ok) {
          const farmsError = new Error(`Não foi possível carregar as fazendas (HTTP ${response.status}).`);
          farmsError.status = response.status;
          throw farmsError;
        }
        const payload = await response.json();
        const availableFarms = payload.data || [];
        if (!active) return;
        setFarms(availableFarms);
        localStorage.setItem('teledis_farms', JSON.stringify(availableFarms));

        const savedFarm = availableFarms.find((farm) => String(farm.id) === String(activeFarmId));
        const selected = savedFarm || (availableFarms.length === 1 ? availableFarms[0] : null);
        if (!selected) {
          setActiveFarmId(null);
          localStorage.removeItem('teledis_farm_id');
          setLoading(false);
          return;
        }
        setActiveFarmId(String(selected.id));
        localStorage.setItem('teledis_farm_id', String(selected.id));
        await finishFarmContext(String(selected.id));
      } catch (sessionError) {
        if (active && sessionError.status === 401) {
          invalidateSession();
        } else if (active) {
          setError(sessionError.message || 'Não foi possível restaurar a sessão.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    restoreSession();
    return () => { active = false; };
  }, [token, finishFarmContext, invalidateSession]);

  const signIn = useCallback((payload) => {
    const nextFarms = payload.farms || [];
    localStorage.setItem('teledis_token', payload.access_token);
    localStorage.setItem('teledis_user', JSON.stringify(payload.user || {}));
    localStorage.setItem('teledis_farms', JSON.stringify(nextFarms));
    setToken(payload.access_token);
    setUser(payload.user || {});
    setFarms(nextFarms);
    setError('');

    if (nextFarms.length === 1) {
      localStorage.setItem('teledis_farm_id', String(nextFarms[0].id));
      setActiveFarmId(String(nextFarms[0].id));
      setPermissions(nextFarms[0].permissions || []);
    } else {
      localStorage.removeItem('teledis_farm_id');
      setActiveFarmId(null);
      setPermissions([]);
    }
    setLoading(false);
  }, []);

  const refreshFarms = useCallback(async () => {
    const response = await apiFetch('/api/v1/farms', { skipFarm: true });
    if (!response.ok) {
      throw new Error(`Não foi possível atualizar as fazendas (HTTP ${response.status}).`);
    }
    const payload = await response.json();
    const availableFarms = payload.data || [];
    setFarms(availableFarms);
    localStorage.setItem('teledis_farms', JSON.stringify(availableFarms));
    return availableFarms;
  }, []);

  const selectFarm = useCallback(async (farmId) => {
    const selected = farms.find((farm) => String(farm.id) === String(farmId));
    if (!selected) throw new Error('A fazenda selecionada não está disponível para esta conta.');
    setLoading(true);
    setError('');
    localStorage.setItem('teledis_farm_id', String(selected.id));
    setActiveFarmId(String(selected.id));
    setPermissions(selected.permissions || []);
    try {
      await finishFarmContext(String(selected.id));
    } catch (contextError) {
      setError(contextError.message);
      throw contextError;
    } finally {
      setLoading(false);
    }
  }, [farms, finishFarmContext]);

  const signOut = useCallback(async () => {
    try {
      if (token) await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      invalidateSession();
    }
  }, [token, invalidateSession]);

  const activeFarm = farms.find((farm) => String(farm.id) === String(activeFarmId)) || null;
  const value = useMemo(() => ({
    token,
    user,
    farms,
    activeFarm,
    activeFarmId,
    permissions,
    role: user?.role || activeFarm?.role || null,
    loading,
    error,
    isAuthenticated: Boolean(token),
    can: (permission) => permissions.includes(permission),
    signIn,
    signOut,
    selectFarm,
    refreshFarms,
  }), [token, user, farms, activeFarm, activeFarmId, permissions, loading, error, signIn, signOut, selectFarm, refreshFarms]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser utilizado dentro de AuthProvider.');
  return context;
}
