const ApiError = require('../utils/apiError');
const { query } = require('../config/db');

const normalizeCampusIds = (campusIds = []) =>
  Array.from(
    new Set(
      (Array.isArray(campusIds) ? campusIds : [])
        .map((campusId) => Number(campusId))
        .filter((campusId) => Number.isInteger(campusId) && campusId > 0),
    ),
  );

const getUserCampuses = async (userId, db = { query }) => {
  const result = await db.query(
    `SELECT
       TRUE AS user_exists,
       u.is_active,
       u.activation_required,
       u.base_campus_id,
       COALESCE(
         ARRAY_AGG(uc.campus_id ORDER BY uc.is_primary DESC, c.name, uc.campus_id)
           FILTER (WHERE uc.campus_id IS NOT NULL),
         '{}'
       ) AS campus_ids,
       COALESCE(
         ARRAY_AGG(c.name ORDER BY uc.is_primary DESC, c.name, uc.campus_id)
           FILTER (WHERE uc.campus_id IS NOT NULL),
         '{}'
       ) AS campus_names
     FROM users u
     LEFT JOIN user_campuses uc ON uc.user_id = u.id
     LEFT JOIN campuses c ON c.id = uc.campus_id
     WHERE u.id = $1
     GROUP BY u.id, u.base_campus_id`,
    [userId],
  );

  if (result.rowCount === 0) {
    return {
      user_exists: false,
      is_active: false,
      activation_required: false,
      base_campus_id: null,
      campus_ids: [],
      campus_names: [],
    };
  }

  const row = result.rows[0];
  const campusIds = normalizeCampusIds(row.campus_ids);

  if (campusIds.length === 0 && row.base_campus_id) {
    return {
      user_exists: true,
      is_active: Boolean(row.is_active),
      activation_required: Boolean(row.activation_required),
      base_campus_id: Number(row.base_campus_id),
      campus_ids: [Number(row.base_campus_id)],
      campus_names: row.campus_names || [],
    };
  }

  return {
    user_exists: true,
    is_active: Boolean(row.is_active),
    activation_required: Boolean(row.activation_required),
    base_campus_id: row.base_campus_id ? Number(row.base_campus_id) : null,
    campus_ids: campusIds,
    campus_names: row.campus_names || [],
  };
};

const validateCampusIds = async (campusIds, db = { query }) => {
  const normalizedIds = normalizeCampusIds(campusIds);
  if (normalizedIds.length === 0) return normalizedIds;

  const result = await db.query(
    `SELECT id
     FROM campuses
     WHERE id = ANY($1::bigint[])`,
    [normalizedIds],
  );

  if (result.rowCount !== normalizedIds.length) {
    throw new ApiError(400, 'Una o más sedes seleccionadas no existen.');
  }

  return normalizedIds;
};

const assertCampusIdsAllowed = (actor, campusIds, { allowGlobal = false } = {}) => {
  const normalizedIds = normalizeCampusIds(campusIds);

  if (actor?.is_global_campus_access) {
    if (normalizedIds.length === 0 && !allowGlobal) {
      throw new ApiError(400, 'Debe seleccionar al menos una sede.');
    }
    return normalizedIds;
  }

  const allowedIds = new Set(normalizeCampusIds(actor?.campus_ids));
  if (normalizedIds.length === 0) {
    if (allowGlobal) {
      throw new ApiError(403, 'Solo un administrador global puede otorgar acceso a todas las sedes.');
    }
    throw new ApiError(400, 'Debe seleccionar al menos una sede.');
  }

  const unauthorizedIds = normalizedIds.filter((campusId) => !allowedIds.has(campusId));
  if (unauthorizedIds.length > 0) {
    throw new ApiError(403, 'No puede asignar sedes fuera de su propio alcance.');
  }

  return normalizedIds;
};

const assertUserWithinActorScope = async (actor, targetUserId, db = { query }) => {
  if (actor?.is_global_campus_access || Number(actor?.id) === Number(targetUserId)) return;

  const allowedIds = normalizeCampusIds(actor?.campus_ids);
  if (allowedIds.length === 0) {
    throw new ApiError(403, 'No tiene sedes asignadas para gestionar usuarios.');
  }

  const result = await db.query(
    `SELECT 1
     FROM users u
     WHERE u.id = $1
       AND (
         u.base_campus_id = ANY($2::bigint[])
         OR EXISTS (
           SELECT 1
           FROM user_campuses uc
           WHERE uc.user_id = u.id
             AND uc.campus_id = ANY($2::bigint[])
         )
       )
     LIMIT 1`,
    [targetUserId, allowedIds],
  );

  if (result.rowCount === 0) {
    throw new ApiError(403, 'No puede gestionar usuarios fuera de sus sedes autorizadas.');
  }
};

