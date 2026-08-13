const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const parseCsvEnv = (rawValue) =>
  String(rawValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const parsePositiveNumber = (rawValue, fallback, envName) => {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`ENV inválido: ${envName} debe ser un número positivo.`);
  }
  return parsed;
};

const parseOptionalPositiveInteger = (rawValue, envName) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`ENV inválido: ${envName} debe ser un entero positivo.`);
  }
  return parsed;
};

const parseNonNegativeNumber = (rawValue, fallback, envName) => {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`ENV inválido: ${envName} debe ser un número mayor o igual a cero.`);
  }
  return parsed;
};

const parseBooleanEnv = (rawValue, fallback = false) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') return fallback;
  const normalized = String(rawValue).trim().toLowerCase();
  return ['1', 'true', 'si', 'yes', 'on'].includes(normalized);
};

const normalizeBaseUrl = (rawValue) => String(rawValue || '').trim().replace(/\/+$/, '');

const rawFrontendUrls = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || 'http://localhost:8100';
const rawFrontendUrlPatterns = process.env.FRONTEND_URL_PATTERNS || process.env.FRONTEND_ORIGIN_PATTERNS || '';

const frontendUrls = parseCsvEnv(rawFrontendUrls);
const frontendUrlPatterns = parseCsvEnv(rawFrontendUrlPatterns);

if ((process.env.NODE_ENV || 'development') !== 'production') {
  frontendUrls.push(
    'http://localhost:8100',
    'http://localhost:8101',
    'http://127.0.0.1:8100',
    'http://127.0.0.1:8101',
  );
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parsePositiveNumber(process.env.PORT, 4010, 'PORT'),
  frontendUrl: frontendUrls[0] || 'http://localhost:8100',
  frontendUrls: Array.from(new Set(frontendUrls)),
  frontendUrlPatterns: Array.from(new Set(frontendUrlPatterns)),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parsePositiveNumber(process.env.DB_PORT, 5432, 'DB_PORT'),
    database: process.env.DB_NAME || 'computron',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.DB_SSL === 'true',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'change-me-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'change-me-refresh-secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    refreshExpiresDays: parsePositiveNumber(process.env.JWT_REFRESH_EXPIRES_DAYS, 7, 'JWT_REFRESH_EXPIRES_DAYS'),
  },
  receiptTokenEncryptionKey: process.env.RECEIPT_TOKEN_ENCRYPTION_KEY || '',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parsePositiveNumber(process.env.SMTP_PORT, 587, 'SMTP_PORT'),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'no-reply@computron.local',
  },
  sunatApi: {
    baseUrl: normalizeBaseUrl(process.env.SUNAT_API_BASE_URL),
    token: process.env.SUNAT_API_TOKEN || '',
    companyId: parseOptionalPositiveInteger(process.env.SUNAT_API_COMPANY_ID, 'SUNAT_API_COMPANY_ID'),
    branchId: parseOptionalPositiveInteger(process.env.SUNAT_API_BRANCH_ID, 'SUNAT_API_BRANCH_ID'),
    boletaSeries: process.env.SUNAT_API_BOLETA_SERIE || 'B001',
    facturaSeries: process.env.SUNAT_API_FACTURA_SERIE || 'F001',
    boletaSendMode: process.env.SUNAT_API_BOLETA_METODO_ENVIO || 'resumen_diario',
    defaultUnit: process.env.SUNAT_API_DEFAULT_UNIT || 'ZZ',
    defaultItemCode: process.env.SUNAT_API_DEFAULT_ITEM_CODE || 'SERV',
    defaultProductSunatCode: process.env.SUNAT_API_PRODUCT_SUNAT_CODE || '',
    defaultUbigeo: process.env.SUNAT_API_DEFAULT_UBIGEO || '',
    defaultDistrito: process.env.SUNAT_API_DEFAULT_DISTRITO || '',
    defaultProvincia: process.env.SUNAT_API_DEFAULT_PROVINCIA || '',
    defaultDepartamento: process.env.SUNAT_API_DEFAULT_DEPARTAMENTO || '',
    taxPercent: parseNonNegativeNumber(process.env.SUNAT_API_TAX_PERCENT, 0, 'SUNAT_API_TAX_PERCENT'),
    igvAffectation: process.env.SUNAT_API_IGV_AFFECTATION || '30',
    pricesIncludeIgv: parseBooleanEnv(process.env.SUNAT_API_PRICES_INCLUDE_IGV, true),
    timeoutMs: parsePositiveNumber(process.env.SUNAT_API_TIMEOUT_MS, 20000, 'SUNAT_API_TIMEOUT_MS'),
  },
  permissionCacheTtlMs: parsePositiveNumber(process.env.PERMISSION_CACHE_TTL_MS, 30000, 'PERMISSION_CACHE_TTL_MS'),
  responseCacheTtlMs: parsePositiveNumber(process.env.RESPONSE_CACHE_TTL_MS, 900000, 'RESPONSE_CACHE_TTL_MS'),
  responseCacheMaxEntries: parsePositiveNumber(
    process.env.RESPONSE_CACHE_MAX_ENTRIES,
    500,
    'RESPONSE_CACHE_MAX_ENTRIES',
  ),
  notificationWorkerConcurrency: parsePositiveNumber(
    process.env.NOTIFICATION_WORKER_CONCURRENCY,
    5,
    'NOTIFICATION_WORKER_CONCURRENCY',
  ),
  notificationWorkerMaxQueue: parsePositiveNumber(
    process.env.NOTIFICATION_WORKER_MAX_QUEUE,
    200,
    'NOTIFICATION_WORKER_MAX_QUEUE',
  ),
  apiRateLimit: {
    windowMs: parsePositiveNumber(process.env.API_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000, 'API_RATE_LIMIT_WINDOW_MS'),
    max: parsePositiveNumber(process.env.API_RATE_LIMIT_MAX, 2000, 'API_RATE_LIMIT_MAX'),
  },
};

