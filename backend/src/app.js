const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const { createTrustedOriginPolicy } = require('./utils/trustedOrigin');

const app = express();
app.set('etag', false);
app.set('trust proxy', env.trustProxy);
const trustedOriginPolicy = createTrustedOriginPolicy(env);
const uploadPublicDir = path.resolve(__dirname, '..', 'uploads');
const defaultJsonParser = express.json({ limit: '1mb' });
const largeJsonParser = express.json({ limit: '12mb' });
const largeJsonPathPrefixes = ['/api/forum'];
const publicVerificationPathPrefixes = [
  '/api/payments/verify',
  '/api/cash-register/verify',
  '/api/certificates/verify',
];

const publicVerificationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiadas verificaciones. Intente nuevamente en unos minutos.' },
});

const apiLimiter = rateLimit({
  windowMs: env.apiRateLimit.windowMs,
  max: env.apiRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isHealthRoute(req),
  message: { message: 'Demasiadas solicitudes. Intente nuevamente en unos minutos.' },
});

const setPublicDocumentHeaders = (_req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
};

const isHealthRoute = (req) => req.path === '/api/health';
const isUploadAssetRoute = (req) => req.path.startsWith('/api/uploads/');

morgan.token('request_id', (req) => req.id || '-');

app.use(helmet());
app.use((req, res, next) => {
  const providedRequestId = req.headers['x-request-id'];
  req.id =
    typeof providedRequestId === 'string' && providedRequestId.trim()
      ? providedRequestId.trim()
      : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});
app.use(
  cors({
    origin: (origin, callback) => {
      if (trustedOriginPolicy.isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
  }),
);

app.use('/api', (req, res, next) => {
  if (trustedOriginPolicy.isTrustedUnsafeRequest(req)) return next();

  return res.status(403).json({
    message: 'Origen de solicitud no permitido.',
    request_id: req.id || null,
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'computron-api' });
});

app.use('/api/uploads/:bucket', (req, res, next) => {
  const protectedBuckets = new Set(['payments', 'course-library']);
  if (!protectedBuckets.has(String(req.params.bucket || ''))) {
    return next();
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return res.status(404).json({
    message: 'Archivo no disponible por enlace publico.',
    request_id: req.id || null,
  });
});

app.use(
  '/api/uploads',
  express.static(uploadPublicDir, {
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }),
);

app.use((req, res, next) => {
  const isPublicVerificationRoute = publicVerificationPathPrefixes.some((prefix) =>
    req.path.startsWith(prefix),
  );
  if (!isPublicVerificationRoute) return next();

  return publicVerificationLimiter(req, res, (error) => {
    if (error) return next(error);
    return setPublicDocumentHeaders(req, res, next);
  });
});

app.use((req, res, next) => {
  const useLargeLimit = largeJsonPathPrefixes.some((prefix) => req.path.startsWith(prefix));
  const parser = useLargeLimit ? largeJsonParser : defaultJsonParser;
  return parser(req, res, next);
});

app.use('/api', apiLimiter);

app.use(
  morgan((tokens, req, res) =>
    JSON.stringify({
      time: new Date().toISOString(),
      request_id: tokens.request_id(req, res),
      method: tokens.method(req, res),
      path: tokens.url(req, res),
      status: Number(tokens.status(req, res) || 0),
      response_time_ms: Number(tokens['response-time'](req, res) || 0),
      content_length: Number(tokens.res(req, res, 'content-length') || 0),
      user_agent: tokens['user-agent'](req, res),
    }),
    {
      skip: (req) => req.method === 'OPTIONS' || isHealthRoute(req) || isUploadAssetRoute(req),
    },
  ),
);

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/api', routes);

app.use((req, res) => {
  res.status(404).json({ message: 'Ruta no encontrada', request_id: req.id || null });
});

app.use(errorHandler);

module.exports = app;
