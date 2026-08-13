const privateIpv4Pattern =
  /^(10(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|0\.0\.0\.0)$/;

const normalizeOrigin = (origin) => String(origin || '').trim().toLowerCase().replace(/\/+$/, '');

const createOriginPatternRegex = (pattern) => {
  const normalized = normalizeOrigin(pattern);
  if (!normalized) return null;

  const escapedPattern = normalized.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escapedPattern}$`, 'i');
};

const isDevelopmentLocalOrigin = (origin) => {
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = String(parsed.hostname || '').toLowerCase();
    return host === 'localhost' || host === '::1' || privateIpv4Pattern.test(host);
  } catch (_error) {
    return false;
  }
};

const getRefererOrigin = (referer) => {
  try {
    return new URL(String(referer || '')).origin;
  } catch (_error) {
    return '';
  }
};

const isUnsafeMethod = (method) =>
  !['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());

const createTrustedOriginPolicy = ({
  frontendUrls = [],
  frontendUrlPatterns = [],
  nodeEnv = 'development',
} = {}) => {
  const allowedOrigins = new Set(frontendUrls.map(normalizeOrigin).filter(Boolean));
  const allowedOriginPatternRegexes = frontendUrlPatterns
    .map(createOriginPatternRegex)
    .filter(Boolean);
  const isDevelopment = nodeEnv !== 'production';

  const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    const normalizedOrigin = normalizeOrigin(origin);
    if (allowedOrigins.has(normalizedOrigin)) return true;
    if (allowedOriginPatternRegexes.some((regex) => regex.test(normalizedOrigin))) return true;
    if (isDevelopment && (normalizedOrigin === 'null' || isDevelopmentLocalOrigin(normalizedOrigin))) {
      return true;
    }
    return false;
  };

  const isTrustedUnsafeRequest = (req) => {
    if (!isUnsafeMethod(req.method)) return true;

    const origin = req.headers.origin || '';
    const frontendOrigin = req.headers['x-frontend-origin'] || '';
    const refererOrigin = getRefererOrigin(req.headers.referer || req.headers.referrer);
    const explicitOrigins = [origin, frontendOrigin, refererOrigin].filter(Boolean);

    if (!explicitOrigins.length) return true;
    if (explicitOrigins.some((candidate) => !isAllowedOrigin(candidate))) return false;

    const normalizedExplicitOrigins = new Set(explicitOrigins.map(normalizeOrigin));
    return normalizedExplicitOrigins.size <= 1;
  };

  return {
    isAllowedOrigin,
    isTrustedUnsafeRequest,
  };
};

module.exports = {
  createOriginPatternRegex,
  createTrustedOriginPolicy,
  getRefererOrigin,
  isDevelopmentLocalOrigin,
  isUnsafeMethod,
  normalizeOrigin,
};
