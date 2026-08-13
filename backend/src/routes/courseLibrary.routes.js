const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { z } = require('zod');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const validate = require('../middlewares/validate');
const { authenticate } = require('../middlewares/auth');
const { parseCampusScopeId } = require('../utils/campusScope');
const { getUserPermissionCodes } = require('../services/permissions.service');
const {
  removeUploadedFileQuietly,
  validateUploadedFileSignature,
} = require('../utils/fileValidation');

const router = express.Router();

const COURSE_LIBRARY_MAX_SIZE_BYTES = 15 * 1024 * 1024;
const courseLibraryDir = path.resolve(__dirname, '..', '..', 'uploads', 'course-library');
const courseLibraryMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const courseLibraryExtensions = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.zip',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]);
const courseLibraryGenericMimeTypes = new Set(['application/octet-stream']);

fs.mkdirSync(courseLibraryDir, { recursive: true });

const courseLibraryUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, courseLibraryDir),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname || '').toLowerCase();
      const safeExtension = /^[.a-z0-9]+$/.test(extension) ? extension.slice(0, 12) : '';
      callback(null, `${Date.now()}-${crypto.randomUUID()}${safeExtension}`);
    },
  }),
  limits: {
    fileSize: COURSE_LIBRARY_MAX_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || '').toLowerCase();
    if (!courseLibraryMimeTypes.has(mimeType)) {
      return callback(
        new ApiError(
          400,
          'Formato no permitido. Usa PDF, Office, TXT, ZIP o imagenes JPG/PNG/WEBP.',
        ),
      );
    }
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!courseLibraryExtensions.has(extension)) {
      return callback(
        new ApiError(
          400,
          'Extension no permitida. Usa PDF, Office, TXT, ZIP o imagenes JPG/PNG/WEBP.',
        ),
      );
    }

    return callback(null, true);
  },
});

const assignmentParamsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ assignmentId: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const resourceDeleteSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    assignmentId: z.coerce.number().int().positive(),
    resourceId: z.coerce.number().int().positive(),
  }),
  query: z.object({}).optional(),
});

const resourceFileSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    assignmentId: z.coerce.number().int().positive(),
    resourceId: z.coerce.number().int().positive(),
  }),
  query: z
    .object({
      download: z.string().optional(),
    })
    .optional(),
});

const createResourceBodySchema = z.object({
  title: z.string().trim().min(2).max(180).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

const normalizeOptionalText = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const getCurrentStudentProfile = async (req) => {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  if (!roles.includes('ALUMNO')) {
    throw new ApiError(403, 'Esta vista esta disponible solo para perfiles de alumno.');
  }

  const profileResult = await query(
    `SELECT id, user_id, email
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
    throw new ApiError(404, 'No se encontro un perfil de alumno vinculado al usuario.');
  }

  return profileResult.rows[0];
};

const getRequestProtocol = (req) => {
  const forwarded = req.headers['x-forwarded-proto'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.protocol || 'http';
};

const getFrontendOrigin = (req) => {
  const headerCandidates = [req.headers['x-frontend-origin'], req.headers.origin, req.headers.referer];

  for (const candidate of headerCandidates) {
    const rawValue = Array.isArray(candidate) ? candidate[0] : candidate;
    if (typeof rawValue !== 'string' || !rawValue.trim()) continue;

    try {
      const parsed = new URL(rawValue.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      return parsed.origin;
    } catch (_error) {
      continue;
    }
  }

  return '';
};

const buildFrontendAwareAbsoluteUrl = (req, relativePath) => {
  const normalizedRelativePath = String(relativePath || '').trim();
  if (!normalizedRelativePath) return '';

  const frontendOrigin = getFrontendOrigin(req);
  if (frontendOrigin) {
    return `${frontendOrigin}${normalizedRelativePath}`;
  }

  const host = req.get('host');
  if (!host) return normalizedRelativePath;

  return `${getRequestProtocol(req)}://${host}${normalizedRelativePath}`;
};

const buildCourseLibraryStorageUrl = (req, fileName) => {
  const encodedFileName = encodeURIComponent(fileName);
  const relativeUrl = `/api/uploads/course-library/${encodedFileName}`;
  return buildFrontendAwareAbsoluteUrl(req, relativeUrl);
};

const buildCourseLibraryFileUrl = (req, assignmentId, resourceId) => {
  const relativeUrl = `/api/course-library/assignments/${assignmentId}/resources/${resourceId}/file`;
  return buildFrontendAwareAbsoluteUrl(req, relativeUrl);
};

const toDownloadFlag = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'si';
};

const toSafeHeaderFilename = (fileName = 'archivo') => {
  const normalized = String(fileName || 'archivo').trim() || 'archivo';
  return normalized.replace(/[^\w.\- ]+/g, '_').slice(0, 180) || 'archivo';
};

const assertResolvedPathInsideDir = (filePath, baseDir) => {
  const resolvedFilePath = path.resolve(filePath || '');
  const resolvedBaseDir = path.resolve(baseDir);
  if (!resolvedFilePath.startsWith(`${resolvedBaseDir}${path.sep}`)) {
    throw new ApiError(400, 'Ruta de archivo invalida.');
  }
  return resolvedFilePath;
};

const sendProtectedFile = (res, { filePath, fileName, mimeType, download = false }) => {
  const resolvedFilePath = assertResolvedPathInsideDir(filePath, courseLibraryDir);
  if (!fs.existsSync(resolvedFilePath)) {
    throw new ApiError(404, 'Archivo no encontrado en el servidor.');
  }

  const safeFileName = toSafeHeaderFilename(fileName);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${safeFileName}"`,
  );
  if (mimeType) {
    res.type(mimeType);
  }

  return res.sendFile(resolvedFilePath);
};

const removeStoredFile = (filePath) => {
  if (!filePath) return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_error) {
    // Ignoramos errores de limpieza para no romper la respuesta principal.
  }
};

