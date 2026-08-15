const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { query, withTransaction } = require('../config/db');
const env = require('../config/env');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const validate = require('../middlewares/validate');
const { authenticate } = require('../middlewares/auth');
const {
  getUserPermissionCodes,
  invalidateUserPermissionCache,
  userHasPermission,
} = require('../services/permissions.service');
const { invalidateCacheByPrefix } = require('../services/responseCache.service');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require('../utils/token');
const { normalizeDocumentNumber } = require('../utils/documentNumber');
const {
  assertCampusIdsAllowed,
  getUserCampuses,
  normalizeCampusIds,
  replaceUserCampuses,
  validateCampusIds,
} = require('../services/userCampuses.service');
const {
  createAndSendAccountActivationCode,
  consumeAccountActivationCode,
  hasSmtpConfig,
} = require('../services/accountActivation.service');

const router = express.Router();

const ROLES = ['ADMIN', 'DOCENTE', 'SECRETARIADO', 'DIRECTOR', 'ALUMNO'];
const REFRESH_COOKIE_NAME = 'computron_refresh';
const optionalCampusIdSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}, z.number().int().positive().nullable().optional());

const teacherAssignmentSchema = z.object({
  course_campus_id: z.number().int().positive(),
  period_id: z.number().int().positive(),
  schedule_info: z.string().max(240).nullable().optional(),
  campus_override_reason: z.string().max(300).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos de login. Intente más tarde.' },
});

const activationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos de activación. Intente más tarde.' },
});

const activationResendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiadas solicitudes de código. Intente más tarde.' },
});

