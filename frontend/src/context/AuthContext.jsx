import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api, { clearAuthToken, configureAuthHandlers, setAuthToken } from '../services/api';
import { getCampusScopeId, setCampusScopeId } from '../utils/campusScope';

const AuthContext = createContext(null);

const emptyAuth = { accessToken: '', user: null };
let bootstrapRefreshRequest = null;

const refreshSessionForBootstrap = () => {
  if (!bootstrapRefreshRequest) {
    bootstrapRefreshRequest = api
      .post('/auth/refresh', {}, { _skipAuthRefresh: true })
      .finally(() => {
        bootstrapRefreshRequest = null;
      });
  }

  return bootstrapRefreshRequest;
};

const syncCampusScopeForUser = (user) => {
  const campusIds = Array.isArray(user?.campus_ids)
    ? user.campus_ids.map(Number).filter((campusId) => Number.isInteger(campusId) && campusId > 0)
    : user?.base_campus_id
      ? [Number(user.base_campus_id)]
      : [];
  const isGlobalAdmin =
    Array.isArray(user?.roles) && user.roles.includes('ADMIN') && campusIds.length === 0;

  if (isGlobalAdmin) {
    setCampusScopeId(null);
    return;
  }

  const currentCampusId = getCampusScopeId();
  if (!currentCampusId || !campusIds.includes(Number(currentCampusId))) {
    setCampusScopeId(user?.base_campus_id || campusIds[0] || null);
  }
};

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState({ ...emptyAuth });
  const authRef = useRef(auth);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authRef.current = auth;
    setAuthToken(auth.accessToken);
  }, [auth]);

  useEffect(() => {
    configureAuthHandlers({
      onTokensUpdated: ({ accessToken }) => {
        setAuth((prev) => ({
          ...prev,
          accessToken: accessToken || prev.accessToken,
        }));
      },
      onAuthFailure: () => {
        setAuth({ ...emptyAuth });
        clearAuthToken();
        setCampusScopeId(null);
      },
    });
  }, []);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const refreshResponse = await refreshSessionForBootstrap();

        const refreshedAccessToken = refreshResponse.data?.access_token || '';

        if (!refreshedAccessToken) {
          throw new Error('No se pudo refrescar la sesión');
        }

        setAuthToken(refreshedAccessToken);

        if (active) {
          setAuth((prev) => ({
            ...prev,
            accessToken: refreshedAccessToken,
          }));
        }

        const meResponse = await api.get('/auth/me', { _skipResponseCache: true });
        if (active) {
          const nextUser = meResponse.data.user;
          setAuth((prev) => ({ ...prev, user: nextUser }));
          syncCampusScopeForUser(nextUser);
        }
      } catch {
        if (active) {
          setAuth({ ...emptyAuth });
          clearAuthToken();
          setCampusScopeId(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  const login = async (email, password) => {
    setLoading(true);
    try {
      const response = await api.post('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });
      setAuth({
        accessToken: response.data.access_token,
        user: response.data.user,
      });
      setAuthToken(response.data.access_token);
      syncCampusScopeForUser(response.data.user);
      return { ok: true, user: response.data.user };
    } catch (error) {
      const statusCode = error?.response?.status;
      const retryAfterSeconds = Number(error?.response?.headers?.['retry-after'] || 0);
      const responseData = error?.response?.data;
      const responseMessage =
        (typeof responseData === 'string' && responseData.trim()) ||
        (typeof responseData?.message === 'string' && responseData.message.trim()) ||
        '';
      const responseDetails = responseData?.details || {};
      const rateLimitMessage =
        statusCode === 429
          ? `Demasiadas solicitudes al servidor. ${
              retryAfterSeconds > 0
                ? `Intenta nuevamente en ~${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minuto(s).`
                : 'Intenta nuevamente en unos minutos.'
            }`
          : '';
      const message =
        rateLimitMessage ||
        responseMessage ||
        'No se pudo conectar con la API. Verifica que el backend esté activo y que el proxy de Vite apunte a http://localhost:4010';
      return {
        ok: false,
        message,
        code: responseDetails?.code || null,
        email: responseDetails?.email || email.trim().toLowerCase(),
      };
    } finally {
      setLoading(false);
    }
  };

  const refreshUser = async () => {
    const response = await api.get('/auth/me', { _skipResponseCache: true });
    const nextUser = response.data?.user || null;
    if (nextUser) {
      setAuth((prev) => ({ ...prev, user: nextUser }));
      syncCampusScopeForUser(nextUser);
    }
    return nextUser;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout', {}, { _skipAuthRefresh: true });
    } catch {
      // no-op
    } finally {
      setAuth({ ...emptyAuth });
      clearAuthToken();
      setCampusScopeId(null);
    }
  };

  const changePassword = async ({ currentPassword = '', newPassword = '' } = {}) => {
    try {
      const response = await api.post('/auth/change-password', {
        ...(currentPassword ? { current_password: currentPassword } : {}),
        new_password: newPassword,
      });

      const nextUser = response.data?.user;
      if (nextUser) {
        setAuth((prev) => ({
          ...prev,
          user: nextUser,
        }));
      }

      return {
        ok: true,
        message: response.data?.message || 'Contraseña actualizada.',
      };
    } catch (error) {
      const responseData = error?.response?.data;
      const responseMessage =
        (typeof responseData === 'string' && responseData.trim()) ||
        (typeof responseData?.message === 'string' && responseData.message.trim()) ||
        '';

      return {
        ok: false,
        message: responseMessage || 'No se pudo actualizar la contraseña.',
      };
    }
  };

  const permissions = useMemo(() => auth.user?.permissions || [], [auth.user]);
  const permissionSet = useMemo(() => new Set(permissions), [permissions]);
  const mustChangePassword = Boolean(auth.user?.must_change_password);

  const hasPermission = (permissionCode) => {
    if (!permissionCode) return false;
    return permissionSet.has(permissionCode);
  };

  const hasAnyPermission = (permissionCodes = []) => {
    if (!permissionCodes.length) return true;
    return permissionCodes.some((permissionCode) => permissionSet.has(permissionCode));
  };

  const value = {
    user: auth.user,
    permissions,
    accessToken: auth.accessToken,
    loading,
    isAuthenticated: Boolean(auth.accessToken && auth.user),
    mustChangePassword,
    hasPermission,
    hasAnyPermission,
    login,
    refreshUser,
    changePassword,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return context;
};