const failIfInvalid = (condition, message) => {
  if (!condition) {
    throw new Error(`ENV inválido: ${message}`);
  }
};

const isProduction = env.nodeEnv === 'production';
const insecureJwtSecrets = new Set([
  'change-me-access-secret',
  'change-me-refresh-secret',
  'replace_with_secure_access_secret',
  'replace_with_secure_refresh_secret',
]);

if (isProduction) {
  failIfInvalid(
    Boolean(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || process.env.FRONTEND_URL_PATTERNS || process.env.FRONTEND_ORIGIN_PATTERNS),
    'FRONTEND_URLS/FRONTEND_URL o FRONTEND_URL_PATTERNS/FRONTEND_ORIGIN_PATTERNS es requerido en producción.',
  );
  failIfInvalid(Boolean(process.env.DB_HOST), 'DB_HOST es requerido en producción.');
  failIfInvalid(Boolean(process.env.DB_NAME), 'DB_NAME es requerido en producción.');
  failIfInvalid(Boolean(process.env.DB_USER), 'DB_USER es requerido en producción.');
  failIfInvalid(Boolean(process.env.DB_PASSWORD), 'DB_PASSWORD es requerido en producción.');
  failIfInvalid(
    Boolean(env.jwt.accessSecret) &&
      env.jwt.accessSecret.length >= 24 &&
      !insecureJwtSecrets.has(env.jwt.accessSecret),
    'JWT_ACCESS_SECRET debe ser robusto (>=24 caracteres y no default).',
  );
  failIfInvalid(
    Boolean(env.jwt.refreshSecret) &&
      env.jwt.refreshSecret.length >= 24 &&
      !insecureJwtSecrets.has(env.jwt.refreshSecret),
    'JWT_REFRESH_SECRET debe ser robusto (>=24 caracteres y no default).',
  );
}

const hasPartialSmtp =
  Boolean(env.smtp.host) || Boolean(env.smtp.user) || Boolean(env.smtp.pass);

if (hasPartialSmtp) {
  failIfInvalid(Boolean(env.smtp.host), 'SMTP_HOST es requerido cuando SMTP está habilitado.');
  failIfInvalid(Boolean(env.smtp.user), 'SMTP_USER es requerido cuando SMTP está habilitado.');
  failIfInvalid(Boolean(env.smtp.pass), 'SMTP_PASS es requerido cuando SMTP está habilitado.');
}

const hasPartialSunatConfig =
  Boolean(env.sunatApi.baseUrl) ||
  Boolean(env.sunatApi.token) ||
  Boolean(env.sunatApi.companyId) ||
  Boolean(env.sunatApi.branchId);

if (hasPartialSunatConfig) {
  failIfInvalid(Boolean(env.sunatApi.baseUrl), 'SUNAT_API_BASE_URL es requerido cuando SUNAT está habilitado.');
  failIfInvalid(Boolean(env.sunatApi.token), 'SUNAT_API_TOKEN es requerido cuando SUNAT está habilitado.');
  failIfInvalid(Boolean(env.sunatApi.companyId), 'SUNAT_API_COMPANY_ID es requerido cuando SUNAT está habilitado.');
  failIfInvalid(Boolean(env.sunatApi.branchId), 'SUNAT_API_BRANCH_ID es requerido cuando SUNAT está habilitado.');
  failIfInvalid(
    ['individual', 'resumen_diario'].includes(env.sunatApi.boletaSendMode),
    'SUNAT_API_BOLETA_METODO_ENVIO debe ser individual o resumen_diario.',
  );
}

module.exports = env;