const parseCreateResourceBody = (body) => {
  const parsed = createResourceBodySchema.safeParse({
    title: normalizeOptionalText(body?.title),
    description: normalizeOptionalText(body?.description),
  });

  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message || 'Datos invalidos para el archivo.');
  }

  return parsed.data;
};

const getUserPermissionCodesSafe = async (req) => {
  if (Array.isArray(req.user?.permissionCodes)) {
    return req.user.permissionCodes;
  }

  const codes = await getUserPermissionCodes(req.user.id);
  req.user.permissionCodes = codes;
  return codes;
};

const getTeacherAssignmentAccess = async (req, assignmentId) => {
  const permissionCodes = await getUserPermissionCodesSafe(req);
  const canViewAssignments =
    permissionCodes.includes('teachers.assignments.view') ||
    permissionCodes.includes('teachers.assignments.manage');

  if (!canViewAssignments) {
    return null;
  }

  const canManageAssignments = permissionCodes.includes('teachers.assignments.manage');
  const campusScopeId = parseCampusScopeId(req);
  const assignmentResult = await query(
    `SELECT
       ta.id AS assignment_id,
       ta.teacher_user_id,
       ta.course_campus_id,
       ta.period_id,
       c.id AS course_id,
       c.name AS course_name,
       cp.id AS campus_id,
       cp.name AS campus_name,
       cc.modality,
       COALESCE(ta.schedule_info, cc.schedule_info) AS classroom_info,
       ap.name AS period_name,
       CONCAT(u_t.first_name, ' ', u_t.last_name) AS teacher_name
     FROM teacher_assignments ta
     JOIN users u_t ON u_t.id = ta.teacher_user_id
     JOIN course_campus cc ON cc.id = ta.course_campus_id
     JOIN courses c ON c.id = cc.course_id
     JOIN campuses cp ON cp.id = cc.campus_id
     JOIN academic_periods ap ON ap.id = ta.period_id
     WHERE ta.id = $1
       AND ta.status = 'ACTIVE'
       AND ($2::bigint IS NULL OR cp.id = $2)
       AND ($3::boolean = TRUE OR ta.teacher_user_id = $4)
     LIMIT 1`,
    [assignmentId, campusScopeId, canManageAssignments, req.user.id],
  );

  if (!assignmentResult.rowCount) {
    return null;
  }

  return {
    assignment: assignmentResult.rows[0],
    canWrite:
      canManageAssignments ||
      Number(assignmentResult.rows[0].teacher_user_id) === Number(req.user.id),
  };
};

