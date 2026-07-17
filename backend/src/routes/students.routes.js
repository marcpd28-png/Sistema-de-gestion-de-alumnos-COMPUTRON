const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, withTransaction } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const validate = require('../middlewares/validate');
const { authenticate, authorizePermission } = require('../middlewares/auth');
const { userHasPermission, invalidateUserPermissionCache } = require('../services/permissions.service');
const { parseCampusScopeId } = require('../utils/campusScope');
const { resolveEnrollmentScheduleInfo } = require('../utils/scheduleBlocks');
const {
  decorateEnrollmentWithCertificateEligibility,
  getCertificateEligibility,
  pickPreferredCertificateEnrollment,
} = require('../utils/certificateEligibility');
const { normalizeDocumentNumber } = require('../utils/documentNumber');

const router = express.Router();
const STUDENT_ROLE_NAME = 'ALUMNO';
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');
const booleanQuery = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'si', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;

  return value;
}, z.boolean().optional());
const enrollmentPayloadSchema = z.object({
  course_campus_id: z.number().int().positive(),
  period_id: z.number().int().positive(),
  enrollment_date: dateString.optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELED']).optional().default('ACTIVE'),
  schedule_info: z.string().trim().max(240).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const guardianPayloadSchema = z.object({
  first_name: z.string().trim().min(2).max(80),
  last_name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().min(6).max(30).nullable().optional(),
  document_number: z.string().trim().min(6).max(30).nullable().optional(),
  relationship: z.string().trim().max(60).nullable().optional(),
});

const studentSchema = z.object({
  body: z.object({
    first_name: z.string().min(2).max(80),
    last_name: z.string().min(2).max(80),
    document_number: z.string().min(6).max(30),
    birth_date: dateString,
    email: z.string().email().nullable().optional(),
    phone: z.string().min(6).max(30).nullable().optional(),
    address: z.string().max(240).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    guardian_links: z
      .array(
        z.object({
          guardian_id: z.number().int().positive(),
          relationship: z.string().max(60).nullable().optional(),
        }),
      )
      .optional(),
    guardian_payload: guardianPayloadSchema.nullable().optional(),
    no_guardian: z.boolean().optional().default(true),
    enrollment: enrollmentPayloadSchema.optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const studentListSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z
    .object({
      q: z.string().trim().max(120).optional(),
      campus_id: z.coerce.number().int().positive().optional(),
      certificate_ready_only: booleanQuery,
      page: z.coerce.number().int().positive().optional(),
      page_size: z.coerce.number().int().min(1).max(100).optional(),
    })
    .optional(),
});

const studentSelfCalendarSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z
    .object({
      from: dateString.optional(),
      to: dateString.optional(),
    })
    .optional(),
});

const studentSelfGradesSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z
    .object({
      period_id: z.coerce.number().int().positive().optional(),
      assignment_id: z.coerce.number().int().positive().optional(),
    })
    .optional(),
});

const studentSelfAttendanceSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z
    .object({
      assignment_id: z.coerce.number().int().positive().optional(),
    })
    .optional(),
});

const studentTransferListSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z
    .object({
      campus_id: z.coerce.number().int().positive().optional(),
    })
    .optional(),
});

const studentTransferOptionsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z
    .object({
      campus_id: z.coerce.number().int().positive().optional(),
    })
    .optional(),
});

const studentTransferCreateSchema = z.object({
  body: z.object({
    student_id: z.number().int().positive(),
    source_enrollment_id: z.number().int().positive(),
    target_campus_id: z.number().int().positive(),
    allow_without_target_offering: z.boolean().optional().default(false),
    request_notes: z.string().trim().max(500).nullable().optional(),
  }),
  params: z.object({}).optional(),
  query: z
    .object({
      campus_id: z.coerce.number().int().positive().optional(),
    })
    .optional(),
});

const studentTransferDecisionSchema = z.object({
  body: z.object({
    decision: z.enum(['APPROVE', 'REJECT']),
    review_notes: z.string().trim().max(500).nullable().optional(),
  }),
  params: z.object({ transferId: z.coerce.number().int().positive() }),
  query: z
    .object({
      campus_id: z.coerce.number().int().positive().optional(),
    })
    .optional(),
});

const normalizeOptionalEmail = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
};