const collectBodyIdsByKey = (value, keys, collected = new Map()) => {
  if (!value || typeof value !== 'object') return collected;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (keys.has(key) && nestedValue !== null && nestedValue !== undefined && nestedValue !== '') {
      if (!collected.has(key)) collected.set(key, []);
      collected.get(key).push(Number(nestedValue));
    }
    if (nestedValue && typeof nestedValue === 'object') {
      collectBodyIdsByKey(nestedValue, keys, collected);
    }
  }

  return collected;
};

const assertRequestCampusAccess = async (req, actor, db = { query }) => {
  const method = String(req?.method || 'GET').toUpperCase();
  if (actor?.is_global_campus_access || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return;

  const allowedIds = normalizeCampusIds(actor?.campus_ids);
  if (allowedIds.length === 0) {
    throw new ApiError(403, 'El usuario no tiene sedes asignadas.');
  }

  const idsByKey = collectBodyIdsByKey(
    req?.body,
    new Set([
      'campus_id',
      'base_campus_id',
      'source_campus_id',
      'course_campus_id',
      'assignment_course_campus_id',
      'enrollment_id',
      'assessment_id',
    ]),
  );

  const directCampusIds = [
    ...(idsByKey.get('campus_id') || []),
    ...(idsByKey.get('base_campus_id') || []),
    ...(idsByKey.get('source_campus_id') || []),
  ].filter(Number.isFinite);

  if (directCampusIds.some((campusId) => !allowedIds.includes(campusId))) {
    throw new ApiError(403, 'No puede gestionar información de una sede no autorizada.');
  }

  const courseCampusIds = [
    ...(idsByKey.get('course_campus_id') || []),
    ...(idsByKey.get('assignment_course_campus_id') || []),
  ].filter(Number.isFinite);
  if (courseCampusIds.length > 0) {
    const result = await db.query(
      `SELECT DISTINCT campus_id
       FROM course_campus
       WHERE id = ANY($1::bigint[])`,
      [courseCampusIds],
    );
    if (
      result.rowCount !== new Set(courseCampusIds).size ||
      result.rows.some((row) => !allowedIds.includes(Number(row.campus_id)))
    ) {
      throw new ApiError(403, 'La oferta de curso pertenece a una sede no autorizada.');
    }
  }

  const enrollmentIds = (idsByKey.get('enrollment_id') || []).filter(Number.isFinite);
  if (enrollmentIds.length > 0) {
    const result = await db.query(
      `SELECT DISTINCT e.id, cc.campus_id
       FROM enrollments e
       JOIN course_campus cc ON cc.id = e.course_campus_id
       WHERE e.id = ANY($1::bigint[])`,
      [enrollmentIds],
    );
    if (
      result.rowCount !== new Set(enrollmentIds).size ||
      result.rows.some((row) => !allowedIds.includes(Number(row.campus_id)))
    ) {
      throw new ApiError(403, 'La matrícula pertenece a una sede no autorizada.');
    }
  }

  const assessmentIds = (idsByKey.get('assessment_id') || []).filter(Number.isFinite);
  if (assessmentIds.length > 0) {
    const result = await db.query(
      `SELECT DISTINCT a.id, cc.campus_id
       FROM assessments a
       JOIN course_campus cc ON cc.id = a.course_campus_id
       WHERE a.id = ANY($1::bigint[])`,
      [assessmentIds],
    );
    if (
      result.rowCount !== new Set(assessmentIds).size ||
      result.rows.some((row) => !allowedIds.includes(Number(row.campus_id)))
    ) {
      throw new ApiError(403, 'La evaluación pertenece a una sede no autorizada.');
    }
  }
};

const replaceUserCampuses = async (
  { userId, campusIds, assignedBy = null },
  db = { query },
) => {
  const normalizedIds = await validateCampusIds(campusIds, db);
  const primaryCampusId = normalizedIds[0] || null;

  await db.query(`DELETE FROM user_campuses WHERE user_id = $1`, [userId]);

  for (let index = 0; index < normalizedIds.length; index += 1) {
    await db.query(
      `INSERT INTO user_campuses (user_id, campus_id, is_primary, assigned_by)
       VALUES ($1, $2, $3, $4)`,
      [userId, normalizedIds[index], index === 0, assignedBy],
    );
  }

  await db.query(
    `UPDATE users
     SET base_campus_id = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [primaryCampusId, userId],
  );

  return normalizedIds;
};

module.exports = {
  assertCampusIdsAllowed,
  assertRequestCampusAccess,
  assertUserWithinActorScope,
  getUserCampuses,
  normalizeCampusIds,
  replaceUserCampuses,
  validateCampusIds,
};
