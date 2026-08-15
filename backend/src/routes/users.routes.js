const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, withTransaction } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const validate = require('../middlewares/validate');
const { authenticate, authorizePermission } = require('../middlewares/auth');
const { parseCampusScopeId } = require('../utils/campusScope');
const { normalizeDocumentNumber } = require('../utils/documentNumber');
const {
  getUserPermissionCodes,
  invalidateAllPermissionCache,
  invalidateUserPermissionCache,
} = require('../services/permissions.service');
const { invalidateCacheByPrefix } = require('../services/responseCache.service');
const {
  assertCampusIdsAllowed,
  assertUserWithinActorScope,
  normalizeCampusIds,
  replaceUserCampuses,
} = require('../services/userCampuses.service');

const router = express.Router();
const ROLE_NAMES = ['ADMIN', 'DOCENTE', 'SECRETARIADO', 'DIRECTOR', 'ALUMNO'];
const invalidateTeacherReadCaches = () => {
  invalidateCacheByPrefix('teachers:list');
  invalidateCacheByPrefix('teachers:assignments:list');
};
const ensureUserHasCampusForRoles = async (userId, roles, db = { query }) => {
  if ((roles || []).includes('ADMIN')) return;

  const result = await db.query(
    `SELECT 1
     FROM users u
     WHERE u.id = $1
       AND (
         u.base_campus_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM user_campuses uc WHERE uc.user_id = u.id)
       )
     LIMIT 1`,
    [userId],
  );
  if (result.rowCount === 0) {
    throw new ApiError(400, 'Asigne al menos una sede antes de retirar el rol ADMIN.');
  }
};