const normalizeOptionalText = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const buildStudentEmailFromDocument = (documentNumber) => {
  const safeDocument = String(documentNumber || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const fallback = safeDocument || String(Date.now());
  return `alumno.${fallback}@computron.local`;
};

const buildStudentInitialPassword = (documentNumber) => {
  const safeDocument = String(documentNumber || '').replace(/\s+/g, '');
  const suffix = safeDocument.slice(-6) || String(Date.now()).slice(-6);
  return `Alumno${suffix}!`;
};

const buildEmailWithSuffix = (baseEmail, suffix) => {
  const atIndex = baseEmail.indexOf('@');
  if (atIndex < 0) {
    return `${baseEmail}+${suffix}`;
  }
  const local = baseEmail.slice(0, atIndex);
  const domain = baseEmail.slice(atIndex + 1);
  return `${local}+${suffix}@${domain}`;
};

const ensureUniqueUserEmail = async (tx, desiredEmail, excludeUserId = null) => {
  let suffix = 0;
  while (suffix < 1000) {
    const candidate = suffix === 0 ? desiredEmail : buildEmailWithSuffix(desiredEmail, suffix);
    const params = excludeUserId ? [candidate, excludeUserId] : [candidate];
    const conflictResult = await tx.query(
      `SELECT id
       FROM users
       WHERE email = $1
         ${excludeUserId ? 'AND id <> $2' : ''}`,
      params,
    );
    if (conflictResult.rowCount === 0) {
      return candidate;
    }
    suffix += 1;
  }

  throw new ApiError(409, 'No se pudo generar un correo único para la cuenta del alumno.');
};

const getCurrentStudentProfile = async (req) => {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  if (!roles.includes('ALUMNO')) {
    throw new ApiError(403, 'Esta vista está disponible solo para perfiles de alumno.');
  }

  const profileResult = await query(
    `SELECT id, first_name, last_name, document_number, email, status, user_id
     FROM students
     WHERE status = 'ACTIVE'
       AND (
         user_id = $1
        OR (
          user_id IS NULL
          AND email IS NOT NULL
          AND LOWER(email) = LOWER($2)
        )
      )
     ORDER BY
       CASE WHEN user_id = $1 THEN 0 ELSE 1 END,
       updated_at DESC,
       id DESC
     LIMIT 1`,
    [req.user.id, req.user.email || null],
  );

  if (!profileResult.rowCount) {
    throw new ApiError(404, 'No se encontró un perfil de alumno vinculado al usuario.');
  }

  const profile = profileResult.rows[0];

  // Autorreparación segura: si el correo coincide y el perfil aún no tenía user_id, lo vinculamos al usuario actual.
  if (!profile.user_id) {
    await query(
      `UPDATE students
       SET user_id = $1,
           updated_at = NOW()
       WHERE id = $2
         AND user_id IS NULL`,
      [req.user.id, profile.id],
    );
    profile.user_id = req.user.id;
  }

  return profile;
};

const decorateStudentCertificateSnapshot = (student = {}) => {
  const certificateEnrollment =
    student?.certificate_enrollment && typeof student.certificate_enrollment === 'object'
      ? student.certificate_enrollment
      : null;

  return {
    ...student,
    ...getCertificateEligibility(certificateEnrollment || {}),
    certificate_enrollment: certificateEnrollment,
  };
};

router.use(authenticate);

router.get(
  '/',
  authorizePermission('students.view'),
  validate(studentListSchema),
  asyncHandler(async (req, res) => {
    const queryParams = req.validated.query || {};
    const search = queryParams.q?.trim() || null;
    const campusScopeId = parseCampusScopeId(req);
    const certificateReadyOnly = queryParams.certificate_ready_only === true;
    const hasPagination = queryParams.page !== undefined || queryParams.page_size !== undefined;

    const pageSize = queryParams.page_size || 20;
    const page = queryParams.page || 1;
    const offset = (page - 1) * pageSize;

    const baseFilter = `
      FROM students s
      LEFT JOIN users u_creator ON u_creator.id = s.created_by
      LEFT JOIN users u_student ON u_student.id = s.user_id
      LEFT JOIN campuses cp_assigned ON cp_assigned.id = s.assigned_campus_id
      WHERE (
        $1::text IS NULL
        OR CONCAT_WS(
          ' ',
          s.first_name,
          s.last_name,
          s.document_number,
          TO_CHAR(s.birth_date, 'YYYY-MM-DD'),
          COALESCE(s.email, ''),
          COALESCE(s.phone, ''),
          COALESCE(s.address, ''),
          COALESCE(s.notes, ''),
          COALESCE(cp_assigned.name, '')
        ) ILIKE '%' || $1 || '%'
        OR EXISTS (
          SELECT 1
          FROM enrollments e_search
          JOIN course_campus cc_search ON cc_search.id = e_search.course_campus_id
          JOIN courses c_search ON c_search.id = cc_search.course_id
          JOIN campuses cp_search ON cp_search.id = cc_search.campus_id
          JOIN academic_periods ap_search ON ap_search.id = e_search.period_id
          WHERE e_search.student_id = s.id
            AND e_search.status <> 'TRANSFERRED'
            AND CONCAT_WS(
              ' ',
              c_search.name,
              cp_search.name,
              ap_search.name,
              COALESCE(cc_search.modality, ''),
              COALESCE(e_search.status, ''),
              COALESCE(e_search.notes, '')
            ) ILIKE '%' || $1 || '%'
        )
        OR EXISTS (
          SELECT 1
          FROM student_guardian sgx
          JOIN guardians gx ON gx.id = sgx.guardian_id
          WHERE sgx.student_id = s.id
            AND CONCAT_WS(
              ' ',
              gx.first_name,
              gx.last_name,
              COALESCE(gx.email, ''),
              COALESCE(gx.phone, ''),
              COALESCE(gx.document_number, ''),
              COALESCE(sgx.relationship, '')
            ) ILIKE '%' || $1 || '%'
        )
      )
      AND s.status = 'ACTIVE'
      AND (
        $2::bigint IS NULL
        OR s.assigned_campus_id = $2
        OR EXISTS (
          SELECT 1
          FROM enrollments e_scope
          JOIN course_campus cc_scope ON cc_scope.id = e_scope.course_campus_id
          WHERE e_scope.student_id = s.id
            AND cc_scope.campus_id = $2
            AND e_scope.status <> 'TRANSFERRED'
        )
      )
      AND (
        COALESCE($3::boolean, FALSE) = FALSE
        OR EXISTS (
          SELECT 1
          FROM enrollments e_ready
          JOIN course_campus cc_ready ON cc_ready.id = e_ready.course_campus_id
          JOIN academic_periods ap_ready ON ap_ready.id = e_ready.period_id
          WHERE e_ready.student_id = s.id
            AND e_ready.status <> 'TRANSFERRED'
            AND ($2::bigint IS NULL OR cc_ready.campus_id = $2)
            AND (
              e_ready.status = 'COMPLETED'
              OR (
                e_ready.status = 'ACTIVE'
                AND ap_ready.end_date IS NOT NULL
                AND ap_ready.end_date <= CURRENT_DATE
              )
            )
        )
      )
    `;
    const assignedEnrollmentJoin = `
      LEFT JOIN LATERAL (
        SELECT
          e.id AS assigned_enrollment_id,
          e.status AS assigned_enrollment_status,
          c.id AS assigned_course_id,
          c.name AS assigned_course_name,
          cp.id AS assigned_campus_id,
          cp.name AS assigned_campus_name,
          ap.id AS assigned_period_id,
          ap.name AS assigned_period_name
        FROM enrollments e
        JOIN course_campus cc ON cc.id = e.course_campus_id
        JOIN courses c ON c.id = cc.course_id
        JOIN campuses cp ON cp.id = cc.campus_id
        JOIN academic_periods ap ON ap.id = e.period_id
        WHERE e.student_id = fs.id
          AND e.status <> 'TRANSFERRED'
        ORDER BY
          CASE WHEN e.status = 'ACTIVE' THEN 0 ELSE 1 END,
          e.updated_at DESC,
          e.id DESC
        LIMIT 1
      ) assigned_enrollment ON TRUE
    `;
    const certificateEnrollmentJoin = `
      LEFT JOIN LATERAL (
        SELECT
          JSONB_BUILD_OBJECT(
            'id', e.id,
            'status', e.status,
            'course_id', c.id,
            'course_name', c.name,
            'duration_hours', c.duration_hours,
            'campus_id', cp.id,
            'campus_name', cp.name,
            'campus_city', cp.city,
            'period_id', ap.id,
            'period_name', ap.name,
            'course_start_date', ap.start_date,
            'course_end_date', ap.end_date,
            'modality', cc.modality
          ) AS certificate_enrollment
        FROM enrollments e
        JOIN course_campus cc ON cc.id = e.course_campus_id
        JOIN courses c ON c.id = cc.course_id
        JOIN campuses cp ON cp.id = cc.campus_id
        JOIN academic_periods ap ON ap.id = e.period_id
        WHERE e.student_id = fs.id
          AND e.status <> 'TRANSFERRED'
          AND ($2::bigint IS NULL OR cc.campus_id = $2)
        ORDER BY
          CASE
            WHEN e.status = 'COMPLETED' THEN 0
            WHEN e.status = 'ACTIVE' AND ap.end_date IS NOT NULL AND ap.end_date <= CURRENT_DATE THEN 1
            ELSE 2
          END,
          COALESCE(ap.end_date, e.enrollment_date) DESC,
          e.updated_at DESC,
          e.id DESC
        LIMIT 1
      ) certificate_candidate ON TRUE
    `;

    let total = 0;
    let rows = [];

    if (hasPagination) {
      const totalResult = await query(`SELECT COUNT(*)::int AS total ${baseFilter}`, [
        search,
        campusScopeId,
        certificateReadyOnly,
      ]);
      total = totalResult.rows[0]?.total || 0;

      const dataResult = await query(
        `WITH filtered_students AS (
           SELECT
             s.id,
             s.first_name,
             s.last_name,
             s.document_number,
	             s.birth_date,
	             s.email,
	             s.phone,
	             s.address,
	             s.notes,
	             s.assigned_campus_id,
             cp_assigned.name AS assigned_campus_name_fallback,
             s.status,
             s.user_id,
           COALESCE(u_student.is_active, FALSE) AS access_is_active,
           s.created_by,
           CONCAT_WS(' ', u_creator.first_name, u_creator.last_name) AS created_by_name,
         s.created_at
           ${baseFilter}
         ORDER BY s.created_at DESC
           LIMIT $4
           OFFSET $5
         )
         SELECT
           fs.id,
           fs.first_name,
           fs.last_name,
           fs.document_number,
           fs.birth_date,
           fs.email,
	           fs.phone,
	           fs.address,
	           fs.notes,
	           fs.status,
           fs.user_id,
           fs.access_is_active,
           fs.created_by,
           fs.created_by_name,
           fs.created_at,
           assigned_enrollment.assigned_enrollment_id,
           assigned_enrollment.assigned_enrollment_status,
           assigned_enrollment.assigned_course_id,
           assigned_enrollment.assigned_course_name,
           COALESCE(assigned_enrollment.assigned_campus_id, fs.assigned_campus_id) AS assigned_campus_id,
           COALESCE(assigned_enrollment.assigned_campus_name, fs.assigned_campus_name_fallback) AS assigned_campus_name,
           assigned_enrollment.assigned_period_id,
           assigned_enrollment.assigned_period_name,
           certificate_candidate.certificate_enrollment,
           COALESCE(
             JSON_AGG(
               JSON_BUILD_OBJECT(
                 'guardian_id', g.id,
                 'name', CONCAT(g.first_name, ' ', g.last_name),
                 'email', g.email,
                 'phone', g.phone,
                 'relationship', sg.relationship
               )
               ORDER BY g.last_name, g.first_name
             ) FILTER (WHERE g.id IS NOT NULL),
             '[]'::json
           ) AS guardians
         FROM filtered_students fs
         ${assignedEnrollmentJoin}
         ${certificateEnrollmentJoin}
         LEFT JOIN student_guardian sg ON sg.student_id = fs.id
         LEFT JOIN guardians g ON g.id = sg.guardian_id
         GROUP BY
           fs.id,
           fs.first_name,
           fs.last_name,
           fs.document_number,
           fs.birth_date,
           fs.email,
	           fs.phone,
	           fs.address,
	           fs.notes,
	           fs.assigned_campus_id,
           fs.assigned_campus_name_fallback,
           fs.status,
           fs.user_id,
           fs.access_is_active,
           fs.created_by,
           fs.created_by_name,
           fs.created_at,
           assigned_enrollment.assigned_enrollment_id,
           assigned_enrollment.assigned_enrollment_status,
           assigned_enrollment.assigned_course_id,
           assigned_enrollment.assigned_course_name,
           assigned_enrollment.assigned_campus_id,
           assigned_enrollment.assigned_campus_name,
           assigned_enrollment.assigned_period_id,
           assigned_enrollment.assigned_period_name,
           certificate_candidate.certificate_enrollment
         ORDER BY fs.created_at DESC`,
        [search, campusScopeId, certificateReadyOnly, pageSize, offset],
      );

      rows = dataResult.rows.map(decorateStudentCertificateSnapshot);
    } else {
      const dataResult = await query(
        `WITH filtered_students AS (
           SELECT
             s.id,
             s.first_name,
             s.last_name,
             s.document_number,
             s.birth_date,
             s.email,
	             s.phone,
	             s.address,
	             s.notes,
	             s.assigned_campus_id,
             cp_assigned.name AS assigned_campus_name_fallback,
             s.status,
             s.user_id,
             COALESCE(u_student.is_active, FALSE) AS access_is_active,
             s.created_by,
             CONCAT_WS(' ', u_creator.first_name, u_creator.last_name) AS created_by_name,
             s.created_at
           ${baseFilter}
           ORDER BY s.created_at DESC
         )
         SELECT
           fs.id,
           fs.first_name,
           fs.last_name,
           fs.document_number,
           fs.birth_date,
           fs.email,
	           fs.phone,
	           fs.address,
	           fs.notes,
	           fs.status,
           fs.user_id,
           fs.access_is_active,
           fs.created_by,
           fs.created_by_name,
           fs.created_at,
           assigned_enrollment.assigned_enrollment_id,
           assigned_enrollment.assigned_enrollment_status,
           assigned_enrollment.assigned_course_id,
           assigned_enrollment.assigned_course_name,
           COALESCE(assigned_enrollment.assigned_campus_id, fs.assigned_campus_id) AS assigned_campus_id,
           COALESCE(assigned_enrollment.assigned_campus_name, fs.assigned_campus_name_fallback) AS assigned_campus_name,
           assigned_enrollment.assigned_period_id,
           assigned_enrollment.assigned_period_name,
           certificate_candidate.certificate_enrollment,
           COALESCE(
             JSON_AGG(
               JSON_BUILD_OBJECT(
                 'guardian_id', g.id,
                 'name', CONCAT(g.first_name, ' ', g.last_name),
                 'email', g.email,
                 'phone', g.phone,
                 'relationship', sg.relationship
               )
               ORDER BY g.last_name, g.first_name
             ) FILTER (WHERE g.id IS NOT NULL),
             '[]'::json
           ) AS guardians
         FROM filtered_students fs
         ${assignedEnrollmentJoin}
         ${certificateEnrollmentJoin}
         LEFT JOIN student_guardian sg ON sg.student_id = fs.id
         LEFT JOIN guardians g ON g.id = sg.guardian_id
         GROUP BY
           fs.id,
           fs.first_name,
           fs.last_name,
           fs.document_number,
           fs.birth_date,
           fs.email,
	           fs.phone,
	           fs.address,
	           fs.notes,
	           fs.assigned_campus_id,
           fs.assigned_campus_name_fallback,
           fs.status,
           fs.user_id,
           fs.access_is_active,
           fs.created_by,
           fs.created_by_name,
           fs.created_at,
           assigned_enrollment.assigned_enrollment_id,
           assigned_enrollment.assigned_enrollment_status,
           assigned_enrollment.assigned_course_id,
           assigned_enrollment.assigned_course_name,
           assigned_enrollment.assigned_campus_id,
           assigned_enrollment.assigned_campus_name,
           assigned_enrollment.assigned_period_id,
           assigned_enrollment.assigned_period_name,
           certificate_candidate.certificate_enrollment
         ORDER BY fs.created_at DESC`,
        [search, campusScopeId, certificateReadyOnly],
      );

      rows = dataResult.rows.map(decorateStudentCertificateSnapshot);
      total = rows.length;
    }

    const totalPages = hasPagination ? Math.max(1, Math.ceil(total / pageSize)) : 1;

    return res.json({
      items: rows,
      meta: {
        total,
        page: hasPagination ? page : 1,
        page_size: hasPagination ? pageSize : rows.length,
        total_pages: totalPages,
      },
    });
  }),
);

router.get(
  '/me/courses',
  asyncHandler(async (req, res) => {
    const student = await getCurrentStudentProfile(req);

    const { rows } = await query(
      `SELECT
         e.id AS enrollment_id,
         e.course_campus_id,
         e.period_id,
         e.enrollment_date,
         e.status AS enrollment_status,
         c.id AS course_id,
         c.name AS course_name,
         cp.id AS campus_id,
         cp.name AS campus_name,
         cc.modality,
         COALESCE(e.schedule_info, ta.schedule_info, cc.schedule_info) AS schedule_info,
         ap.name AS period_name,
         ap.start_date,
         ap.end_date,
         ta.id AS assignment_id,
         CONCAT(COALESCE(u_t.first_name, ''), ' ', COALESCE(u_t.last_name, '')) AS teacher_name,
         u_t.email AS teacher_email
       FROM enrollments e
       JOIN course_campus cc ON cc.id = e.course_campus_id
       JOIN courses c ON c.id = cc.course_id
       JOIN campuses cp ON cp.id = cc.campus_id
       JOIN academic_periods ap ON ap.id = e.period_id
       LEFT JOIN LATERAL (
         SELECT ta1.id, ta1.teacher_user_id, ta1.schedule_info
         FROM teacher_assignments ta1
         WHERE ta1.course_campus_id = e.course_campus_id
           AND ta1.period_id = e.period_id
           AND ta1.status = 'ACTIVE'
         ORDER BY ta1.updated_at DESC, ta1.id DESC
         LIMIT 1
       ) ta ON TRUE
       LEFT JOIN users u_t ON u_t.id = ta.teacher_user_id
       WHERE e.student_id = $1
         AND e.status = 'ACTIVE'
       ORDER BY ap.start_date DESC, c.name ASC, cp.name ASC`,
      [student.id],
    );

    return res.json({
      student: {
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        document_number: student.document_number,
      },
      items: rows,
    });
  }),
);

router.get(
  '/me/calendar',
  validate(studentSelfCalendarSchema),
  asyncHandler(async (req, res) => {
    const student = await getCurrentStudentProfile(req);
    const fromDate =
      req.validated.query?.from ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const toDate =
      req.validated.query?.to ||
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { rows } = await query(
      `WITH student_events AS (
         SELECT DISTINCT ON (ev.id)
           ev.id,
           ev.assignment_id,
           ev.course_campus_id,
           ev.title,
           ev.event_date,
           TO_CHAR(ev.start_time, 'HH24:MI') AS start_time,
           TO_CHAR(ev.end_time, 'HH24:MI') AS end_time,
           ev.classroom,
           ev.notes,
           ev.status,
           c.name AS course_name,
           cp.name AS campus_name,
           ap.name AS period_name,
           CONCAT(COALESCE(u_t.first_name, ''), ' ', COALESCE(u_t.last_name, '')) AS teacher_name
         FROM teacher_calendar_events ev
         JOIN teacher_assignments ta ON ta.id = ev.assignment_id
         JOIN enrollments e
           ON e.course_campus_id = ta.course_campus_id
          AND e.period_id = ta.period_id
         JOIN course_campus cc ON cc.id = COALESCE(ev.course_campus_id, ta.course_campus_id)
         JOIN courses c ON c.id = cc.course_id
         JOIN campuses cp ON cp.id = cc.campus_id
         JOIN academic_periods ap ON ap.id = ta.period_id
         LEFT JOIN users u_t ON u_t.id = ta.teacher_user_id
         WHERE e.student_id = $1
           AND e.status = 'ACTIVE'
           AND ta.status = 'ACTIVE'
           AND ev.event_date BETWEEN $2 AND $3
         ORDER BY ev.id, ev.updated_at DESC, ev.created_at DESC
       )
       SELECT *
       FROM student_events
       ORDER BY event_date ASC, start_time ASC, id ASC`,
      [student.id, fromDate, toDate],
    );

    return res.json({
      items: rows,
      meta: {
        from: fromDate,
        to: toDate,
      },
    });
  }),
);

router.get(
  '/me/grades',
  validate(studentSelfGradesSchema),
  asyncHandler(async (req, res) => {
    const student = await getCurrentStudentProfile(req);
    const periodId = req.validated.query?.period_id || null;
    const assignmentId = req.validated.query?.assignment_id || null;

    const { rows } = await query(
      `SELECT
         g.id,
         g.assessment_id,
         a.title AS assessment_title,
         a.assessment_date,
         a.weight,
         g.score,
         g.recorded_at,
         c.name AS course_name,
         cp.name AS campus_name,
         p.name AS period_name,
         ta.id AS assignment_id
       FROM grades g
       JOIN assessments a ON a.id = g.assessment_id
       JOIN course_campus cc ON cc.id = a.course_campus_id
       JOIN courses c ON c.id = cc.course_id
       JOIN campuses cp ON cp.id = cc.campus_id
       JOIN academic_periods p ON p.id = a.period_id
       LEFT JOIN LATERAL (
         SELECT ta1.id
         FROM teacher_assignments ta1
         WHERE ta1.course_campus_id = a.course_campus_id
           AND ta1.period_id = a.period_id
           AND ta1.status = 'ACTIVE'
         ORDER BY ta1.updated_at DESC, ta1.id DESC
         LIMIT 1
       ) ta ON TRUE
       WHERE g.student_id = $1
         AND ($2::bigint IS NULL OR a.period_id = $2)
         AND ($3::bigint IS NULL OR ta.id = $3)
       ORDER BY a.assessment_date DESC, g.recorded_at DESC, g.id DESC`,
      [student.id, periodId, assignmentId],
    );

    return res.json({ items: rows });
  }),
);

router.get(
  '/me/payments',
  asyncHandler(async (req, res) => {
    const student = await getCurrentStudentProfile(req);

    const [installmentsResult, paymentsResult] = await Promise.all([
      query(
        `SELECT
           i.id,
           i.enrollment_id,
           pc.name AS concept_name,
           i.description,
           i.due_date,
           i.total_amount,
           i.paid_amount,
           i.status,
           (i.total_amount - i.paid_amount) AS pending_amount,
           c.name AS course_name,
           cp.name AS campus_name,
           ap.name AS period_name
         FROM installments i
         JOIN enrollments e ON e.id = i.enrollment_id
         JOIN course_campus cc ON cc.id = e.course_campus_id
         JOIN courses c ON c.id = cc.course_id
         JOIN campuses cp ON cp.id = cc.campus_id
         JOIN academic_periods ap ON ap.id = e.period_id
         JOIN payment_concepts pc ON pc.id = i.concept_id
         WHERE e.student_id = $1
         ORDER BY i.due_date ASC, i.id ASC`,
        [student.id],
      ),
      query(
        `SELECT
           p.id,
           p.enrollment_id,
           p.total_amount,
           p.method,
           p.reference_code,
           p.status,
           p.payment_date,
           p.notes,
           c.name AS course_name,
           cp.name AS campus_name,
           ap.name AS period_name
         FROM payments p
         JOIN enrollments e ON e.id = p.enrollment_id
         JOIN course_campus cc ON cc.id = e.course_campus_id
         JOIN courses c ON c.id = cc.course_id
         JOIN campuses cp ON cp.id = cc.campus_id
         JOIN academic_periods ap ON ap.id = e.period_id
         WHERE p.student_id = $1
         ORDER BY p.payment_date DESC, p.id DESC`,
        [student.id],
      ),
    ]);

    const installments = installmentsResult.rows.map((row) => ({
      ...row,
      pending_amount: Number(row.pending_amount || 0),
    }));

    const pendingInstallments = installments.filter((item) => Number(item.pending_amount || 0) > 0);

    return res.json({
      installments,
      payments: paymentsResult.rows,
      summary: {
        total_installments: installments.length,
        pending_installments: pendingInstallments.length,
        next_due_date: pendingInstallments[0]?.due_date || null,
      },
    });
  }),
);

router.get(
  '/me/attendance',
  validate(studentSelfAttendanceSchema),
  asyncHandler(async (req, res) => {
    const student = await getCurrentStudentProfile(req);
    const assignmentId = req.validated.query?.assignment_id || null;

    let assignment = null;
    let courseCampusId = null;
    let periodId = null;

    if (assignmentId) {
      const assignmentResult = await query(
        `SELECT
           ta.id,
           ta.course_campus_id,
           ta.period_id,
           c.name AS course_name,
           cp.name AS campus_name,
           ap.name AS period_name
         FROM teacher_assignments ta
         JOIN course_campus cc ON cc.id = ta.course_campus_id
         JOIN courses c ON c.id = cc.course_id
         JOIN campuses cp ON cp.id = cc.campus_id
         JOIN academic_periods ap ON ap.id = ta.period_id
         WHERE ta.id = $1
           AND ta.status = 'ACTIVE'
           AND EXISTS (
             SELECT 1
             FROM enrollments e
             WHERE e.student_id = $2
               AND e.course_campus_id = ta.course_campus_id
               AND e.period_id = ta.period_id
               AND e.status = 'ACTIVE'
           )
         LIMIT 1`,
        [assignmentId, student.id],
      );

      if (!assignmentResult.rowCount) {
        throw new ApiError(404, 'No se encontró el salón seleccionado para este alumno.');
      }

      assignment = assignmentResult.rows[0];
      courseCampusId = assignment.course_campus_id;
      periodId = assignment.period_id;
    }

    const { rows } = await query(
      `SELECT
         a.id,
         a.enrollment_id,
         a.attendance_date,
         a.status,
         a.notes,
         c.name AS course_name,
         cp.name AS campus_name,
         ap.name AS period_name
       FROM attendances a
       JOIN enrollments e ON e.id = a.enrollment_id
       JOIN course_campus cc ON cc.id = e.course_campus_id
       JOIN courses c ON c.id = cc.course_id
       JOIN campuses cp ON cp.id = cc.campus_id
       JOIN academic_periods ap ON ap.id = e.period_id
       WHERE e.student_id = $1
         AND e.status = 'ACTIVE'
         AND ($2::bigint IS NULL OR e.course_campus_id = $2)
         AND ($3::bigint IS NULL OR e.period_id = $3)
       ORDER BY a.attendance_date DESC, a.id DESC`,
      [student.id, courseCampusId, periodId],
    );

    return res.json({
      item: {
        assignment,
        attendances: rows,
      },
    });
  }),
);

router.get(
  '/transfers',
  authorizePermission('students.view'),
  validate(studentTransferListSchema),
  asyncHandler(async (req, res) => {
    const campusScopeId = parseCampusScopeId(req);

    const { rows } = await query(
      `SELECT
         tr.id,
         tr.student_id,
         CONCAT_WS(' ', s.first_name, s.last_name) AS student_name,
         s.document_number AS student_document,
         tr.source_enrollment_id,
         tr.approved_enrollment_id,
         tr.source_campus_id,
         cp_source.name AS source_campus_name,
         tr.target_campus_id,
         cp_target.name AS target_campus_name,
         tr.allow_without_target_offering,
         c.id AS course_id,
         c.name AS course_name,
         ap.id AS period_id,
         ap.name AS period_name,
         tr.status,
         tr.request_notes,
         tr.review_notes,
         tr.requested_by,
         CONCAT_WS(' ', u_requested.first_name, u_requested.last_name) AS requested_by_name,
         tr.reviewed_by,
         CONCAT_WS(' ', u_reviewed.first_name, u_reviewed.last_name) AS reviewed_by_name,
         tr.created_at,
         tr.updated_at,
         tr.decided_at,
         CASE
           WHEN $1::bigint IS NULL THEN 'ALL'
           WHEN tr.target_campus_id = $1 THEN 'INCOMING'
           WHEN tr.source_campus_id = $1 THEN 'OUTGOING'
           ELSE 'OTHER'
         END AS direction,
         (
           tr.status = 'PENDING'
           AND $1::bigint IS NOT NULL
           AND tr.target_campus_id = $1
         ) AS can_review
       FROM student_transfer_requests tr
       JOIN students s ON s.id = tr.student_id
       JOIN enrollments e_source ON e_source.id = tr.source_enrollment_id
       JOIN course_campus cc_source ON cc_source.id = e_source.course_campus_id
       JOIN courses c ON c.id = cc_source.course_id
       JOIN academic_periods ap ON ap.id = e_source.period_id
       JOIN campuses cp_source ON cp_source.id = tr.source_campus_id
       JOIN campuses cp_target ON cp_target.id = tr.target_campus_id
       LEFT JOIN users u_requested ON u_requested.id = tr.requested_by
       LEFT JOIN users u_reviewed ON u_reviewed.id = tr.reviewed_by
       WHERE (
         $1::bigint IS NULL
         OR tr.source_campus_id = $1
         OR tr.target_campus_id = $1
       )
       ORDER BY
         CASE WHEN tr.status = 'PENDING' THEN 0 ELSE 1 END,
         tr.created_at DESC,
         tr.id DESC`,
      [campusScopeId],
    );

    return res.json({ items: rows });
  }),
);

router.get(
  '/:id/transfer-options',
  authorizePermission('students.view'),
  validate(studentTransferOptionsSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.validated.params;
    const campusScopeId = parseCampusScopeId(req);

    const studentResult = await query(
      `SELECT
         s.id,
         s.first_name,
         s.last_name,
         s.document_number
       FROM students s
       WHERE s.id = $1
         AND s.status = 'ACTIVE'
         AND (
           $2::bigint IS NULL
           OR EXISTS (
             SELECT 1
             FROM enrollments e_scope
             JOIN course_campus cc_scope ON cc_scope.id = e_scope.course_campus_id
             WHERE e_scope.student_id = s.id
               AND e_scope.status = 'ACTIVE'
               AND cc_scope.campus_id = $2
           )
         )
       LIMIT 1`,
      [id, campusScopeId],
    );

    if (studentResult.rowCount === 0) {
      throw new ApiError(404, 'Alumno no encontrado en la sede activa.');
    }

    const enrollmentResult = await query(
      `SELECT
         e.id AS enrollment_id,
         e.period_id,
         ap.name AS period_name,
         cc_source.campus_id AS source_campus_id,
         cp_source.name AS source_campus_name,
         c.id AS course_id,
         c.name AS course_name
       FROM enrollments e
       JOIN course_campus cc_source ON cc_source.id = e.course_campus_id
       JOIN campuses cp_source ON cp_source.id = cc_source.campus_id
       JOIN courses c ON c.id = cc_source.course_id
       JOIN academic_periods ap ON ap.id = e.period_id
       WHERE e.student_id = $1
         AND e.status = 'ACTIVE'
         AND ($2::bigint IS NULL OR cc_source.campus_id = $2)
       ORDER BY e.created_at DESC, e.id DESC`,
      [id, campusScopeId],
    );

    const enrollmentIds = enrollmentResult.rows.map((row) => Number(row.enrollment_id));
    const targetsByEnrollmentId = new Map();
    const enabledTargetsByEnrollmentId = new Map();
    const allCampusResult = await query(
      `SELECT id AS campus_id, name AS campus_name
       FROM campuses
       ORDER BY name ASC`,
    );
    const allCampuses = allCampusResult.rows.map((row) => ({
      campus_id: Number(row.campus_id),
      campus_name: row.campus_name,
    }));

    if (enrollmentIds.length > 0) {
      const enabledTargetResult = await query(
        `SELECT
           e.id AS enrollment_id,
           cp_target.id AS campus_id,
           cp_target.name AS campus_name
         FROM enrollments e
         JOIN course_campus cc_source ON cc_source.id = e.course_campus_id
         JOIN course_campus cc_target
           ON cc_target.course_id = cc_source.course_id
          AND cc_target.campus_id <> cc_source.campus_id
          AND cc_target.is_active = TRUE
         JOIN campuses cp_target ON cp_target.id = cc_target.campus_id
         WHERE e.id = ANY($1::bigint[])
         ORDER BY cp_target.name ASC`,
        [enrollmentIds],
      );

      for (const row of enabledTargetResult.rows) {
        const key = Number(row.enrollment_id);
        if (!enabledTargetsByEnrollmentId.has(key)) {
          enabledTargetsByEnrollmentId.set(key, []);
        }
        enabledTargetsByEnrollmentId.get(key).push({
          campus_id: Number(row.campus_id),
          campus_name: row.campus_name,
        });
      }

      const targetResult = await query(
        `SELECT
           e.id AS enrollment_id,
           cp_target.id AS campus_id,
           cp_target.name AS campus_name
         FROM enrollments e
         JOIN course_campus cc_source ON cc_source.id = e.course_campus_id
         JOIN course_campus cc_target
           ON cc_target.course_id = cc_source.course_id
          AND cc_target.campus_id <> cc_source.campus_id
          AND cc_target.is_active = TRUE
         JOIN campuses cp_target ON cp_target.id = cc_target.campus_id
         WHERE e.id = ANY($1::bigint[])
           AND NOT EXISTS (
             SELECT 1
             FROM enrollments e_existing
             WHERE e_existing.student_id = e.student_id
               AND e_existing.course_campus_id = cc_target.id
               AND e_existing.period_id = e.period_id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM student_transfer_requests tr_pending
             WHERE tr_pending.source_enrollment_id = e.id
               AND tr_pending.status = 'PENDING'
           )
         ORDER BY cp_target.name ASC`,
        [enrollmentIds],
      );

      for (const row of targetResult.rows) {
        const key = Number(row.enrollment_id);
        if (!targetsByEnrollmentId.has(key)) {
          targetsByEnrollmentId.set(key, []);
        }
        targetsByEnrollmentId.get(key).push({
          campus_id: Number(row.campus_id),
          campus_name: row.campus_name,
        });
      }
    }

    const options = enrollmentResult.rows.map((row) => ({
      ...row,
      course_enabled_campuses: enabledTargetsByEnrollmentId.get(Number(row.enrollment_id)) || [],
      target_campuses: targetsByEnrollmentId.get(Number(row.enrollment_id)) || [],
      all_target_campuses: allCampuses.filter((campus) => Number(campus.campus_id) !== Number(row.source_campus_id)),
    }));

    return res.json({
      item: {
        student: studentResult.rows[0],
        options,
      },
    });
  }),
);

