import axios from 'axios';
import { getCampusScopeId } from '../utils/campusScope';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  withCredentials: true,
});

const GET_CACHE_TTL_MS = 15000;
const getResponseCache = new Map();

let accessToken = '';
let handleTokensUpdated = () => {};
let handleAuthFailure = () => {};
let refreshPromise = null;

const AUTH_ROUTES = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/register'];

const isAuthRoute = (url = '') => AUTH_ROUTES.some((path) => url.includes(path));

const getFrontendOriginHeader = () => {
  if (typeof window === 'undefined' || !window.location?.origin) return '';
  return window.location.origin;
};

const normalizeParams = (params) => {
  if (!params) return '';

  if (params instanceof URLSearchParams) {
    return Array.from(params.entries())
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
  }

  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');
};

const buildGetCacheKey = (config) => {
  const method = String(config.method || 'get').toLowerCase();
  const route = String(config.url || '');
  const params = normalizeParams(config.params);
  return `${method}|${route}|${params}`;
};

export const setAuthToken = (token) => {
  const nextToken = token || '';
  if (accessToken !== nextToken) {
    getResponseCache.clear();
  }
  accessToken = nextToken;
};

export const configureAuthHandlers = ({
  onTokensUpdated,
  onAuthFailure,
} = {}) => {
  handleTokensUpdated = typeof onTokensUpdated === 'function' ? onTokensUpdated : () => {};
  handleAuthFailure = typeof onAuthFailure === 'function' ? onAuthFailure : () => {};
};

api.interceptors.request.use((config) => {
  config.headers = config.headers || {};

  if (accessToken) {
    if (!config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
  }

  const frontendOrigin = getFrontendOriginHeader();
  if (frontendOrigin && !config.headers['X-Frontend-Origin']) {
    config.headers['X-Frontend-Origin'] = frontendOrigin;
  }

  const method = String(config.method || 'get').toLowerCase();
  const shouldApplyCampusScope =
    !config._skipCampusScope && !isAuthRoute(config.url);

  if (shouldApplyCampusScope) {
    const campusScopeId = getCampusScopeId();
    if (campusScopeId) {
      if (config.params instanceof URLSearchParams) {
        if (!config.params.has('campus_id')) {
          config.params.set('campus_id', String(campusScopeId));
        }
      } else {
        const params = { ...(config.params || {}) };
        if (params.campus_id === undefined || params.campus_id === null || params.campus_id === '') {
          params.campus_id = campusScopeId;
        }
        config.params = params;
      }
    }
  }

  if (method === 'get' && !config._skipResponseCache && !isAuthRoute(config.url)) {
    const cacheKey = buildGetCacheKey(config);
    config._cacheKey = cacheKey;

    const cachedEntry = getResponseCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp <= GET_CACHE_TTL_MS) {
      config.adapter = async () => ({
        data: cachedEntry.data,
        status: cachedEntry.status,
        statusText: cachedEntry.statusText || 'OK',
        headers: cachedEntry.headers,
        config,
        request: null,
      });
      config._servedFromCache = true;
    } else if (cachedEntry) {
      getResponseCache.delete(cacheKey);
    }
  } else if (method !== 'get') {
    getResponseCache.clear();
  }

  return config;
});

const refreshAccessToken = async () => {
  const response = await api.post(
    '/auth/refresh',
    {},
    { _skipAuthRefresh: true },
  );

  const newAccessToken = response.data?.access_token || '';

  if (!newAccessToken) {
    throw new Error('Refresh token response missing access token');
  }

  setAuthToken(newAccessToken);
  handleTokensUpdated({
    accessToken: newAccessToken,
  });

  return newAccessToken;
};

api.interceptors.response.use(
  (response) => {
    const method = String(response?.config?.method || 'get').toLowerCase();
    const cacheKey = response?.config?._cacheKey;
    const wasServedFromCache = Boolean(response?.config?._servedFromCache);

    if (
      method === 'get' &&
      cacheKey &&
      !wasServedFromCache &&
      response.status >= 200 &&
      response.status < 300
    ) {
      getResponseCache.set(cacheKey, {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        timestamp: Date.now(),
      });
    }

    return response;
  },
  async (error) => {
    const statusCode = error?.response?.status;
    const originalRequest = error?.config || {};

    if (
      statusCode !== 401 ||
      originalRequest._retry ||
      originalRequest._skipAuthRefresh ||
      isAuthRoute(originalRequest.url)
    ) {
      throw error;
    }

    originalRequest._retry = true;

    try {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }

      const newAccessToken = await refreshPromise;
      originalRequest.headers = originalRequest.headers || {};
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      handleAuthFailure();
      throw refreshError;
    }
  },
);

export const clearAuthToken = () => {
  accessToken = '';
  getResponseCache.clear();
};

export const removeAuthToken = () => {
  clearAuthToken();
};

export default api;