const roleUpdateSchema = z.object({
  body: z.object({
    roles: z.array(z.enum(ROLE_NAMES)).min(1),
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const secureRoleUpdateSchema = z.object({
  body: z.object({
    role: z.enum(ROLE_NAMES),
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const statusUpdateSchema = z.object({
  body: z.object({
    is_active: z.boolean(),
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const deleteUserSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const credentialsUpdateSchema = z.object({
  body: z
    .object({
      first_name: z.string().trim().min(2).max(80).optional(),
      last_name: z.string().trim().min(2).max(80).optional(),
      email: z.string().trim().email().optional(),
      password: z.string().min(8).max(72).optional(),
      document_number: z.string().trim().min(6).max(30).optional(),
      phone: z.string().trim().min(6).max(30).nullable().optional(),
      address: z.string().trim().min(6).max(240).nullable().optional(),
    })
    .refine(
      (value) =>
        value.first_name !== undefined ||
        value.last_name !== undefined ||
        value.email !== undefined ||
        value.password !== undefined ||
        value.document_number !== undefined ||
        value.phone !== undefined ||
        value.address !== undefined,
      {
        message: 'Debe enviar al menos un dato para actualizar.',
      },
    ),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const rolePermissionsUpdateSchema = z.object({
  body: z.object({
    permissions: z.array(z.string().min(3).max(120)).default([]),
  }),
  params: z.object({
    roleName: z.enum(ROLE_NAMES),
  }),
  query: z.object({}).optional(),
});

const usersListSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z
    .object({
      q: z.string().trim().max(120).optional(),
      role: z.enum(ROLE_NAMES).optional(),
      page: z.coerce.number().int().positive().optional(),
      page_size: z.coerce.number().int().min(1).max(100).optional(),
      campus_id: z.coerce.number().int().positive().optional(),
    })
    .optional(),
});

const permissionUsersListSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z
    .object({
      q: z.string().trim().max(120).optional(),
      page_size: z.coerce.number().int().min(1).max(200).optional(),
    })
    .optional(),
});

const permissionUserDetailSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const personalPermissionsUpdateSchema = z.object({
  body: z.object({
    permission_mode: z.enum(['ROLE', 'PERSONAL']).default('ROLE'),
    permissions: z.array(z.string().trim().min(3).max(120)).default([]),
    base_campus_id: z.coerce.number().int().positive().nullable().optional(),
    campus_ids: z.array(z.coerce.number().int().positive()).max(100).optional(),
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

router.use(authenticate);

router.get(
  '/available-campuses',
  authorizePermission('users.create', 'users.permissions.manage'),
  asyncHandler(async (req, res) => {
    const campusIds = normalizeCampusIds(req.user.campus_ids);
    const { rows } = await query(
      `SELECT id, name
       FROM campuses
       WHERE $1::boolean = TRUE
          OR id = ANY($2::bigint[])
       ORDER BY LOWER(name) ASC, id ASC`,
      [req.user.is_global_campus_access, campusIds],
    );

    return res.json({ items: rows });
  }),
);

router.get(
  '/',
  authorizePermission('users.view'),
  validate(usersListSchema),
  asyncHandler(async (req, res) => {
    const queryParams = req.validated.query || {};
    const search = queryParams.q?.trim() || null;
    const role = queryParams.role || null;
    const campusScopeId = parseCampusScopeId(req);
    const pageSize = queryParams.page_size || 20;
    const page = queryParams.page || 1;
    const offset = (page - 1) * pageSize;

    const totalResult = await query(
      `SELECT COUNT(*)::int AS total
       FROM users u
       WHERE (
         $1::text IS NULL
         OR CONCAT_WS(' ', u.first_name, u.last_name, u.document_number, u.email) ILIKE '%' || $1 || '%'
       )
         AND (
           $2::bigint IS NULL
           OR u.base_campus_id = $2
           OR EXISTS (
             SELECT 1
             FROM user_campuses uc_scope
             WHERE uc_scope.user_id = u.id
               AND uc_scope.campus_id = $2
           )
           OR EXISTS (
             SELECT 1
             FROM students s_scope
             JOIN enrollments e_scope ON e_scope.student_id = s_scope.id
             JOIN course_campus cc_scope ON cc_scope.id = e_scope.course_campus_id
             WHERE s_scope.user_id = u.id
               AND cc_scope.campus_id = $2
           )
           OR EXISTS (
             SELECT 1
             FROM teacher_assignments ta_scope
             JOIN course_campus cc_scope ON cc_scope.id = ta_scope.course_campus_id
             WHERE ta_scope.teacher_user_id = u.id
               AND cc_scope.campus_id = $2
           )
         )
         AND (
           $3::text IS NULL
           OR EXISTS (
             SELECT 1
             FROM user_roles ur_filter
             JOIN roles r_filter ON r_filter.id = ur_filter.role_id
             WHERE ur_filter.user_id = u.id
               AND r_filter.name = $3
           )
         )`,
      [search, campusScopeId, role],
    );
    const total = totalResult.rows[0]?.total || 0;

    const { rows } = await query(
      `WITH filtered_users AS (
         SELECT
           u.id,
           u.first_name,
           u.last_name,
           u.document_number,
           u.phone,
           u.address,
           u.email,
           u.base_campus_id,
           u.permission_mode,
           u.is_active,
           u.activation_required,
           u.email_verified_at,
           u.created_at
         FROM users u
         WHERE (
           $1::text IS NULL
           OR CONCAT_WS(' ', u.first_name, u.last_name, u.document_number, u.email) ILIKE '%' || $1 || '%'
         )
           AND (
             $2::bigint IS NULL
             OR u.base_campus_id = $2
             OR EXISTS (
               SELECT 1
               FROM user_campuses uc_scope
               WHERE uc_scope.user_id = u.id
                 AND uc_scope.campus_id = $2
             )
             OR EXISTS (
               SELECT 1
               FROM students s_scope
               JOIN enrollments e_scope ON e_scope.student_id = s_scope.id
               JOIN course_campus cc_scope ON cc_scope.id = e_scope.course_campus_id
               WHERE s_scope.user_id = u.id
                 AND cc_scope.campus_id = $2
             )
             OR EXISTS (
               SELECT 1
               FROM teacher_assignments ta_scope
               JOIN course_campus cc_scope ON cc_scope.id = ta_scope.course_campus_id
               WHERE ta_scope.teacher_user_id = u.id
                 AND cc_scope.campus_id = $2
             )
           )
           AND (
             $3::text IS NULL
             OR EXISTS (
               SELECT 1
               FROM user_roles ur_filter
               JOIN roles r_filter ON r_filter.id = ur_filter.role_id
               WHERE ur_filter.user_id = u.id
                 AND r_filter.name = $3
             )
           )
         ORDER BY u.created_at DESC
         LIMIT $4
         OFFSET $5
       )
       SELECT
         fu.id,
         fu.first_name,
         fu.last_name,
         fu.document_number,
         fu.phone,
         fu.address,
         fu.email,
         fu.base_campus_id,
         cp.name AS base_campus_name,
         COALESCE(
           (
             SELECT ARRAY_AGG(uc.campus_id ORDER BY uc.is_primary DESC, c.name, uc.campus_id)
             FROM user_campuses uc
             JOIN campuses c ON c.id = uc.campus_id
             WHERE uc.user_id = fu.id
           ),
           '{}'
         ) AS campus_ids,
         COALESCE(
           (
             SELECT ARRAY_AGG(c.name ORDER BY uc.is_primary DESC, c.name, uc.campus_id)
             FROM user_campuses uc
             JOIN campuses c ON c.id = uc.campus_id
             WHERE uc.user_id = fu.id
           ),
           '{}'
         ) AS campus_names,
         fu.permission_mode,
         fu.is_active,
         fu.created_at,
         COALESCE(ARRAY_AGG(DISTINCT r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM filtered_users fu
       LEFT JOIN campuses cp ON cp.id = fu.base_campus_id
       LEFT JOIN user_roles ur ON ur.user_id = fu.id
       LEFT JOIN roles r ON r.id = ur.role_id
       GROUP BY
         fu.id,
         fu.first_name,
         fu.last_name,
         fu.document_number,
         fu.phone,
         fu.address,
         fu.email,
         fu.base_campus_id,
         cp.name,
         fu.permission_mode,
         fu.is_active,
         fu.created_at
       ORDER BY fu.created_at DESC`,
      [search, campusScopeId, role, pageSize, offset],
    );

    return res.json({
      items: rows,
      meta: {
        total,
        page,
        page_size: pageSize,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  }),
);

router.patch(
  '/:id/roles',
  authorizePermission('users.roles.manage'),
  validate(roleUpdateSchema),
  asyncHandler(async (req, res) => {
    const userId = req.validated.params.id;
    const { roles } = req.validated.body;
    await assertUserWithinActorScope(req.user, userId);
    await ensureUserHasCampusForRoles(userId, roles);

    const userExists = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userExists.rowCount === 0) {
      throw new ApiError(404, 'Usuario no encontrado.');
    }

    await withTransaction(async (tx) => {
      await tx.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);

      const { rows: roleRows } = await tx.query(
        `SELECT id, name FROM roles WHERE name = ANY($1::text[])`,
        [roles],
      );

      if (roleRows.length !== roles.length) {
        throw new ApiError(400, 'Uno o más roles no existen.');
      }

      for (const role of roleRows) {
        await tx.query(
          `INSERT INTO user_roles (user_id, role_id)
           VALUES ($1, $2)`,
          [userId, role.id],
        );
      }
    });

    invalidateUserPermissionCache(userId);
    invalidateTeacherReadCaches();

    return res.json({ message: 'Roles actualizados.' });
  }),
);

router.patch(
  '/:id/role',
  authorizePermission('users.roles.manage'),
  validate(secureRoleUpdateSchema),
  asyncHandler(async (req, res) => {
    const targetUserId = req.validated.params.id;
    const { role } = req.validated.body;
    await assertUserWithinActorScope(req.user, targetUserId);
    await ensureUserHasCampusForRoles(targetUserId, [role]);

    const adminRolesResult = await query(
      `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      [req.user.id],
    );

    const isRootAdmin = adminRolesResult.rows.some((row) => row.name === 'ADMIN');
    if (!isRootAdmin) {
      throw new ApiError(403, 'Solo el admin raiz puede cambiar roles desde esta acción.');
    }

    await withTransaction(async (tx) => {
      const targetUserResult = await tx.query(`SELECT id FROM users WHERE id = $1`, [targetUserId]);
      if (targetUserResult.rowCount === 0) {
        throw new ApiError(404, 'Usuario no encontrado.');
      }

      const roleResult = await tx.query(`SELECT id FROM roles WHERE name = $1`, [role]);
      if (roleResult.rowCount === 0) {
        throw new ApiError(404, 'Rol no encontrado.');
      }

      await tx.query(`DELETE FROM user_roles WHERE user_id = $1`, [targetUserId]);
      await tx.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1, $2)`,
        [targetUserId, roleResult.rows[0].id],
      );
    });

    invalidateUserPermissionCache(targetUserId);
    invalidateUserPermissionCache(req.user.id);
    invalidateTeacherReadCaches();

    return res.json({ message: `Rol actualizado a ${role}.` });
  }),
);

router.patch(
  '/:id/status',
  authorizePermission('users.status.manage'),
  validate(statusUpdateSchema),
  asyncHandler(async (req, res) => {
    const userId = req.validated.params.id;
    const { is_active } = req.validated.body;
    await assertUserWithinActorScope(req.user, userId);

    const { rows } = await query(
      `UPDATE users
       SET is_active = $1,
           activation_required = CASE WHEN $1 = TRUE THEN FALSE ELSE activation_required END,
           email_verified_at = CASE WHEN $1 = TRUE THEN COALESCE(email_verified_at, NOW()) ELSE email_verified_at END,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, first_name, last_name, email, is_active, activation_required, email_verified_at`,
      [is_active, userId],
    );

    if (rows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado.');
    }

    invalidateUserPermissionCache(userId);
    invalidateTeacherReadCaches();

    return res.json({ message: 'Estado actualizado.', user: rows[0] });
  }),
);

router.delete(
  '/:id',
  authorizePermission('users.status.manage'),
  validate(deleteUserSchema),
  asyncHandler(async (req, res) => {
    const userId = req.validated.params.id;
    await assertUserWithinActorScope(req.user, userId);

    if (userId === req.user.id) {
      throw new ApiError(400, 'No puedes eliminar tu propio usuario.');
    }

    const { rowCount } = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (rowCount === 0) {
      throw new ApiError(404, 'Usuario no encontrado.');
    }

    try {
      await query('DELETE FROM users WHERE id = $1', [userId]);

      invalidateUserPermissionCache(userId);
      invalidateTeacherReadCaches();

      return res.json({ message: 'Usuario eliminado exitosamente.' });
    } catch (error) {
      if (error.code === '23503') {
        throw new ApiError(
          409,
          'No se puede eliminar el usuario porque tiene registros dependientes y causaría inconsistencia (ej. docente asignado, creador de registros).',
        );
      }
      throw error;
    }
  }),
);

router.patch(
  '/:id/credentials',
  authorizePermission('users.status.manage'),
  validate(credentialsUpdateSchema),
  asyncHandler(async (req, res) => {
    const userId = req.validated.params.id;
    const { first_name, last_name, email, password, document_number, phone, address } = req.validated.body;
    await assertUserWithinActorScope(req.user, userId);

    const normalizedFirstName = first_name?.trim();
    const normalizedLastName = last_name?.trim();
    const normalizedEmail = email?.trim().toLowerCase() || null;
    const normalizedDocumentNumber = document_number !== undefined ? normalizeDocumentNumber(document_number) : null;
    const normalizedPhone = phone === undefined ? undefined : phone ? phone.trim() : null;
    const normalizedAddress = address === undefined ? undefined : address ? address.trim() : null;
    const fieldsToUpdate = [];
    const values = [];

    const userExists = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userExists.rowCount === 0) {
      throw new ApiError(404, 'Usuario no encontrado.');
    }

    if (normalizedEmail) {
      const existingEmail = await query(`SELECT id FROM users WHERE email = $1 AND id <> $2`, [
        normalizedEmail,
        userId,
      ]);

      if (existingEmail.rowCount > 0) {
        throw new ApiError(409, 'El correo ya está registrado por otro usuario.');
      }

      values.push(normalizedEmail);
      fieldsToUpdate.push(`email = $${values.length}`);
    }

    if (normalizedFirstName !== undefined) {
      values.push(normalizedFirstName);
      fieldsToUpdate.push(`first_name = $${values.length}`);
    }

    if (normalizedLastName !== undefined) {
      values.push(normalizedLastName);
      fieldsToUpdate.push(`last_name = $${values.length}`);
    }

    if (password) {
      const passwordHash = await bcrypt.hash(password, 12);
      values.push(passwordHash);
      fieldsToUpdate.push(`password_hash = $${values.length}`);
      fieldsToUpdate.push(`must_change_password = FALSE`);
    }

    if (normalizedDocumentNumber) {
      const existingDocument = await query(
        `SELECT id
         FROM users
         WHERE UPPER(REGEXP_REPLACE(COALESCE(document_number, ''), '\\s+', '', 'g')) = $1
           AND id <> $2
         LIMIT 1`,
        [normalizedDocumentNumber, userId],
      );

      if (existingDocument.rowCount > 0) {
        throw new ApiError(409, 'El documento ya está registrado por otro usuario.');
      }

      values.push(normalizedDocumentNumber);
      fieldsToUpdate.push(`document_number = $${values.length}`);
    }

    if (normalizedPhone !== undefined) {
      values.push(normalizedPhone);
      fieldsToUpdate.push(`phone = $${values.length}`);
    }

    if (normalizedAddress !== undefined) {
      values.push(normalizedAddress);
      fieldsToUpdate.push(`address = $${values.length}`);
    }

    values.push(userId);

    const { rows } = await query(
      `UPDATE users
       SET ${fieldsToUpdate.join(', ')},
           updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, first_name, last_name, document_number, phone, address, email, is_active, updated_at`,
      values,
    );

    invalidateUserPermissionCache(userId);
    invalidateTeacherReadCaches();

    return res.json({ message: 'Credenciales actualizadas.', user: rows[0] });
  }),
);

router.get(
  '/permissions',
  authorizePermission('users.permissions.manage'),
  asyncHandler(async (_req, res) => {
    const [rolesResult, permissionsResult, assignedResult] = await Promise.all([
      query(
        `SELECT id, name
         FROM roles
         ORDER BY name`,
      ),
      query(
        `SELECT id, code, module, name, description
         FROM permissions
         ORDER BY module, code`,
      ),
      query(
        `SELECT r.name AS role_name, p.code
         FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id`,
      ),
    ]);

    const allPermissionCodes = permissionsResult.rows.map((permission) => permission.code);
    const rolePermissionsMap = new Map();

    for (const role of rolesResult.rows) {
      rolePermissionsMap.set(role.name, []);
    }

    for (const row of assignedResult.rows) {
      if (!rolePermissionsMap.has(row.role_name)) {
        rolePermissionsMap.set(row.role_name, []);
      }
      rolePermissionsMap.get(row.role_name).push(row.code);
    }

    const roles = rolesResult.rows.map((role) => ({
      ...role,
      permissions:
        role.name === 'ADMIN'
          ? allPermissionCodes
          : Array.from(new Set(rolePermissionsMap.get(role.name) || [])).sort(),
    }));

    return res.json({
      roles,
      permissions: permissionsResult.rows,
    });
  }),
);

router.get(
  '/permissions/users',
  authorizePermission('users.permissions.manage'),
  validate(permissionUsersListSchema),
  asyncHandler(async (req, res) => {
    const search = req.validated.query?.q?.trim() || null;
    const pageSize = req.validated.query?.page_size || 100;
    const campusScopeId = parseCampusScopeId(req);

    const { rows } = await query(
      `SELECT
         u.id,
         u.first_name,
         u.last_name,
         u.document_number,
         u.email,
         u.is_active,
         u.base_campus_id,
         cp.name AS base_campus_name,
         COALESCE(
           (
             SELECT ARRAY_AGG(uc.campus_id ORDER BY uc.is_primary DESC, c.name, uc.campus_id)
             FROM user_campuses uc
             JOIN campuses c ON c.id = uc.campus_id
             WHERE uc.user_id = u.id
           ),
           '{}'
         ) AS campus_ids,
         COALESCE(
           (
             SELECT ARRAY_AGG(c.name ORDER BY uc.is_primary DESC, c.name, uc.campus_id)
             FROM user_campuses uc
             JOIN campuses c ON c.id = uc.campus_id
             WHERE uc.user_id = u.id
           ),
           '{}'
         ) AS campus_names,
         u.permission_mode,
         COALESCE(ARRAY_AGG(DISTINCT r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM users u
       LEFT JOIN campuses cp ON cp.id = u.base_campus_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE (
         $1::text IS NULL
         OR CONCAT_WS(' ', u.first_name, u.last_name, u.document_number, u.email) ILIKE '%' || $1 || '%'
       )
         AND (
           $2::bigint IS NULL
           OR u.base_campus_id = $2
           OR EXISTS (
             SELECT 1
             FROM user_campuses uc_scope
             WHERE uc_scope.user_id = u.id
               AND uc_scope.campus_id = $2
           )
         )
       GROUP BY
         u.id,
         u.first_name,
         u.last_name,
         u.document_number,
         u.email,
         u.is_active,
         u.base_campus_id,
         cp.name,
         u.permission_mode
       ORDER BY LOWER(u.last_name) ASC, LOWER(u.first_name) ASC, u.id ASC
       LIMIT $3`,
      [search, campusScopeId, pageSize],
    );

    return res.json({ items: rows });
  }),
);

router.get(
  '/permissions/campuses',
  authorizePermission('users.permissions.manage'),
  asyncHandler(async (req, res) => {
    const campusIds = normalizeCampusIds(req.user.campus_ids);
    const { rows } = await query(
      `SELECT id, name
       FROM campuses
       WHERE $1::boolean = TRUE
          OR id = ANY($2::bigint[])
       ORDER BY LOWER(name) ASC, id ASC`,
      [req.user.is_global_campus_access, campusIds],
    );

    return res.json({ items: rows });
  }),
);

router.get(
  '/permissions/user/:id',
  authorizePermission('users.permissions.manage'),
  validate(permissionUserDetailSchema),
  asyncHandler(async (req, res) => {
    const userId = req.validated.params.id;
    await assertUserWithinActorScope(req.user, userId);

    const userResult = await query(
      `SELECT
         u.id,
         u.first_name,
         u.last_name,
         u.document_number,
         u.email,
         u.is_active,
         u.base_campus_id,
         cp.name AS base_campus_name,
         COALESCE(
           (
             SELECT ARRAY_AGG(uc.campus_id ORDER BY uc.is_primary DESC, c.name, uc.campus_id)
             FROM user_campuses uc
             JOIN campuses c ON c.id = uc.campus_id
             WHERE uc.user_id = u.id
           ),
           '{}'
         ) AS campus_ids,
         COALESCE(
           (
             SELECT ARRAY_AGG(c.name ORDER BY uc.is_primary DESC, c.name, uc.campus_id)
             FROM user_campuses uc
             JOIN campuses c ON c.id = uc.campus_id
             WHERE uc.user_id = u.id
           ),
           '{}'
         ) AS campus_names,
         u.permission_mode,
         COALESCE(ARRAY_AGG(DISTINCT r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM users u
       LEFT JOIN campuses cp ON cp.id = u.base_campus_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1
       GROUP BY
         u.id,
         u.first_name,
         u.last_name,
         u.document_number,
         u.email,
         u.is_active,
         u.base_campus_id,
         cp.name,
         u.permission_mode`,
      [userId],
    );

    if (userResult.rowCount === 0) {
      throw new ApiError(404, 'Usuario no encontrado.');
    }

    const directPermissionsResult = await query(
      `SELECT p.code
       FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = $1
       ORDER BY p.code`,
      [userId],
    );

    const effectivePermissions = await getUserPermissionCodes(userId);

    return res.json({
      item: {
        ...userResult.rows[0],
        personal_permissions: directPermissionsResult.rows.map((row) => row.code),
        effective_permissions: effectivePermissions,
      },
    });
  }),
);

router.put(
  '/permissions/user/:id',
  authorizePermission('users.permissions.manage'),
  validate(personalPermissionsUpdateSchema),
  asyncHandler(async (req, res) => {
    const userId = req.validated.params.id;
    const permissionMode = req.validated.body.permission_mode || 'ROLE';
    const requestedCampusIds =
      req.validated.body.campus_ids !== undefined
        ? normalizeCampusIds(req.validated.body.campus_ids)
        : req.validated.body.base_campus_id !== undefined
          ? normalizeCampusIds(
              req.validated.body.base_campus_id ? [req.validated.body.base_campus_id] : [],
            )
          : undefined;
    await assertUserWithinActorScope(req.user, userId);
    const normalizedCodes = Array.from(
      new Set((req.validated.body.permissions || []).map((code) => code.trim()).filter(Boolean)),
    );

    await withTransaction(async (tx) => {
      const userExists = await tx.query(
        `SELECT
           u.id,
           COALESCE(
             ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL),
             '{}'
           ) AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.id = $1
         GROUP BY u.id`,
        [userId],
      );
      if (userExists.rowCount === 0) {
        throw new ApiError(404, 'Usuario no encontrado.');
      }

      if (requestedCampusIds !== undefined) {
        const targetIsAdmin = (userExists.rows[0].roles || []).includes('ADMIN');
        const allowedCampusIds = assertCampusIdsAllowed(req.user, requestedCampusIds, {
          allowGlobal: targetIsAdmin,
        });
        await replaceUserCampuses(
          {
            userId,
            campusIds: allowedCampusIds,
            assignedBy: req.user.id,
          },
          tx,
        );
      }

      let permissionIds = [];
      if (permissionMode === 'PERSONAL' && normalizedCodes.length > 0) {
        const permissionResult = await tx.query(
          `SELECT id, code
           FROM permissions
           WHERE code = ANY($1::text[])`,
          [normalizedCodes],
        );

        if (permissionResult.rowCount !== normalizedCodes.length) {
          const foundCodes = new Set(permissionResult.rows.map((row) => row.code));
          const missing = normalizedCodes.filter((code) => !foundCodes.has(code));
          throw new ApiError(400, `Permisos inválidos: ${missing.join(', ')}`);
        }

        permissionIds = permissionResult.rows.map((row) => row.id);
      }

      await tx.query(
        `UPDATE users
         SET permission_mode = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [permissionMode, userId],
      );

      await tx.query(`DELETE FROM user_permissions WHERE user_id = $1`, [userId]);

      if (permissionMode === 'PERSONAL') {
        for (const permissionId of permissionIds) {
          await tx.query(
            `INSERT INTO user_permissions (user_id, permission_id, granted_by)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [userId, permissionId, req.user.id],
          );
        }
      }
    });

    invalidateUserPermissionCache(userId);

    const effectivePermissions = await getUserPermissionCodes(userId);

    return res.json({
      message: 'Permisos personales y sedes actualizados.',
      meta: {
        permission_mode: permissionMode,
        effective_permissions_count: effectivePermissions.length,
      },
    });
  }),
);

router.put(
  '/permissions/:roleName',
  authorizePermission('users.permissions.manage'),
  validate(rolePermissionsUpdateSchema),
  asyncHandler(async (req, res) => {
    const { roleName } = req.validated.params;
    const normalizedCodes = Array.from(
      new Set((req.validated.body.permissions || []).map((code) => code.trim()).filter(Boolean)),
    );

    if (roleName === 'ADMIN') {
      throw new ApiError(400, 'El rol ADMIN tiene acceso total y no se puede limitar desde esta pantalla.');
    }

    await withTransaction(async (tx) => {
      const roleResult = await tx.query(`SELECT id FROM roles WHERE name = $1`, [roleName]);
      if (roleResult.rowCount === 0) {
        throw new ApiError(404, 'Rol no encontrado.');
      }

      const roleId = roleResult.rows[0].id;
      let permissionIds = [];

      if (normalizedCodes.length > 0) {
        const permissionResult = await tx.query(
          `SELECT id, code
           FROM permissions
           WHERE code = ANY($1::text[])`,
          [normalizedCodes],
        );

        if (permissionResult.rowCount !== normalizedCodes.length) {
          const foundCodes = new Set(permissionResult.rows.map((row) => row.code));
          const missing = normalizedCodes.filter((code) => !foundCodes.has(code));
          throw new ApiError(400, `Permisos inválidos: ${missing.join(', ')}`);
        }

        permissionIds = permissionResult.rows.map((row) => row.id);
      }

      await tx.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);

      for (const permissionId of permissionIds) {
        await tx.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [roleId, permissionId],
        );
      }
    });

    invalidateAllPermissionCache();

    return res.json({ message: `Permisos del rol ${roleName} actualizados.` });
  }),
);

module.exports = router;