router.post(
  '/transfers',
  authorizePermission('enrollments.manage'),
  validate(studentTransferCreateSchema),
  asyncHandler(async (req, res) => {
    const campusScopeId = parseCampusScopeId(req);
    if (!campusScopeId) {
      throw new ApiError(400, 'Selecciona una sede activa para registrar el traslado.');
    }

    const {
      student_id,
      source_enrollment_id,
      target_campus_id,
      allow_without_target_offering = false,
      request_notes = null,
    } = req.validated.body;
    const normalizedRequestNotes = normalizeOptionalText(request_notes);

    if (Number(target_campus_id) === Number(campusScopeId)) {
      throw new ApiError(400, 'La sede destino debe ser diferente de la sede actual.');
    }

    const created = await withTransaction(async (tx) => {
      const sourceEnrollmentResult = await tx.query(
        `SELECT
           e.id,
           e.student_id,
           e.period_id,
           e.status,
           cc.campus_id AS source_campus_id,
           cc.course_id
         FROM enrollments e
         JOIN course_campus cc ON cc.id = e.course_campus_id
         WHERE e.id = $1
           AND e.student_id = $2
         FOR UPDATE`,
        [source_enrollment_id, student_id],
      );

      if (sourceEnrollmentResult.rowCount === 0) {
        throw new ApiError(404, 'No se encontró la matrícula origen para el traslado.');
      }

      const sourceEnrollment = sourceEnrollmentResult.rows[0];

      if (Number(sourceEnrollment.source_campus_id) !== Number(campusScopeId)) {
        throw new ApiError(403, 'Solo puedes solicitar traslados desde la sede activa.');
      }

      if (sourceEnrollment.status !== 'ACTIVE') {
        throw new ApiError(409, 'Solo se pueden trasladar matrículas activas.');
      }

      const targetCampusResult = await tx.query(`SELECT id FROM campuses WHERE id = $1 LIMIT 1`, [target_campus_id]);
      if (targetCampusResult.rowCount === 0) {
        throw new ApiError(404, 'La sede destino seleccionada no existe.');
      }

      const targetOfferingResult = await tx.query(
        `SELECT id
         FROM course_campus
         WHERE course_id = $1
           AND campus_id = $2
           AND is_active = TRUE
         LIMIT 1`,
        [sourceEnrollment.course_id, target_campus_id],
      );

      if (targetOfferingResult.rowCount === 0 && !allow_without_target_offering) {
        throw new ApiError(409, 'La sede destino no tiene una oferta activa para este curso.');
      }

      if (targetOfferingResult.rowCount > 0) {
        const existingEnrollmentResult = await tx.query(
          `SELECT id
           FROM enrollments
           WHERE student_id = $1
             AND course_campus_id = $2
             AND period_id = $3
           LIMIT 1`,
          [student_id, targetOfferingResult.rows[0].id, sourceEnrollment.period_id],
        );

        if (existingEnrollmentResult.rowCount > 0) {
          throw new ApiError(409, 'El alumno ya tiene una matrícula registrada en la sede destino para ese periodo.');
        }
      }

      const pendingResult = await tx.query(
        `SELECT id
         FROM student_transfer_requests
         WHERE source_enrollment_id = $1
           AND status = 'PENDING'
         LIMIT 1`,
        [source_enrollment_id],
      );

      if (pendingResult.rowCount > 0) {
        throw new ApiError(409, 'La matrícula ya tiene una solicitud de traslado pendiente.');
      }

      const createdResult = await tx.query(
        `INSERT INTO student_transfer_requests (
           student_id,
           source_enrollment_id,
           source_campus_id,
           target_campus_id,
           allow_without_target_offering,
           requested_by,
           request_notes
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, student_id, source_enrollment_id, source_campus_id, target_campus_id, allow_without_target_offering, status, created_at`,
        [
          student_id,
          source_enrollment_id,
          sourceEnrollment.source_campus_id,
          target_campus_id,
          allow_without_target_offering,
          req.user.id,
          normalizedRequestNotes,
        ],
      );

      return createdResult.rows[0];
    });

    return res.status(201).json({ message: 'Solicitud de traslado registrada.', item: created });
  }),
);

