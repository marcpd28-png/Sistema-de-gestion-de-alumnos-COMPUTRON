const express = require('express');
const { z } = require('zod');
const { query, withTransaction } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const validate = require('../middlewares/validate');
const { authenticate, authorizePermission } = require('../middlewares/auth');
const { parseCampusScopeId } = require('../utils/campusScope');
const {
  buildReceiptHtml,
  normalizeReceiptFormat,
} = require('../services/receiptTemplate.service');

const router = express.Router();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');
const ENROLLMENT_STATUSES = ['ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELED'];

const enrollmentSchema = z.object({
  body: z.object({
    student_id: z.number().int().positive(),
    course_campus_id: z.number().int().positive(),
    period_id: z.number().int().positive(),
    enrollment_date: dateString.optional(),
    status: z.enum(ENROLLMENT_STATUSES).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const enrollmentUpdateSchema = z.object({
  body: z.object({
    course_campus_id: z.number().int().positive(),
    period_id: z.number().int().positive(),
    enrollment_date: dateString,
    status: z.enum(ENROLLMENT_STATUSES),
    notes: z.string().trim().max(500).nullable().optional(),
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const normalizeOptionalText = (value) => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

const installmentSchema = z.object({
  body: z.object({
    concept_id: z.number().int().positive(),
    description: z.string().max(160).nullable().optional(),
    due_date: dateString,
    total_amount: z.number().positive(),
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const enrollmentReceiptSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z
    .object({
      campus_id: z.coerce.number().int().positive().optional(),
      download: z.string().optional(),
      format: z.string().optional(),
    })
    .optional(),
});

router.use(authenticate);

router.get(
  '/',
  authorizePermission('enrollments.view'),
  asyncHandler(async (req, res) => {
    const campusScopeId = parseCampusScopeId(req);
    const { rows } = await query(
      `SELECT
        e.id,
        e.student_id,
        CONCAT(s.first_name, ' ', s.last_name) AS student_name,
        e.course_campus_id,
        c.name AS course_name,
        cc.campus_id,
        cp.name AS campus_name,
        cc.modality,
        e.period_id,
        p.name AS period_name,
        e.status,
        e.enrollment_date,
        e.notes,
        e.created_at,
        e.created_by,
        EXISTS (
          SELECT 1 FROM payments pay WHERE pay.enrollment_id = e.id
        ) AS has_payments,
        (
          EXISTS (SELECT 1 FROM attendances att WHERE att.enrollment_id = e.id)
          OR EXISTS (SELECT 1 FROM course_practice_attempts attempt WHERE attempt.enrollment_id = e.id)
          OR EXISTS (
            SELECT 1
            FROM grades grade
            JOIN assessments assessment ON assessment.id = grade.assessment_id
            WHERE grade.student_id = e.student_id
              AND assessment.course_campus_id = e.course_campus_id
              AND assessment.period_id = e.period_id
          )
        ) AS has_academic_activity,
        EXISTS (
          SELECT 1
          FROM student_transfer_requests transfer
          WHERE transfer.source_enrollment_id = e.id
            AND transfer.status = 'PENDING'
        ) AS has_pending_transfer,
        TRIM(CONCAT(COALESCE(u.first_name, ''), CASE WHEN u.last_name IS NULL OR u.last_name = '' THEN '' ELSE ' ' END, COALESCE(u.last_name, ''))) AS created_by_name
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN course_campus cc ON cc.id = e.course_campus_id
      JOIN courses c ON c.id = cc.course_id
      JOIN campuses cp ON cp.id = cc.campus_id
      JOIN academic_periods p ON p.id = e.period_id
      LEFT JOIN users u ON u.id = e.created_by
      WHERE ($1::bigint IS NULL OR cc.campus_id = $1)
      ORDER BY e.created_at DESC`,
      [campusScopeId],
    );

    return res.json({ items: rows });
  }),
);

router.get(
  '/recent',
  authorizePermission('enrollments.view'),
  asyncHandler(async (req, res) => {
    const campusScopeId = parseCampusScopeId(req);
    const limit = Number(req.query.limit) || 10;
    
    const { rows } = await query(
      `SELECT
        e.id,
        e.student_id,
        CONCAT(s.first_name, ' ', s.last_name) AS student_name,
        e.course_campus_id,
        c.name AS course_name,
        cc.campus_id,
        cp.name AS campus_name,
        cc.modality,
        e.period_id,
        p.name AS period_name,
        e.status,
        e.enrollment_date,
        e.notes,
        e.created_at,
        e.created_by,
        EXISTS (
          SELECT 1 FROM payments pay WHERE pay.enrollment_id = e.id
        ) AS has_payments,
        (
          EXISTS (SELECT 1 FROM attendances att WHERE att.enrollment_id = e.id)
          OR EXISTS (SELECT 1 FROM course_practice_attempts attempt WHERE attempt.enrollment_id = e.id)
          OR EXISTS (
            SELECT 1
            FROM grades grade
            JOIN assessments assessment ON assessment.id = grade.assessment_id
            WHERE grade.student_id = e.student_id
              AND assessment.course_campus_id = e.course_campus_id
              AND assessment.period_id = e.period_id
          )
        ) AS has_academic_activity,
        EXISTS (
          SELECT 1
          FROM student_transfer_requests transfer
          WHERE transfer.source_enrollment_id = e.id
            AND transfer.status = 'PENDING'
        ) AS has_pending_transfer,
        TRIM(CONCAT(COALESCE(u.first_name, ''), CASE WHEN u.last_name IS NULL OR u.last_name = '' THEN '' ELSE ' ' END, COALESCE(u.last_name, ''))) AS created_by_name
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN course_campus cc ON cc.id = e.course_campus_id
      JOIN courses c ON c.id = cc.course_id
      JOIN campuses cp ON cp.id = cc.campus_id
      JOIN academic_periods p ON p.id = e.period_id
      LEFT JOIN users u ON u.id = e.created_by
      WHERE ($1::bigint IS NULL OR cc.campus_id = $1)
      ORDER BY e.created_at DESC
      LIMIT $2`,
      [campusScopeId, limit],
    );

    return res.json({ items: rows });
  }),
);

router.post(
  '/',
  authorizePermission('enrollments.manage'),
  validate(enrollmentSchema),
  asyncHandler(async (req, res) => {
    const {
      student_id,
      course_campus_id,
      period_id,
      enrollment_date = new Date().toISOString().slice(0, 10),
      status = 'ACTIVE',
      notes = null,
    } = req.validated.body;
    const campusScopeId = parseCampusScopeId(req);

    const offeringResult = await query(
      `SELECT cc.id, cc.campus_id
       FROM course_campus cc
       JOIN courses c ON c.id = cc.course_id
       WHERE cc.id = $1
         AND cc.is_active = TRUE
         AND c.is_active = TRUE
       LIMIT 1`,
      [course_campus_id],
    );

    if (offeringResult.rowCount === 0) {
      throw new ApiError(404, 'El curso seleccionado no existe o no está activo.');
    }

    if (campusScopeId && Number(offeringResult.rows[0].campus_id) !== Number(campusScopeId)) {
      throw new ApiError(403, 'No puedes registrar matrículas fuera de tu sede activa.');
    }

    const { rows } = await query(
      `INSERT INTO enrollments (
         student_id,
         course_campus_id,
         period_id,
         enrollment_date,
         status,
         notes,
         created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, student_id, course_campus_id, period_id, enrollment_date, status, notes, created_at`,
      [
        student_id,
        course_campus_id,
        period_id,
        enrollment_date,
        status,
        normalizeOptionalText(notes),
        req.user.id,
      ],
    );

    if (status === 'ACTIVE') {
      const campusResult = await query(
        `SELECT campus_id
         FROM course_campus
         WHERE id = $1
         LIMIT 1`,
        [course_campus_id],
      );

      if (campusResult.rowCount > 0) {
        await query(
          `UPDATE students
           SET assigned_campus_id = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [campusResult.rows[0].campus_id, student_id],
        );
      }
    }

    return res.status(201).json({ message: 'Matrícula creada.', item: rows[0] });
  }),
);

router.put(
  '/:id',
  authorizePermission('enrollments.manage'),
  validate(enrollmentUpdateSchema),
  asyncHandler(async (req, res) => {
    const enrollmentId = req.validated.params.id;
    const {
      course_campus_id: courseCampusId,
      period_id: periodId,
      enrollment_date: enrollmentDate,
      status,
      notes = null,
    } = req.validated.body;
    const campusScopeId = parseCampusScopeId(req);

    let updated;
    try {
      updated = await withTransaction(async (tx) => {
        const currentResult = await tx.query(
          `SELECT
             e.id,
             e.student_id,
             e.course_campus_id,
             e.period_id,
             e.status,
             cc.campus_id
           FROM enrollments e
           JOIN course_campus cc ON cc.id = e.course_campus_id
           WHERE e.id = $1
           FOR UPDATE OF e`,
          [enrollmentId],
        );

        if (currentResult.rowCount === 0) {
          throw new ApiError(404, 'Matrícula no encontrada.');
        }

        const current = currentResult.rows[0];
        if (current.status === 'TRANSFERRED') {
          throw new ApiError(409, 'Una matrícula trasladada ya no puede editarse.');
        }

        if (campusScopeId && Number(current.campus_id) !== Number(campusScopeId)) {
          throw new ApiError(404, 'Matrícula no encontrada en tu sede activa.');
        }

        const targetOfferingResult = await tx.query(
          `SELECT
             cc.id,
             cc.campus_id,
             cc.is_active AS offering_is_active,
             c.is_active AS course_is_active
           FROM course_campus cc
           JOIN courses c ON c.id = cc.course_id
           WHERE cc.id = $1
           LIMIT 1`,
          [courseCampusId],
        );

        if (targetOfferingResult.rowCount === 0) {
          throw new ApiError(404, 'El curso seleccionado no existe.');
        }

        const targetOffering = targetOfferingResult.rows[0];
        const courseChanged = Number(current.course_campus_id) !== Number(courseCampusId);
        const periodChanged = Number(current.period_id) !== Number(periodId);

        if (courseChanged && (!targetOffering.offering_is_active || !targetOffering.course_is_active)) {
          throw new ApiError(409, 'No se puede cambiar la matrícula a un curso inactivo.');
        }

        if (Number(targetOffering.campus_id) !== Number(current.campus_id)) {
          throw new ApiError(
            409,
            'Para cambiar de sede utiliza el módulo de traslados. La edición de matrícula solo permite cursos de la misma sede.',
          );
        }

        if (campusScopeId && Number(targetOffering.campus_id) !== Number(campusScopeId)) {
          throw new ApiError(403, 'No puedes asignar cursos fuera de tu sede activa.');
        }

        if (courseChanged || periodChanged) {
          const duplicateResult = await tx.query(
            `SELECT id
             FROM enrollments
             WHERE student_id = $1
               AND course_campus_id = $2
               AND period_id = $3
               AND id <> $4
             LIMIT 1`,
            [current.student_id, courseCampusId, periodId, enrollmentId],
          );

          if (duplicateResult.rowCount > 0) {
            throw new ApiError(409, 'El alumno ya tiene una matrícula para ese curso y periodo.');
          }

          const blockersResult = await tx.query(
            `SELECT
               EXISTS (
                 SELECT 1 FROM payments payment WHERE payment.enrollment_id = $1
               ) AS has_payments,
               EXISTS (
                 SELECT 1 FROM attendances attendance WHERE attendance.enrollment_id = $1
               ) AS has_attendance,
               EXISTS (
                 SELECT 1 FROM course_practice_attempts attempt WHERE attempt.enrollment_id = $1
               ) AS has_practice_attempts,
               EXISTS (
                 SELECT 1
                 FROM grades grade
                 JOIN assessments assessment ON assessment.id = grade.assessment_id
                 WHERE grade.student_id = $2
                   AND assessment.course_campus_id = $3
                   AND assessment.period_id = $4
               ) AS has_grades,
               EXISTS (
                 SELECT 1
                 FROM student_transfer_requests transfer
                 WHERE transfer.source_enrollment_id = $1
                   AND transfer.status = 'PENDING'
               ) AS has_pending_transfer`,
            [enrollmentId, current.student_id, current.course_campus_id, current.period_id],
          );
          const blockers = blockersResult.rows[0] || {};
          const blockerLabels = [];
          if (blockers.has_payments) blockerLabels.push('pagos emitidos');
          if (blockers.has_attendance) blockerLabels.push('asistencias');
          if (blockers.has_practice_attempts) blockerLabels.push('prácticas resueltas');
          if (blockers.has_grades) blockerLabels.push('notas académicas');
          if (blockers.has_pending_transfer) blockerLabels.push('un traslado pendiente');

          if (blockerLabels.length > 0) {
            throw new ApiError(
              409,
              `No se puede cambiar el curso o periodo porque la matrícula tiene ${blockerLabels.join(', ')}. Puedes editar la fecha, el estado y la nota sin cambiar el curso.`,
            );
          }
        }

        const updateResult = await tx.query(
          `UPDATE enrollments
           SET course_campus_id = $1,
               period_id = $2,
               enrollment_date = $3,
               status = $4,
               notes = $5,
               updated_at = NOW()
           WHERE id = $6
           RETURNING id, student_id, course_campus_id, period_id, enrollment_date, status, notes, updated_at`,
          [
            courseCampusId,
            periodId,
            enrollmentDate,
            status,
            normalizeOptionalText(notes),
            enrollmentId,
          ],
        );

        if (status === 'ACTIVE') {
          await tx.query(
            `UPDATE students
             SET assigned_campus_id = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [targetOffering.campus_id, current.student_id],
          );
        }

        return updateResult.rows[0];
      });
    } catch (error) {
      if (error?.code === '23505') {
        throw new ApiError(409, 'El alumno ya tiene una matrícula para ese curso y periodo.');
      }
      throw error;
    }

    return res.json({ message: 'Matrícula actualizada.', item: updated });
  }),
);

router.post(
  '/:id/installments',
  authorizePermission('installments.manage'),
  validate(installmentSchema),
  asyncHandler(async (req, res) => {
    const enrollmentId = req.validated.params.id;
    const { concept_id, description = null, due_date, total_amount } = req.validated.body;

    const exists = await query('SELECT id FROM enrollments WHERE id = $1', [enrollmentId]);
    if (exists.rowCount === 0) {
      throw new ApiError(404, 'Matrícula no encontrada.');
    }

    const { rows } = await query(
      `INSERT INTO installments (enrollment_id, concept_id, description, due_date, total_amount)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, enrollment_id, concept_id, description, due_date, total_amount, paid_amount, status`,
      [enrollmentId, concept_id, description, due_date, total_amount],
    );

    return res.status(201).json({ message: 'Cuota creada.', item: rows[0] });
  }),
);

router.get(
  '/:id/installments',
  authorizePermission('installments.view'),
  validate(
    z.object({
      body: z.object({}).optional(),
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({}).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const enrollmentId = req.validated.params.id;

    const { rows } = await query(
      `SELECT
         i.id,
         i.enrollment_id,
         pc.name AS concept,
         i.description,
         i.due_date,
         i.total_amount,
         i.paid_amount,
         i.status,
         i.created_at
       FROM installments i
       JOIN payment_concepts pc ON pc.id = i.concept_id
       WHERE i.enrollment_id = $1
       ORDER BY i.due_date`,
      [enrollmentId],
    );

    return res.json({ items: rows });
  }),
);

router.get(
  '/:id/receipt',
  authorizePermission('enrollments.view', 'enrollments.manage'),
  validate(enrollmentReceiptSchema),
  asyncHandler(async (req, res) => {
    const enrollmentId = req.validated.params.id;
    const campusScopeId = parseCampusScopeId(req);
    const rawDownload = String(req.validated.query?.download || '')
      .trim()
      .toLowerCase();
    const shouldDownload = rawDownload === '1' || rawDownload === 'true' || rawDownload === 'si';
    const receiptFormat = normalizeReceiptFormat(req.validated.query?.format);

    const enrollmentResult = await query(
      `SELECT
         e.id,
         e.status,
         e.enrollment_date,
         e.created_at,
         CONCAT(s.first_name, ' ', s.last_name) AS student_name,
         s.document_number AS student_document,
         c.name AS course_name,
         cp.name AS campus_name,
         p.name AS period_name,
         cc.modality,
         cc.schedule_info,
         cc.monthly_fee,
         CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       JOIN course_campus cc ON cc.id = e.course_campus_id
       JOIN courses c ON c.id = cc.course_id
       JOIN campuses cp ON cp.id = cc.campus_id
       JOIN academic_periods p ON p.id = e.period_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.id = $1
         AND ($2::bigint IS NULL OR cc.campus_id = $2)
       LIMIT 1`,
      [enrollmentId, campusScopeId],
    );

    if (enrollmentResult.rowCount === 0) {
      throw new ApiError(404, 'Matrícula no encontrada.');
    }

    const enrollment = enrollmentResult.rows[0];

    const installmentsResult = await query(
      `SELECT
         i.id,
         i.due_date,
         i.total_amount,
         i.paid_amount,
         i.status,
         pc.name AS concept_name,
         i.description
       FROM installments i
       LEFT JOIN payment_concepts pc ON pc.id = i.concept_id
       WHERE i.enrollment_id = $1
       ORDER BY i.due_date ASC, i.id ASC`,
      [enrollmentId],
    );

    const hasInstallments = installmentsResult.rowCount > 0;
    const totalProgrammed = installmentsResult.rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const totalPaid = installmentsResult.rows.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
    const saldoAmount = Math.max(totalProgrammed - totalPaid, 0);

    const detailRows = hasInstallments
      ? installmentsResult.rows.map((installment) => {
          return {
            description: installment.concept_name || `Cuota #${installment.id}`,
            quantity: 1,
            unit_price: Number(installment.total_amount || 0),
            total: Number(installment.total_amount || 0),
          };
        })
      : [
          {
            description: 'Matricula',
            quantity: 1,
            unit_price: Number(enrollment.monthly_fee || 0),
            total: Number(enrollment.monthly_fee || 0),
          },
        ];

    const html = buildReceiptHtml({
      format: receiptFormat,
      documentNumber: `BM-${String(enrollment.id).padStart(7, '0')}`,
      issueDate: enrollment.enrollment_date || enrollment.created_at,
      classroomLabel: [
        enrollment.course_name,
        enrollment.period_name,
        enrollment.modality,
        enrollment.campus_name,
      ]
        .filter(Boolean)
        .join(' - '),
      customerName: enrollment.student_name,
      studentName: enrollment.student_name,
      studentDocument: enrollment.student_document,
      details: detailRows,
      totalAmount: hasInstallments ? totalProgrammed : enrollment.monthly_fee || 0,
      aCuentaAmount: hasInstallments ? totalPaid : 0,
      saldoAmount: hasInstallments ? saldoAmount : enrollment.monthly_fee || 0,
    });

    const fileName = `boleta_matricula_${enrollment.id}.html`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `${shouldDownload ? 'attachment' : 'inline'}; filename="${fileName}"`);
    return res.send(html);
  }),
);

module.exports = router;