const getStudentAssignmentAccess = async (req, assignmentId) => {
  const student = await getCurrentStudentProfile(req);
  const assignmentResult = await query(
    `SELECT
       ta.id AS assignment_id,
       ta.teacher_user_id,
       ta.course_campus_id,
       ta.period_id,
       c.id AS course_id,
       c.name AS course_name,
       cp.id AS campus_id,
       cp.name AS campus_name,
       cc.modality,
       COALESCE(ta.schedule_info, cc.schedule_info) AS classroom_info,
       ap.name AS period_name,
       CONCAT(u_t.first_name, ' ', u_t.last_name) AS teacher_name
     FROM teacher_assignments ta
     JOIN users u_t ON u_t.id = ta.teacher_user_id
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
    throw new ApiError(404, 'No se encontro el salon solicitado para este alumno.');
  }

  return {
    assignment: assignmentResult.rows[0],
    canWrite: false,
  };
};

const resolveAssignmentAccess = async (req, assignmentId, { requireWrite = false } = {}) => {
  const teacherAccess = await getTeacherAssignmentAccess(req, assignmentId);
  if (teacherAccess) {
    if (requireWrite && !teacherAccess.canWrite) {
      throw new ApiError(403, 'No tienes permisos para gestionar archivos en este salon.');
    }
    return teacherAccess;
  }

  if (!requireWrite && Array.isArray(req.user?.roles) && req.user.roles.includes('ALUMNO')) {
    return getStudentAssignmentAccess(req, assignmentId);
  }

  throw new ApiError(
    requireWrite ? 403 : 404,
    requireWrite
      ? 'No tienes permisos para gestionar archivos en este salon.'
      : 'No se encontro el salon solicitado.',
  );
};

const uploadCourseLibraryResource = (req, res, next) => {
  courseLibraryUpload.single('file')(req, res, (error) => {
    if (!error) {
      if (!req.file) return next();

      try {
        validateUploadedFileSignature({
          filePath: req.file.path,
          originalName: req.file.originalname,
          mimetype: req.file.mimetype,
          allowedExtensions: courseLibraryExtensions,
          allowedMimeTypes: courseLibraryMimeTypes,
          genericMimeTypes: courseLibraryGenericMimeTypes,
          label: 'archivo',
        });
        return next();
      } catch (validationError) {
        removeUploadedFileQuietly(req.file.path);
        return next(validationError);
      }
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(
        new ApiError(400, 'El archivo excede el limite permitido de 15 MB para el aula virtual.'),
      );
    }

    if (error) {
      return next(error);
    }

    return next();
  });
};

const resolveStoredResourcePath = (fileUrl) => {
  const normalizedUrl = String(fileUrl || '').trim();
  if (!normalizedUrl) return null;

  try {
    const parsed = new URL(normalizedUrl);
    if (!parsed.pathname.startsWith('/api/uploads/course-library/')) return null;
    return path.resolve(courseLibraryDir, path.basename(decodeURIComponent(parsed.pathname)));
  } catch (_error) {
    if (!normalizedUrl.startsWith('/api/uploads/course-library/')) return null;
    return path.resolve(courseLibraryDir, path.basename(decodeURIComponent(normalizedUrl)));
  }
};

router.use(authenticate);

router.get(
  '/assignments/:assignmentId/resources',
  validate(assignmentParamsSchema),
  asyncHandler(async (req, res) => {
    const { assignmentId } = req.validated.params;
    const access = await resolveAssignmentAccess(req, assignmentId);

    const { rows } = await query(
      `SELECT
         r.id,
         r.assignment_id,
         r.course_campus_id,
         r.period_id,
         r.uploaded_by_user_id,
         r.title,
         r.description,
         r.file_name,
         r.file_url,
         r.mime_type,
         r.file_size_bytes,
         r.created_at,
         r.updated_at,
         CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM course_library_resources r
       LEFT JOIN users u ON u.id = r.uploaded_by_user_id
       WHERE r.assignment_id = $1
       ORDER BY r.created_at DESC, r.id DESC`,
      [assignmentId],
    );

    const items = rows.map((row) => ({
      ...row,
      file_url: buildCourseLibraryFileUrl(req, assignmentId, row.id),
    }));

    return res.json({
      item: access.assignment,
      items,
      meta: {
        can_write: Boolean(access.canWrite),
      },
    });
  }),
);

router.get(
  '/assignments/:assignmentId/resources/:resourceId/file',
  validate(resourceFileSchema),
  asyncHandler(async (req, res) => {
    const { assignmentId, resourceId } = req.validated.params;
    await resolveAssignmentAccess(req, assignmentId);

    const resourceResult = await query(
      `SELECT id, assignment_id, file_name, file_url, mime_type
       FROM course_library_resources
       WHERE id = $1
         AND assignment_id = $2
       LIMIT 1`,
      [resourceId, assignmentId],
    );

    if (!resourceResult.rowCount) {
      throw new ApiError(404, 'No se encontro el archivo solicitado.');
    }

    const resource = resourceResult.rows[0];
    const filePath = resolveStoredResourcePath(resource.file_url);
    if (!filePath) {
      throw new ApiError(404, 'Archivo no disponible para descarga segura.');
    }

    return sendProtectedFile(res, {
      filePath,
      fileName: resource.file_name || `archivo_${resource.id}`,
      mimeType: resource.mime_type,
      download: toDownloadFlag(req.validated.query?.download),
    });
  }),
);

router.post(
  '/assignments/:assignmentId/resources',
  validate(assignmentParamsSchema),
  uploadCourseLibraryResource,
  asyncHandler(async (req, res) => {
    const { assignmentId } = req.validated.params;
    const access = await resolveAssignmentAccess(req, assignmentId, { requireWrite: true });

    if (!req.file) {
      throw new ApiError(400, 'Debes seleccionar un archivo para cargar en el aula virtual.');
    }

    let payload;
    try {
      payload = parseCreateResourceBody(req.body);
    } catch (error) {
      removeStoredFile(req.file.path);
      throw error;
    }

    const originalName = String(req.file.originalname || 'archivo').trim() || 'archivo';
    const fallbackTitle =
      originalName.replace(/\.[^.]+$/, '').slice(0, 180) || originalName.slice(0, 180);

    const insertResult = await query(
      `INSERT INTO course_library_resources (
         assignment_id,
         course_campus_id,
         period_id,
         uploaded_by_user_id,
         title,
         description,
         file_name,
         file_url,
         mime_type,
         file_size_bytes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING
         id,
         assignment_id,
         course_campus_id,
         period_id,
         uploaded_by_user_id,
         title,
         description,
         file_name,
         file_url,
         mime_type,
         file_size_bytes,
         created_at,
         updated_at`,
      [
        assignmentId,
        access.assignment.course_campus_id,
        access.assignment.period_id,
        req.user.id,
        payload.title || fallbackTitle,
        payload.description || null,
        originalName.slice(0, 220),
        buildCourseLibraryStorageUrl(req, req.file.filename),
        String(req.file.mimetype || '').slice(0, 120) || null,
        Number(req.file.size || 0),
      ],
    );
    const createdResource = insertResult.rows[0];

    return res.status(201).json({
      message: 'Archivo cargado en el aula virtual.',
      item: {
        ...createdResource,
        file_url: buildCourseLibraryFileUrl(req, assignmentId, createdResource.id),
      },
    });
  }),
);

router.delete(
  '/assignments/:assignmentId/resources/:resourceId',
  validate(resourceDeleteSchema),
  asyncHandler(async (req, res) => {
    const { assignmentId, resourceId } = req.validated.params;
    await resolveAssignmentAccess(req, assignmentId, { requireWrite: true });

    const resourceResult = await query(
      `DELETE FROM course_library_resources
       WHERE id = $1
         AND assignment_id = $2
       RETURNING id, file_url`,
      [resourceId, assignmentId],
    );

    if (!resourceResult.rowCount) {
      throw new ApiError(404, 'No se encontro el archivo seleccionado en este salon.');
    }

    removeStoredFile(resolveStoredResourcePath(resourceResult.rows[0].file_url));

    return res.json({ message: 'Archivo eliminado del aula virtual.' });
  }),
);

module.exports = router;