router.patch(
  '/transfers/:transferId/decision',
  authorizePermission('enrollments.manage'),
  validate(studentTransferDecisionSchema),
  asyncHandler(async (req, res) => {
    const campusScopeId = parseCampusScopeId(req);
    if (!campusScopeId) {
      throw new ApiError(400, 'Selecciona la sede destino activa para revisar el traslado.');
    }

    const { transferId } = req.validated.params;
    const { decision, review_notes = null } = req.validated.body;
    const normalizedReviewNotes = normalizeOptionalText(review_notes);

    if (decision === 'REJECT' && !normalizedReviewNotes) {
      throw new ApiError(400, 'Debes indicar un motivo para rechazar el traslado.');
    }

    const resolved = await withTransaction(async (tx) => {
      const transferResult = await tx.query(
        `SELECT
           tr.id,
           tr.student_id,
           tr.source_enrollment_id,
           tr.source_campus_id,
           tr.target_campus_id,
           tr.allow_without_target_offering,
           tr.status,
           e.period_id,
           e.status AS source_enrollment_status,
           cc_source.course_id
         FROM student_transfer_requests tr
         JOIN enrollments e ON e.id = tr.source_enrollment_id
         JOIN course_campus cc_source ON cc_source.id = e.course_campus_id
         WHERE tr.id = $1
         FOR UPDATE`,
        [transferId],
      );

      if (transferResult.rowCount === 0) {
        throw new ApiError(404, 'Solicitud de traslado no encontrada.');
      }

      const transfer = transferResult.rows[0];

      if (Number(transfer.target_campus_id) !== Number(campusScopeId)) {
        throw new ApiError(403, 'Solo la sede destino puede revisar esta solicitud de traslado.');
      }

      if (transfer.status !== 'PENDING') {
        throw new ApiError(409, 'La solicitud ya fue atendida.');
      }

      if (decision === 'REJECT') {
        const rejectResult = await tx.query(
          `UPDATE student_transfer_requests
           SET status = 'REJECTED',
               reviewed_by = $1,
               review_notes = $2,
               decided_at = NOW(),
               updated_at = NOW()
           WHERE id = $3
           RETURNING id, status, review_notes, decided_at`,
          [req.user.id, normalizedReviewNotes, transferId],
        );

        return {
          ...rejectResult.rows[0],
          moved_installments: 0,
          approved_enrollment_id: null,
        };
      }

      if (transfer.source_enrollment_status !== 'ACTIVE') {
        throw new ApiError(409, 'La matrícula origen ya no está activa. No se puede aprobar el traslado.');
      }

      const targetOfferingResult = await tx.query(
        `SELECT id
         FROM course_campus
         WHERE course_id = $1
           AND campus_id = $2
           AND is_active = TRUE
         LIMIT 1`,
        [transfer.course_id, transfer.target_campus_id],
      );

      if (targetOfferingResult.rowCount === 0 && !transfer.allow_without_target_offering) {
        throw new ApiError(409, 'La sede destino no tiene una oferta activa para este curso.');
      }

      const targetCourseCampusId = targetOfferingResult.rows[0]?.id || null;

      if (targetCourseCampusId) {
        const existingEnrollmentResult = await tx.query(
          `SELECT id
           FROM enrollments
           WHERE student_id = $1
             AND course_campus_id = $2
             AND period_id = $3
           LIMIT 1`,
          [transfer.student_id, targetCourseCampusId, transfer.period_id],
        );

        if (existingEnrollmentResult.rowCount > 0) {
          throw new ApiError(409, 'El alumno ya tiene una matrícula registrada en la sede destino para ese periodo.');
        }
      }

      await tx.query(
        `UPDATE enrollments
         SET status = 'TRANSFERRED',
             updated_at = NOW()
         WHERE id = $1`,
        [transfer.source_enrollment_id],
      );

      let approvedEnrollmentId = null;
      let movedInstallmentsCount = 0;

      if (targetCourseCampusId) {
        const createdEnrollmentResult = await tx.query(
          `INSERT INTO enrollments (student_id, course_campus_id, period_id, enrollment_date, status, created_by)
           VALUES ($1, $2, $3, CURRENT_DATE, 'ACTIVE', $4)
           RETURNING id`,
          [transfer.student_id, targetCourseCampusId, transfer.period_id, req.user.id],
        );

        approvedEnrollmentId = createdEnrollmentResult.rows[0].id;

        const movedInstallmentsResult = await tx.query(
          `UPDATE installments
           SET enrollment_id = $1,
               updated_at = NOW()
           WHERE enrollment_id = $2
             AND status IN ('PENDING', 'PARTIAL')
           RETURNING id`,
          [approvedEnrollmentId, transfer.source_enrollment_id],
        );

        movedInstallmentsCount = movedInstallmentsResult.rowCount;
      }

      await tx.query(
        `UPDATE students
         SET assigned_campus_id = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [transfer.target_campus_id, transfer.student_id],
      );

      const approveResult = await tx.query(
        `UPDATE student_transfer_requests
         SET status = 'APPROVED',
             reviewed_by = $1,
             review_notes = $2,
             approved_enrollment_id = $3,
             decided_at = NOW(),
             updated_at = NOW()
         WHERE id = $4
         RETURNING id, status, review_notes, decided_at, approved_enrollment_id`,
        [req.user.id, normalizedReviewNotes, approvedEnrollmentId, transferId],
      );

      return {
        ...approveResult.rows[0],
        moved_installments: movedInstallmentsCount,
      };
    });

    return res.json({
      message:
        decision === 'APPROVE'
          ? resolved.approved_enrollment_id
            ? 'Traslado aprobado y matrícula creada en la sede destino.'
            : 'Traslado aprobado sin necesidad de crear matrícula en la sede destino.'
          : 'Solicitud de traslado rechazada.',
      item: resolved,
    });
  }),
);

router.get(
  '/:id',
  authorizePermission('students.view'),
  validate(
    z.object({
      body: z.object({}).optional(),
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({}).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { id } = req.validated.params;
    const campusScopeId = parseCampusScopeId(req);

    const studentResult = await query(
      `SELECT
          s.id,
          s.first_name,
          s.last_name,
          s.document_number,
          s.birth_date,
	          s.email,
	          s.phone,
	          s.address,
	          s.notes,
	          s.assigned_campus_id,
          cp_assigned.name AS assigned_campus_name,
          cp_assigned.city AS assigned_campus_city,
          s.user_id,
          COALESCE(u_access.is_active, FALSE) AS access_is_active,
          s.created_by,
          CONCAT_WS(' ', u_creator.first_name, u_creator.last_name) AS created_by_name,
          s.status,
          s.created_at
       FROM students s
       LEFT JOIN campuses cp_assigned ON cp_assigned.id = s.assigned_campus_id
       LEFT JOIN users u_creator ON u_creator.id = s.created_by
       LEFT JOIN users u_access ON u_access.id = s.user_id
       WHERE s.id = $1`,
      [id],
    );

    if (studentResult.rowCount === 0) {
      throw new ApiError(404, 'Alumno no encontrado.');
    }

    const guardianResult = await query(
      `SELECT g.id, g.first_name, g.last_name, g.email, g.phone, sg.relationship
       FROM student_guardian sg
       JOIN guardians g ON g.id = sg.guardian_id
       WHERE sg.student_id = $1`,
      [id],
    );

    const enrollmentResult = await query(
      `SELECT
          e.id,
	          e.status,
	          e.enrollment_date,
	          e.notes,
	          e.period_id,
          p.name AS period_name,
          p.start_date AS period_start_date,
          p.end_date AS period_end_date,
          p.start_date AS course_start_date,
          p.end_date AS course_end_date,
          c.id AS course_id,
          c.name AS course_name,
          c.duration_hours,
          cc.campus_id,
          cp.name AS campus_name,
          cp.city AS campus_city,
          cc.modality
       FROM enrollments e
       JOIN academic_periods p ON p.id = e.period_id
       JOIN course_campus cc ON cc.id = e.course_campus_id
       JOIN courses c ON c.id = cc.course_id
       JOIN campuses cp ON cp.id = cc.campus_id
       WHERE e.student_id = $1
       ORDER BY
         CASE WHEN e.status = 'ACTIVE' THEN 0 ELSE 1 END,
         COALESCE(p.end_date, e.enrollment_date) DESC,
         e.updated_at DESC,
         e.id DESC`,
      [id],
    );

    const enrollments = enrollmentResult.rows.map((row) => decorateEnrollmentWithCertificateEligibility(row));
    const scopedEnrollments = campusScopeId
      ? enrollments.filter((row) => Number(row.campus_id) === Number(campusScopeId))
      : enrollments;
    const preferredCertificateEnrollment = pickPreferredCertificateEnrollment(scopedEnrollments, {
      allowIneligible: true,
    });

    return res.json({
      item: {
        ...studentResult.rows[0],
        guardians: guardianResult.rows,
        enrollments,
        preferred_certificate_enrollment: preferredCertificateEnrollment,
        has_certificate_eligible_enrollment: scopedEnrollments.some((row) => row.certificate_eligible),
      },
    });
  }),
);

router.post(
  '/',
  authorizePermission('students.manage'),
  validate(studentSchema),
  asyncHandler(async (req, res) => {
    const {
      first_name,
      last_name,
      document_number,
      birth_date,
      email = null,
      phone = null,
      address = null,
      notes = null,
      guardian_links = [],
      guardian_payload = null,
      no_guardian = true,
      enrollment = null,
    } = req.validated.body;
    const normalizedEmail = normalizeOptionalEmail(email);
    const normalizedDocumentNumber = normalizeDocumentNumber(document_number);

    if (enrollment) {
      const canManageEnrollments = await userHasPermission(req.user.id, 'enrollments.manage');
      if (!canManageEnrollments) {
        throw new ApiError(403, 'No tiene permisos para registrar una matrícula al crear alumno.');
      }
    }

    const created = await withTransaction(async (tx) => {
      const roleResult = await tx.query(`SELECT id FROM roles WHERE name = $1`, [STUDENT_ROLE_NAME]);
      if (roleResult.rowCount === 0) {
        throw new ApiError(500, `No existe el rol ${STUDENT_ROLE_NAME}.`);
      }

      let initialAssignedCampusId = null;
      let resolvedEnrollmentScheduleInfo = null;
      if (enrollment?.course_campus_id) {
        const assignedCampusResult = await tx.query(
          `SELECT cc.campus_id, cc.schedule_info, cc.is_active AS offering_is_active, c.is_active AS course_is_active
           FROM course_campus cc
           JOIN courses c ON c.id = cc.course_id
           WHERE cc.id = $1
           LIMIT 1`,
          [enrollment.course_campus_id],
        );

        if (assignedCampusResult.rowCount === 0) {
          throw new ApiError(404, 'El curso seleccionado no existe.');
        }

        const assignedOffering = assignedCampusResult.rows[0];
        if (!assignedOffering.offering_is_active || !assignedOffering.course_is_active) {
          throw new ApiError(409, 'No se puede matricular al alumno en un curso inactivo.');
        }

        initialAssignedCampusId = assignedCampusResult.rows[0]?.campus_id || null;
        resolvedEnrollmentScheduleInfo = resolveEnrollmentScheduleInfo(
          assignedOffering.schedule_info,
          enrollment.schedule_info,
        );
      }

      const duplicatedDocumentResult = await tx.query(
        `SELECT id
         FROM students
         WHERE UPPER(REGEXP_REPLACE(document_number, '\\s+', '', 'g')) =
               UPPER(REGEXP_REPLACE($1, '\\s+', '', 'g'))
         LIMIT 1`,
        [normalizedDocumentNumber],
      );
      if (duplicatedDocumentResult.rowCount > 0) {
        throw new ApiError(409, 'El documento ya está registrado en otro alumno.');
      }

      const duplicatedUserDocumentResult = await tx.query(
        `SELECT id
         FROM users
         WHERE UPPER(REGEXP_REPLACE(COALESCE(document_number, ''), '\\s+', '', 'g')) = $1
         LIMIT 1`,
        [normalizedDocumentNumber],
      );
      if (duplicatedUserDocumentResult.rowCount > 0) {
        throw new ApiError(409, 'El documento ya está registrado por otro usuario.');
      }

      if (normalizedEmail) {
        const emailExistsResult = await tx.query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);
        if (emailExistsResult.rowCount > 0) {
          throw new ApiError(409, 'El correo del alumno ya está registrado en usuarios.');
        }
      }

      const studentUserBaseEmail = normalizedEmail || buildStudentEmailFromDocument(normalizedDocumentNumber);
      const studentUserEmail = await ensureUniqueUserEmail(tx, studentUserBaseEmail);
      const studentInitialPassword = buildStudentInitialPassword(normalizedDocumentNumber);
      const studentPasswordHash = await bcrypt.hash(studentInitialPassword, 12);

      const studentUserResult = await tx.query(
        `INSERT INTO users (first_name, last_name, document_number, email, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email`,
        [first_name, last_name, normalizedDocumentNumber, studentUserEmail, studentPasswordHash],
      );
      const studentUser = studentUserResult.rows[0];

      await tx.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [studentUser.id, roleResult.rows[0].id],
      );

      const studentResult = await tx.query(
        `INSERT INTO students (
           first_name,
           last_name,
           document_number,
           birth_date,
           email,
           phone,
           address,
           notes,
           assigned_campus_id,
           created_by,
           user_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, first_name, last_name, document_number, birth_date, email, phone, address, notes, assigned_campus_id, created_by, user_id, status, created_at`,
        [
          first_name,
          last_name,
          normalizedDocumentNumber,
          birth_date,
          studentUserEmail,
          phone,
          address,
          normalizeOptionalText(notes),
          initialAssignedCampusId,
          req.user.id,
          studentUser.id,
        ],
      );

      const student = studentResult.rows[0];

      const effectiveGuardianLinks = guardian_links.slice();

      if (!no_guardian && guardian_payload) {
        const guardianInsertResult = await tx.query(
          `INSERT INTO guardians (first_name, last_name, email, phone, document_number)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            guardian_payload.first_name.trim(),
            guardian_payload.last_name.trim(),
            normalizeOptionalEmail(guardian_payload.email),
            guardian_payload.phone ? guardian_payload.phone.trim() : null,
            guardian_payload.document_number ? guardian_payload.document_number.trim() : null,
          ],
        );

        effectiveGuardianLinks.push({
          guardian_id: guardianInsertResult.rows[0].id,
          relationship: guardian_payload.relationship || 'APODERADO',
        });
      }

      if (!no_guardian && effectiveGuardianLinks.length === 0) {
        throw new ApiError(
          400,
          'Debe registrar al menos un apoderado/persona a cargo o marcar la opción "Sin apoderado".',
        );
      }

      for (const link of effectiveGuardianLinks) {
        await tx.query(
          `INSERT INTO student_guardian (student_id, guardian_id, relationship)
           VALUES ($1, $2, $3)
           ON CONFLICT (student_id, guardian_id)
           DO UPDATE SET relationship = EXCLUDED.relationship`,
          [student.id, link.guardian_id, link.relationship || null],
        );
      }

      const guardianResult = await tx.query(
        `SELECT g.id, g.first_name, g.last_name, g.email, g.phone, sg.relationship
         FROM student_guardian sg
         JOIN guardians g ON g.id = sg.guardian_id
         WHERE sg.student_id = $1`,
        [student.id],
      );

      let createdEnrollment = null;
      if (enrollment) {
        const enrollmentResult = await tx.query(
          `INSERT INTO enrollments (
             student_id,
             course_campus_id,
             period_id,
             enrollment_date,
             status,
             schedule_info,
             notes,
             created_by
           )
           VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7, $8)
           RETURNING id`,
          [
            student.id,
            enrollment.course_campus_id,
            enrollment.period_id,
            enrollment.enrollment_date || null,
            enrollment.status || 'ACTIVE',
            resolvedEnrollmentScheduleInfo,
            normalizeOptionalText(enrollment.notes),
            req.user.id,
          ],
        );

        const createdEnrollmentId = enrollmentResult.rows[0].id;
        const enrollmentDetailResult = await tx.query(
          `SELECT
              e.id,
              e.status,
              e.enrollment_date,
              e.notes,
              e.student_id,
              e.course_campus_id,
              e.period_id,
              e.schedule_info,
              p.name AS period_name,
              c.name AS course_name,
              cp.name AS campus_name,
              cc.modality
           FROM enrollments e
           JOIN academic_periods p ON p.id = e.period_id
           JOIN course_campus cc ON cc.id = e.course_campus_id
           JOIN courses c ON c.id = cc.course_id
           JOIN campuses cp ON cp.id = cc.campus_id
           WHERE e.id = $1`,
          [createdEnrollmentId],
        );

        createdEnrollment = enrollmentDetailResult.rows[0] || null;
      }

      const creatorResult = await tx.query(
        `SELECT CONCAT_WS(' ', first_name, last_name) AS created_by_name
         FROM users
         WHERE id = $1`,
        [student.created_by],
      );

      return {
        ...student,
        created_by_name: creatorResult.rows[0]?.created_by_name || null,
        guardians: guardianResult.rows,
        enrollment: createdEnrollment,
        access_user: {
          user_id: studentUser.id,
          email: studentUser.email,
          initial_password: studentInitialPassword,
          role: STUDENT_ROLE_NAME,
        },
      };
    });

    return res.status(201).json({ message: 'Alumno creado.', item: created });
  }),
);