const registerSchema = z.object({
  body: z.object({
    first_name: z.string().min(2).max(80),
    last_name: z.string().min(2).max(80),
    document_number: z.string().min(6).max(30),
    phone: z.string().trim().min(6).max(30).nullable().optional(),
    address: z.string().trim().min(6).max(240).nullable().optional(),
    email: z.string().trim().email(),
    password: z.string().min(8).max(72),
    roles: z.array(z.enum(ROLES)).min(1).max(3).default(['SECRETARIADO']).optional(),
    base_campus_id: optionalCampusIdSchema,
    campus_ids: z.array(z.coerce.number().int().positive()).max(100).optional(),
    must_change_password: z.boolean().optional().default(false),
    send_activation_code: z.boolean().optional().default(false),
    teacher_assignment: teacherAssignmentSchema.optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email(),
    password: z.string().min(1),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const refreshSchema = z.object({
  body: z
    .object({
      refresh_token: z.string().min(20).optional(),
    })
    .optional()
    .default({}),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const changePasswordSchema = z.object({
  body: z.object({
    current_password: z.string().min(1).optional(),
    new_password: z.string().min(8).max(72),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const accountActivationSchema = z.object({
  body: z.object({
    email: z.string().trim().email(),
    code: z.string().trim().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.'),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const resendActivationCodeSchema = z.object({
  body: z.object({
    email: z.string().trim().email(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const getUserRoles = async (userId, db = { query }) => {
  const { rows } = await db.query(
    `SELECT r.name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [userId],
  );

  return rows.map((row) => row.name);
};

const parseCookieHeader = (cookieHeader = '') =>
  String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex <= 0) return cookies;

      const key = part.slice(0, separatorIndex).trim();
      const rawValue = part.slice(separatorIndex + 1).trim();
      if (!key) return cookies;

      try {
        cookies[key] = decodeURIComponent(rawValue);
      } catch (_error) {
        cookies[key] = rawValue;
      }
      return cookies;
    }, {});

const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: env.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000,
});

const getRefreshClearCookieOptions = () => {
  const { maxAge: _maxAge, ...options } = getRefreshCookieOptions();
  return options;
};

const setRefreshCookie = (res, refreshToken) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, getRefreshClearCookieOptions());
};

const getRefreshTokenFromRequest = (req) => {
  const bodyToken = req.validated?.body?.refresh_token || req.body?.refresh_token;
  if (bodyToken) return bodyToken;

  const cookies = parseCookieHeader(req.headers.cookie);
  return cookies[REFRESH_COOKIE_NAME] || '';
};

const signSessionRefreshToken = (payload) =>
  signRefreshToken({
    ...payload,
    jti: crypto.randomUUID(),
  });

router.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const {
      first_name,
      last_name,
      document_number,
      phone = null,
      address = null,
      email,
      password,
      roles = ['SECRETARIADO'],
      base_campus_id = null,
      campus_ids,
      must_change_password = false,
      send_activation_code = false,
      teacher_assignment = null,
    } = req.validated.body;
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedDocumentNumber = normalizeDocumentNumber(document_number);
    const normalizedPhone = phone ? String(phone).trim() : null;
    const normalizedAddress = address ? String(address).trim() : null;
    let resolvedCampusIds =
      campus_ids !== undefined
        ? normalizeCampusIds(campus_ids)
        : normalizeCampusIds(base_campus_id ? [base_campus_id] : []);

    if (roles.includes('DOCENTE')) {
      if (!normalizedPhone) {
        throw new ApiError(400, 'El teléfono del docente es obligatorio.');
      }
      if (!normalizedAddress) {
        throw new ApiError(400, 'La dirección del docente es obligatoria.');
      }
    }

    if (teacher_assignment && !roles.includes('DOCENTE')) {
      throw new ApiError(400, 'La asignación inicial solo aplica a usuarios con rol DOCENTE.');
    }

    const { rows: countRows } = await query('SELECT COUNT(*)::int AS count FROM users');
    const userCount = countRows[0].count;
    const shouldRequireActivation = userCount > 0 && Boolean(send_activation_code);

    if (shouldRequireActivation && env.nodeEnv === 'production' && !hasSmtpConfig) {
      throw new ApiError(
        503,
        'No se puede crear un usuario pendiente de activación porque SMTP no está configurado.',
      );
    }

    if (userCount > 0) {
      if (!req.headers.authorization) {
        throw new ApiError(401, 'Debe autenticarse para registrar usuarios.');
      }

      await new Promise((resolve, reject) => {
        authenticate(req, null, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      const canCreateUsers = await userHasPermission(req.user.id, 'users.create');
      if (!canCreateUsers) {
        throw new ApiError(403, 'No tiene permisos para registrar usuarios.');
      }
      const canManageRoles = await userHasPermission(req.user.id, 'users.roles.manage');
      const canManageTeacherAssignments = teacher_assignment
        ? await userHasPermission(req.user.id, 'teachers.assignments.manage')
        : false;
      const requestedRoles = Array.from(new Set((roles || []).filter(Boolean)));
      const isDefaultRoleRequest =
        requestedRoles.length === 1 && requestedRoles[0] === 'SECRETARIADO';
      if (!canManageRoles && !isDefaultRoleRequest) {
        throw new ApiError(403, 'No tiene permisos para elegir roles personalizados al crear usuarios.');
      }
      if (teacher_assignment && !canManageTeacherAssignments) {
        throw new ApiError(403, 'No tiene permisos para configurar asignaciones docentes al crear usuarios.');
      }

      if (!req.user.is_global_campus_access && resolvedCampusIds.length === 0) {
        resolvedCampusIds = normalizeCampusIds(req.user.campus_ids);
      }

      resolvedCampusIds = assertCampusIdsAllowed(req.user, resolvedCampusIds, {
        allowGlobal: requestedRoles.includes('ADMIN'),
      });
    }

    if (userCount > 0 && !roles.includes('ADMIN') && resolvedCampusIds.length === 0) {
      throw new ApiError(400, 'Debe seleccionar al menos una sede para el usuario.');
    }
    resolvedCampusIds = await validateCampusIds(resolvedCampusIds);
    const resolvedBaseCampusId = resolvedCampusIds[0] || null;

    const existing = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rowCount > 0) {
      throw new ApiError(409, 'El correo ya está registrado.');
    }

    const duplicatedDocument = await query(
      `SELECT id
       FROM users
       WHERE UPPER(REGEXP_REPLACE(COALESCE(document_number, ''), '\\s+', '', 'g')) = $1
       LIMIT 1`,
      [normalizedDocumentNumber],
    );
    if (duplicatedDocument.rowCount > 0) {
      throw new ApiError(409, 'El documento ya está registrado por otro usuario.');
    }

    const hash = await bcrypt.hash(password, 12);

    const created = await withTransaction(async (tx) => {
      const userResult = await tx.query(
        `INSERT INTO users (
           first_name,
           last_name,
           document_number,
           phone,
           address,
           email,
           password_hash,
           base_campus_id,
           must_change_password,
           is_active,
           activation_required,
           email_verified_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $11 = TRUE THEN NULL ELSE NOW() END)
         RETURNING
           id,
           first_name,
           last_name,
           document_number,
           phone,
           address,
           email,
           is_active,
           activation_required,
           email_verified_at,
           base_campus_id,
           must_change_password,
           created_at`,
        [
          first_name,
          last_name,
          normalizedDocumentNumber,
          normalizedPhone,
          normalizedAddress,
          normalizedEmail,
          hash,
          resolvedBaseCampusId,
          must_change_password,
          !shouldRequireActivation,
          shouldRequireActivation,
        ],
      );

      const user = userResult.rows[0];

      const roleResult = await tx.query(
        `SELECT id, name FROM roles WHERE name = ANY($1::text[])`,
        [roles],
      );

      if (roleResult.rowCount !== roles.length) {
        throw new ApiError(400, 'Uno o más roles no existen.');
      }

      for (const roleRow of roleResult.rows) {
        await tx.query(
          `INSERT INTO user_roles (user_id, role_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [user.id, roleRow.id],
        );
      }

      await replaceUserCampuses(
        {
          userId: user.id,
          campusIds: resolvedCampusIds,
          assignedBy: req.user?.id || null,
        },
        tx,
      );

      if (teacher_assignment) {
        const {
          course_campus_id,
          period_id,
          schedule_info = null,
          campus_override_reason = null,
          status = 'ACTIVE',
        } = teacher_assignment;

        const courseCampusResult = await tx.query(
          `SELECT id, campus_id
           FROM course_campus
           WHERE id = $1
           LIMIT 1`,
          [course_campus_id],
        );

        if (courseCampusResult.rowCount === 0) {
          throw new ApiError(400, 'La oferta de curso/sede seleccionada no existe.');
        }

        const selectedCampusId = Number(courseCampusResult.rows[0].campus_id);
        if (
          req.user &&
          !req.user.is_global_campus_access &&
          !normalizeCampusIds(req.user.campus_ids).includes(selectedCampusId)
        ) {
          throw new ApiError(403, 'No puede asignar docentes fuera de sus sedes autorizadas.');
        }
        if (resolvedCampusIds.length > 0 && !resolvedCampusIds.includes(selectedCampusId)) {
          throw new ApiError(400, 'La asignación docente debe pertenecer a una sede autorizada para el usuario.');
        }

        const normalizedOverrideReason = campus_override_reason?.trim() || null;
        const teacherBaseCampusId = user.base_campus_id || null;
        const isCampusOverride =
          teacherBaseCampusId !== null &&
          teacherBaseCampusId !== undefined &&
          Number(teacherBaseCampusId) !== selectedCampusId;

        if (isCampusOverride && !normalizedOverrideReason) {
          throw new ApiError(
            400,
            'El docente tiene una sede base diferente. Debe indicar el motivo del cambio manual de sede.',
          );
        }

        const overrideReasonToSave = isCampusOverride ? normalizedOverrideReason : null;
        const overrideByToSave = isCampusOverride ? req.user.id : null;
        const overrideAtToSave = isCampusOverride ? new Date().toISOString() : null;

        const assignmentResult = await tx.query(
          `INSERT INTO teacher_assignments (
             teacher_user_id,
             course_campus_id,
             period_id,
             schedule_info,
             campus_override_reason,
             campus_override_by,
             campus_override_at,
             status,
             created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (teacher_user_id, course_campus_id, period_id)
           DO UPDATE SET
             schedule_info = EXCLUDED.schedule_info,
             campus_override_reason = EXCLUDED.campus_override_reason,
             campus_override_by = EXCLUDED.campus_override_by,
             campus_override_at = EXCLUDED.campus_override_at,
             status = EXCLUDED.status,
             updated_at = NOW()
           RETURNING id`,
          [
            user.id,
            course_campus_id,
            period_id,
            schedule_info,
            overrideReasonToSave,
            overrideByToSave,
            overrideAtToSave,
            status,
            req.user?.id || null,
          ],
        );

        if (isCampusOverride && req.user?.id) {
          await tx.query(
            `INSERT INTO audit_logs (actor_user_id, entity, entity_id, action, payload)
             VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [
              req.user.id,
              'teacher_assignments',
              String(assignmentResult.rows[0].id),
              'CAMPUS_OVERRIDE',
              JSON.stringify({
                teacher_user_id: user.id,
                course_campus_id,
                period_id,
                teacher_base_campus_id: teacherBaseCampusId,
                selected_campus_id: selectedCampusId,
                reason: normalizedOverrideReason,
              }),
            ],
          );
        }
      }

      return { ...user, campus_ids: resolvedCampusIds, roles };
    });

    invalidateUserPermissionCache(created.id);
    invalidateCacheByPrefix('teachers:list');
    invalidateCacheByPrefix('teachers:assignments:list');

    let activation = null;
    if (shouldRequireActivation) {
      try {
        activation = await createAndSendAccountActivationCode({ user: created });
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'Activation email failed',
            request_id: req.id || null,
            user_id: created.id,
            error: error.message,
          }),
        );
        activation = {
          email_sent: false,
          simulated: false,
          expires_in_minutes: null,
        };
      }
    }

    return res.status(201).json({
      message: shouldRequireActivation ? 'Usuario registrado pendiente de activación.' : 'Usuario registrado.',
      user: created,
      activation: shouldRequireActivation ? { required: true, ...activation } : { required: false },
    });
  }),
);

router.post(
  '/activate',
  activationLimiter,
  validate(accountActivationSchema),
  asyncHandler(async (req, res) => {
    const { email, code } = req.validated.body;
    const normalizedEmail = email.trim().toLowerCase();

    const userResult = await query(
      `SELECT id, first_name, last_name, email, is_active, activation_required, must_change_password
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [normalizedEmail],
    );

    if (userResult.rowCount === 0) {
      throw new ApiError(400, 'Código inválido, vencido o no corresponde.');
    }

    const user = userResult.rows[0];
    if (!user.activation_required) {
      throw new ApiError(400, 'Código inválido, vencido o no corresponde.');
    }

    const activationResult = await consumeAccountActivationCode({ userId: user.id, code });
    if (!activationResult.ok) {
      throw new ApiError(400, 'Código inválido, vencido o con demasiados intentos.');
    }

    const updatedResult = await query(
      `UPDATE users
       SET is_active = TRUE,
           activation_required = FALSE,
           email_verified_at = COALESCE(email_verified_at, NOW()),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, first_name, last_name, email, is_active, activation_required, must_change_password`,
      [user.id],
    );

    invalidateUserPermissionCache(user.id);

    return res.json({
      message: 'Cuenta activada correctamente. Ya puede iniciar sesión.',
      user: updatedResult.rows[0],
    });
  }),
);

router.post(
  '/activation/resend',
  activationResendLimiter,
  validate(resendActivationCodeSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.validated.body;
    const normalizedEmail = email.trim().toLowerCase();
    let activation = null;

    if (env.nodeEnv === 'production' && !hasSmtpConfig) {
      throw new ApiError(503, 'SMTP no está configurado para enviar códigos de activación.');
    }

    const userResult = await query(
      `SELECT id, first_name, email, activation_required, is_active
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [normalizedEmail],
    );

    const user = userResult.rows[0] || null;
    if (user && user.activation_required && !user.is_active) {
      try {
        activation = await createAndSendAccountActivationCode({ user });
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'Activation resend failed',
            request_id: req.id || null,
            user_id: user.id,
            error: error.message,
          }),
        );
        throw new ApiError(502, 'No se pudo enviar el código de activación.');
      }
    }

    return res.json({
      message: 'Si la cuenta está pendiente de activación, enviaremos un nuevo código al correo indicado.',
      activation:
        activation && env.nodeEnv !== 'production'
          ? {
              simulated: activation.simulated,
              activation_code_preview: activation.activation_code_preview,
              expires_in_minutes: activation.expires_in_minutes,
            }
          : null,
    });
  }),
);

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.validated.body;
    const normalizedEmail = email.trim().toLowerCase();

    const { rows } = await query(
      `SELECT id, first_name, last_name, email, password_hash, is_active, activation_required, base_campus_id, must_change_password
       FROM users
       WHERE email = $1`,
      [normalizedEmail],
    );

    if (rows.length === 0) {
      throw new ApiError(401, 'Credenciales inválidas.');
    }

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      throw new ApiError(401, 'Credenciales inválidas.');
    }

    if (user.activation_required) {
      throw new ApiError(403, 'La cuenta está pendiente de activación.', {
        code: 'ACCOUNT_PENDING_ACTIVATION',
        email: user.email,
      });
    }

    if (!user.is_active) {
      throw new ApiError(403, 'La cuenta está desactivada.');
    }

    const roles = await getUserRoles(user.id);
    if (roles.length === 0) {
      throw new ApiError(403, 'Usuario sin roles asignados.');
    }
    const permissions = await getUserPermissionCodes(user.id);
    const campusAccess = await getUserCampuses(user.id);

    const payload = { sub: user.id, email: user.email, roles };
    const access_token = signAccessToken(payload);
    const refresh_token = signSessionRefreshToken(payload);
    const refresh_hash = hashToken(refresh_token);
    const expires_at = new Date(Date.now() + env.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refresh_hash, expires_at],
    );

    setRefreshCookie(res, refresh_token);

    return res.json({
      access_token,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        base_campus_id: campusAccess.base_campus_id,
        campus_ids: campusAccess.campus_ids,
        campus_names: campusAccess.campus_names,
        must_change_password: Boolean(user.must_change_password),
        roles,
        permissions,
      },
    });
  }),
);

router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.validated.body;

    const userResult = await query(
      `SELECT
         id,
         first_name,
         last_name,
         email,
         password_hash,
         is_active,
         base_campus_id,
         must_change_password,
         activation_required
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.user.id],
    );

    if (userResult.rowCount === 0) {
      throw new ApiError(404, 'Usuario no encontrado.');
    }

    const currentUser = userResult.rows[0];
    if (!currentUser.is_active || currentUser.activation_required) {
      throw new ApiError(403, 'La cuenta está desactivada.');
    }

    if (currentUser.must_change_password !== true) {
      if (!current_password) {
        throw new ApiError(400, 'La contraseña actual es obligatoria.');
      }

      const validCurrentPassword = await bcrypt.compare(current_password, currentUser.password_hash);
      if (!validCurrentPassword) {
        throw new ApiError(400, 'La contraseña actual no es correcta.');
      }
    }

    const samePassword = await bcrypt.compare(new_password, currentUser.password_hash);
    if (samePassword) {
      throw new ApiError(400, 'La nueva contraseña debe ser diferente a la actual.');
    }

    const nextPasswordHash = await bcrypt.hash(new_password, 12);
    const updatedResult = await query(
      `UPDATE users
       SET password_hash = $1,
           must_change_password = FALSE,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, first_name, last_name, email, is_active, base_campus_id, must_change_password`,
      [nextPasswordHash, req.user.id],
    );

    const roles = await getUserRoles(req.user.id);
    const permissions = await getUserPermissionCodes(req.user.id);
    const campusAccess = await getUserCampuses(req.user.id);

    return res.json({
      message: 'Contraseña actualizada.',
      user: {
        ...updatedResult.rows[0],
        base_campus_id: campusAccess.base_campus_id,
        campus_ids: campusAccess.campus_ids,
        campus_names: campusAccess.campus_names,
        roles,
        permissions,
      },
    });
  }),
);

router.post(
  '/refresh',
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const refresh_token = getRefreshTokenFromRequest(req);
    if (!refresh_token) {
      clearRefreshCookie(res);
      throw new ApiError(401, 'Refresh token no enviado.');
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(refresh_token);
    } catch (error) {
      clearRefreshCookie(res);
      throw new ApiError(401, 'Refresh token inválido.');
    }

    const tokenHash = hashToken(refresh_token);

    const { rows } = await query(
      `SELECT id, user_id
       FROM refresh_tokens
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [tokenHash],
    );

    if (rows.length === 0) {
      clearRefreshCookie(res);
      throw new ApiError(401, 'Refresh token expirado o revocado.');
    }

    const tokenRow = rows[0];
    const userResult = await query(
      `SELECT id, email, is_active, activation_required
       FROM users
       WHERE id = $1`,
      [decoded.sub],
    );

    if (userResult.rowCount === 0) {
      clearRefreshCookie(res);
      throw new ApiError(401, 'Usuario no encontrado para este token.');
    }

    const currentUser = userResult.rows[0];
    if (!currentUser.is_active || currentUser.activation_required) {
      clearRefreshCookie(res);
      throw new ApiError(403, 'La cuenta está desactivada.');
    }

    const roles = await getUserRoles(decoded.sub);
    if (roles.length === 0) {
      clearRefreshCookie(res);
      throw new ApiError(403, 'Usuario sin roles asignados.');
    }

    const payload = { sub: decoded.sub, email: currentUser.email, roles };

    const newAccessToken = signAccessToken(payload);
    const newRefreshToken = signSessionRefreshToken(payload);
    const newHash = hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + env.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000);

    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE id = $1`,
        [tokenRow.id],
      );

      await tx.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [tokenRow.user_id, newHash, expiresAt],
      );
    });

    setRefreshCookie(res, newRefreshToken);

    return res.json({
      access_token: newAccessToken,
    });
  }),
);

router.post(
  '/logout',
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const refresh_token = getRefreshTokenFromRequest(req);

    if (refresh_token) {
      const tokenHash = hashToken(refresh_token);

      await query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE token_hash = $1
           AND revoked_at IS NULL`,
        [tokenHash],
      );
    }

    clearRefreshCookie(res);

    return res.json({ message: 'Sesión cerrada.' });
  }),
);

router.get(
  '/campuses',
  authenticate,
  asyncHandler(async (req, res) => {
    const campusIds = normalizeCampusIds(req.user.campus_ids);
    const { rows } = await query(
      `SELECT id, name
       FROM campuses
       WHERE $1::boolean = TRUE
          OR id = ANY($2::bigint[])
       ORDER BY LOWER(name), id`,
      [req.user.is_global_campus_access, campusIds],
    );

    return res.json({ items: rows });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, first_name, last_name, email, is_active, activation_required, base_campus_id, must_change_password
       FROM users
       WHERE id = $1`,
      [req.user.id],
    );

    if (rows.length === 0 || rows[0].activation_required || !rows[0].is_active) {
      throw new ApiError(404, 'Usuario no encontrado.');
    }

    const roles = await getUserRoles(req.user.id);
    const permissions = await getUserPermissionCodes(req.user.id);
    const campusAccess = await getUserCampuses(req.user.id);

    return res.json({
      user: {
        ...rows[0],
        base_campus_id: campusAccess.base_campus_id,
        campus_ids: campusAccess.campus_ids,
        campus_names: campusAccess.campus_names,
        must_change_password: Boolean(rows[0].must_change_password),
        activation_required: Boolean(rows[0].activation_required),
        roles,
        permissions,
      },
    });
  }),
);

module.exports = router;