router.put(
  '/:id',
  authorizePermission('students.manage'),
  validate(
    z.object({
      body: studentSchema.shape.body.omit({
        guardian_links: true,
        guardian_payload: true,
        no_guardian: true,
        enrollment: true,
      }),
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({}).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { id } = req.validated.params;
    const {
      first_name,
      last_name,
      document_number,
      birth_date,
      email = null,
      phone = null,
      address = null,
      notes = null,
    } = req.validated.body;
    const normalizedEmail = normalizeOptionalEmail(email);
    const normalizedDocumentNumber = normalizeDocumentNumber(document_number);

    const updated = await withTransaction(async (tx) => {
      const studentResult = await tx.query(
        `SELECT id, user_id, email
         FROM students
         WHERE id = $1`,
        [id],
      );

      if (studentResult.rowCount === 0) {
        throw new ApiError(404, 'Alumno no encontrado.');
      }

      const student = studentResult.rows[0];
      let resolvedEmail = normalizedEmail;

      const duplicatedDocumentResult = await tx.query(
        `SELECT id
         FROM students
         WHERE id <> $2
           AND UPPER(REGEXP_REPLACE(document_number, '\\s+', '', 'g')) =
               UPPER(REGEXP_REPLACE($1, '\\s+', '', 'g'))
         LIMIT 1`,
        [normalizedDocumentNumber, id],
      );
      if (duplicatedDocumentResult.rowCount > 0) {
        throw new ApiError(409, 'El documento ya está registrado en otro alumno.');
      }

      const duplicatedUserDocumentResult = await tx.query(
        `SELECT id
         FROM users
         WHERE UPPER(REGEXP_REPLACE(COALESCE(document_number, ''), '\\s+', '', 'g')) = $1
           AND ($2::bigint IS NULL OR id <> $2)
         LIMIT 1`,
        [normalizedDocumentNumber, student.user_id || null],
      );
      if (duplicatedUserDocumentResult.rowCount > 0) {
        throw new ApiError(409, 'El documento ya está registrado por otro usuario.');
      }

      if (student.user_id) {
        const userResult = await tx.query(`SELECT id, email FROM users WHERE id = $1`, [student.user_id]);
        if (userResult.rowCount > 0) {
          const baseEmail =
            normalizedEmail || userResult.rows[0].email || buildStudentEmailFromDocument(normalizedDocumentNumber);
          resolvedEmail = await ensureUniqueUserEmail(tx, baseEmail, student.user_id);

          await tx.query(
            `UPDATE users
             SET first_name = $1,
                 last_name = $2,
                 document_number = $3,
                 email = $4,
                 updated_at = NOW()
             WHERE id = $5`,
            [first_name, last_name, normalizedDocumentNumber, resolvedEmail, student.user_id],
          );
        }
      }

      if (!resolvedEmail) {
        resolvedEmail = student.email || buildStudentEmailFromDocument(normalizedDocumentNumber);
      }

      const updateResult = await tx.query(
        `UPDATE students
         SET first_name = $1,
             last_name = $2,
             document_number = $3,
             birth_date = $4,
	             email = $5,
	             phone = $6,
	             address = $7,
	             notes = $8,
	             updated_at = NOW()
	         WHERE id = $9
	         RETURNING id, first_name, last_name, document_number, birth_date, email, phone, address, notes, user_id, status, updated_at`,
        [
          first_name,
          last_name,
          normalizedDocumentNumber,
          birth_date,
          resolvedEmail,
          phone,
          address,
          normalizeOptionalText(notes),
          id,
        ],
      );

      return updateResult.rows[0];
    });

    return res.json({ message: 'Alumno actualizado.', item: updated });
  }),
);

router.post(
  '/:id/guardians',
  authorizePermission('students.manage'),
  validate(
    z.object({
      body: z.object({
        guardian_id: z.number().int().positive(),
        relationship: z.string().max(60).nullable().optional(),
      }),
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({}).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { id } = req.validated.params;
    const { guardian_id, relationship = null } = req.validated.body;

    const studentExists = await query('SELECT id FROM students WHERE id = $1', [id]);
    if (studentExists.rowCount === 0) {
      throw new ApiError(404, 'Alumno no encontrado.');
    }

    await query(
      `INSERT INTO student_guardian (student_id, guardian_id, relationship)
       VALUES ($1, $2, $3)
       ON CONFLICT (student_id, guardian_id)
       DO UPDATE SET relationship = EXCLUDED.relationship`,
      [id, guardian_id, relationship],
    );

    return res.status(201).json({ message: 'Apoderado vinculado al alumno.' });
  }),
);

router.delete(
  '/:id',
  authorizePermission('students.manage'),
  validate(
    z.object({
      body: z.object({}).optional(),
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({}).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { id } = req.validated.params;

    const deleteMode = await withTransaction(async (tx) => {
      const studentResult = await tx.query(
        `SELECT id, user_id
         FROM students
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );
      if (studentResult.rowCount === 0) {
        throw new ApiError(404, 'Alumno no encontrado.');
      }

      const student = studentResult.rows[0];
      let mode = 'hard';

      try {
        await tx.query(`DELETE FROM students WHERE id = $1`, [id]);
      } catch (error) {
        if (error.code !== '23503') {
          throw error;
        }

        mode = 'soft';

        await tx.query(
          `UPDATE students
           SET status = 'INACTIVE',
               updated_at = NOW()
           WHERE id = $1`,
          [id],
        );

        await tx.query(
          `UPDATE enrollments
           SET status = 'CANCELED',
               updated_at = NOW()
           WHERE student_id = $1
             AND status = 'ACTIVE'`,
          [id],
        );
      }

      if (student.user_id) {
        const studentRoleResult = await tx.query(`SELECT id FROM roles WHERE name = $1 LIMIT 1`, [STUDENT_ROLE_NAME]);
        if (studentRoleResult.rowCount > 0) {
          await tx.query(
            `DELETE FROM user_roles
             WHERE user_id = $1
               AND role_id = $2`,
            [student.user_id, studentRoleResult.rows[0].id],
          );
        }

        const remainingRolesResult = await tx.query(
          `SELECT COUNT(*)::int AS total
           FROM user_roles
           WHERE user_id = $1`,
          [student.user_id],
        );
        const remainingRoles = Number(remainingRolesResult.rows[0]?.total || 0);

        if (remainingRoles === 0) {
          await tx.query(
            `UPDATE users
             SET is_active = FALSE,
                 updated_at = NOW()
             WHERE id = $1`,
            [student.user_id],
          );
        }

        await tx.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [student.user_id]);
        invalidateUserPermissionCache(student.user_id);
      }

      return mode;
    });

    return res.json({
      message:
        deleteMode === 'hard'
          ? 'Alumno eliminado.'
          : 'Alumno inactivado y matrículas activas canceladas por tener registros relacionados.',
    });
  }),
);

module.exports = router;
