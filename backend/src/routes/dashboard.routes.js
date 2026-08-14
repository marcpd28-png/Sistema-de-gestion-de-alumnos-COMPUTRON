const express = require('express');
const { z } = require('zod');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middlewares/validate');
const { authenticate, authorizePermission } = require('../middlewares/auth');
const { userHasPermission } = require('../services/permissions.service');
const { parseCampusScopeId } = require('../utils/campusScope');

const router = express.Router();

const DASHBOARD_TREND_DAYS = 7;

router.use(authenticate);

router.get(
  '/summary',
  authorizePermission('dashboard.view'),
  validate(
    z.object({
      body: z.object({}).optional(),
      params: z.object({}).optional(),
      query: z.object({}).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const campusScopeId = parseCampusScopeId(req);
    const [
      canViewStudents,
      canViewCourses,
      canViewPayments,
      canViewReports,
      canViewCashRegister,
      canManageCashRegister,
    ] = await Promise.all([
      userHasPermission(req.user.id, 'students.view'),
      userHasPermission(req.user.id, 'courses.view'),
      userHasPermission(req.user.id, 'payments.view'),
      userHasPermission(req.user.id, 'reports.view'),
      userHasPermission(req.user.id, 'cash_register.view'),
      userHasPermission(req.user.id, 'cash_register.manage'),
    ]);
    const canAccessCashRegister = canViewCashRegister || canManageCashRegister;

    const summary = {
      totals: {
        students: 0,
        courses: 0,
        payments: 0,
        income: '0.00',
      },
      cash_register: {
        today: {
          completed_count: 0,
          voided_count: 0,
          total_completed: '0.00',
          total_voided: '0.00',
          cash_received: '0.00',
          cash_net: '0.00',
          digital_received: '0.00',
          change_given: '0.00',
        },
        open_session: {
          open_count: 0,
          first_session_id: null,
          opening_amount: '0.00',
          expected_cash_amount: '0.00',
          opened_at: null,
        },
        sunat_pending_count: 0,
        sunat_error_count: 0,
        recent_transactions: [],
      },
      recent_payments: [],
      morosity: [],
      charts: {
        payment_status: [],
        payment_methods: [],
        payments_by_day: [],
        morosity_by_campus: [],
      },
      visibility: {
        students: canViewStudents,
        courses: canViewCourses,
        payments: canViewPayments,
        reports: canViewReports,
        cash_register: canAccessCashRegister,
      },
    };

    const tasks = [];

    if (canViewStudents) {
      tasks.push(
        query(
          `SELECT COUNT(DISTINCT s.id)::int AS total
           FROM students s
           LEFT JOIN enrollments e
             ON e.student_id = s.id
            AND e.status = 'ACTIVE'
           LEFT JOIN course_campus cc ON cc.id = e.course_campus_id
           WHERE s.status = 'ACTIVE'
             AND ($1::bigint IS NULL OR cc.campus_id = $1)`,
          [campusScopeId],
        ).then((result) => {
          summary.totals.students = result.rows[0]?.total || 0;
        }),
      );
    }

    if (canViewCourses) {
      tasks.push(
        query(
          `SELECT COUNT(DISTINCT c.id)::int AS total
           FROM courses c
           LEFT JOIN course_campus cc ON cc.course_id = c.id
           WHERE c.is_active = TRUE
             AND ($1::bigint IS NULL OR cc.campus_id = $1)`,
          [campusScopeId],
        ).then((result) => {
          summary.totals.courses = result.rows[0]?.total || 0;
        }),
      );
    }

    if (canViewPayments) {
      tasks.push(
        query(
          `SELECT
             COUNT(*)::int AS total,
             COALESCE(SUM(CASE WHEN p.status = 'COMPLETED' THEN p.total_amount ELSE 0 END), 0)::numeric(12,2) AS income
           FROM payments p
           JOIN enrollments e ON e.id = p.enrollment_id
           JOIN course_campus cc ON cc.id = e.course_campus_id
           WHERE ($1::bigint IS NULL OR cc.campus_id = $1)`,
          [campusScopeId],
        ).then((result) => {
          summary.totals.payments = result.rows[0]?.total || 0;
          summary.totals.income = result.rows[0]?.income || '0.00';
        }),
      );

      tasks.push(
        query(
          `SELECT
             p.id,
             p.student_id,
             CONCAT(s.first_name, ' ', s.last_name) AS student_name,
             p.total_amount,
             p.method,
             p.status,
             p.payment_date
           FROM payments p
           JOIN students s ON s.id = p.student_id
           JOIN enrollments e ON e.id = p.enrollment_id
           JOIN course_campus cc ON cc.id = e.course_campus_id
           WHERE ($1::bigint IS NULL OR cc.campus_id = $1)
           ORDER BY p.payment_date DESC
           LIMIT 7`,
          [campusScopeId],
        ).then((result) => {
          summary.recent_payments = result.rows;
        }),
      );

      tasks.push(
        query(
          `SELECT
             p.status,
             COUNT(*)::int AS total,
             COALESCE(SUM(p.total_amount), 0)::numeric(12,2) AS amount
           FROM payments p
           JOIN enrollments e ON e.id = p.enrollment_id
           JOIN course_campus cc ON cc.id = e.course_campus_id
           WHERE ($1::bigint IS NULL OR cc.campus_id = $1)
           GROUP BY p.status
           ORDER BY COUNT(*) DESC, p.status ASC`,
          [campusScopeId],
        ).then((result) => {
          summary.charts.payment_status = result.rows;
        }),
      );

      tasks.push(
        query(
          `SELECT
             p.method,
             COUNT(*)::int AS total,
             COALESCE(SUM(p.total_amount), 0)::numeric(12,2) AS amount
           FROM payments p
           JOIN enrollments e ON e.id = p.enrollment_id
           JOIN course_campus cc ON cc.id = e.course_campus_id
           WHERE ($1::bigint IS NULL OR cc.campus_id = $1)
           GROUP BY p.method
           ORDER BY COALESCE(SUM(p.total_amount), 0) DESC, p.method ASC`,
          [campusScopeId],
        ).then((result) => {
          summary.charts.payment_methods = result.rows;
        }),
      );

      tasks.push(
        query(
          `SELECT
             days.day::date AS payment_date,
             COUNT(filtered_payments.id)::int AS total,
             COALESCE(
               SUM(CASE WHEN filtered_payments.status = 'COMPLETED' THEN filtered_payments.total_amount ELSE 0 END),
               0
             )::numeric(12,2) AS completed_amount
           FROM generate_series(
             CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day',
             CURRENT_DATE,
             INTERVAL '1 day'
           ) AS days(day)
           LEFT JOIN (
             SELECT p.id, p.payment_date, p.status, p.total_amount
             FROM payments p
             JOIN enrollments e ON e.id = p.enrollment_id
             JOIN course_campus cc ON cc.id = e.course_campus_id
             WHERE ($1::bigint IS NULL OR cc.campus_id = $1)
           ) AS filtered_payments
             ON filtered_payments.payment_date = days.day::date
           GROUP BY days.day
           ORDER BY days.day ASC`,
          [campusScopeId, DASHBOARD_TREND_DAYS],
        ).then((result) => {
          summary.charts.payments_by_day = result.rows;
        }),
      );
    }

    if (canAccessCashRegister) {
      tasks.push(
        query(
          `WITH filtered_transactions AS (
             SELECT ct.*
             FROM cash_transactions ct
             WHERE ($1::bigint IS NULL OR ct.campus_id = $1)
               AND ct.created_at::date = CURRENT_DATE
           ),
           payment_summary AS (
             SELECT
               ctp.transaction_id,
               COUNT(*)::int AS payment_count,
               COALESCE(SUM(ctp.amount) FILTER (WHERE ctp.method = 'EFECTIVO'), 0)::numeric(12,2)
                 AS cash_received,
               COALESCE(SUM(ctp.amount) FILTER (WHERE ctp.method <> 'EFECTIVO'), 0)::numeric(12,2)
                 AS digital_received
             FROM cash_transaction_payments ctp
             JOIN filtered_transactions ft ON ft.id = ctp.transaction_id
             GROUP BY ctp.transaction_id
           )
           SELECT
             COUNT(*) FILTER (WHERE ft.status = 'COMPLETED')::int AS completed_count,
             COUNT(*) FILTER (WHERE ft.status = 'VOIDED')::int AS voided_count,
             COALESCE(SUM(ft.total_amount) FILTER (WHERE ft.status = 'COMPLETED'), 0)::numeric(12,2)
               AS total_completed,
             COALESCE(SUM(ft.total_amount) FILTER (WHERE ft.status = 'VOIDED'), 0)::numeric(12,2)
               AS total_voided,
             COALESCE(SUM(
               CASE
                 WHEN ft.status <> 'COMPLETED' THEN 0
                 WHEN COALESCE(ps.payment_count, 0) > 0 THEN COALESCE(ps.cash_received, 0)
                 WHEN ft.method = 'EFECTIVO' THEN ft.amount_received
                 ELSE 0
               END
             ), 0)::numeric(12,2) AS cash_received,
             COALESCE(SUM(
               CASE
                 WHEN ft.status <> 'COMPLETED' THEN 0
                 WHEN COALESCE(ps.payment_count, 0) > 0
                   THEN GREATEST(COALESCE(ps.cash_received, 0) - COALESCE(ft.change_amount, 0), 0)
                 WHEN ft.method = 'EFECTIVO' THEN GREATEST(ft.amount_received - COALESCE(ft.change_amount, 0), 0)
                 ELSE 0
               END
             ), 0)::numeric(12,2) AS cash_net,
             COALESCE(SUM(
               CASE
                 WHEN ft.status <> 'COMPLETED' THEN 0
                 WHEN COALESCE(ps.payment_count, 0) > 0 THEN COALESCE(ps.digital_received, 0)
                 WHEN ft.method <> 'EFECTIVO' THEN ft.total_amount
                 ELSE 0
               END
             ), 0)::numeric(12,2) AS digital_received,
             COALESCE(SUM(ft.change_amount) FILTER (WHERE ft.status = 'COMPLETED'), 0)::numeric(12,2)
               AS change_given
           FROM filtered_transactions ft
           LEFT JOIN payment_summary ps ON ps.transaction_id = ft.id`,
          [campusScopeId],
        ).then((result) => {
          summary.cash_register.today = {
            ...summary.cash_register.today,
            ...(result.rows[0] || {}),
          };
        }),
      );

      tasks.push(
        query(
          `WITH open_sessions AS (
             SELECT crs.*
             FROM cash_register_sessions crs
             WHERE crs.status = 'OPEN'
               AND ($1::bigint IS NULL OR crs.campus_id = $1)
           ),
           payment_summary AS (
             SELECT
               ctp.transaction_id,
               COUNT(*)::int AS payment_count,
               COALESCE(SUM(ctp.amount) FILTER (WHERE ctp.method = 'EFECTIVO'), 0)::numeric(12,2)
                 AS cash_received
             FROM cash_transaction_payments ctp
             JOIN cash_transactions ct ON ct.id = ctp.transaction_id
             JOIN open_sessions os ON os.id = ct.session_id
             GROUP BY ctp.transaction_id
           ),
           session_cash AS (
             SELECT
               os.id AS session_id,
               os.opening_amount,
               os.opened_at,
               COALESCE(SUM(
                 CASE
                   WHEN ct.status <> 'COMPLETED' THEN 0
                   WHEN COALESCE(ps.payment_count, 0) > 0
                     THEN GREATEST(COALESCE(ps.cash_received, 0) - COALESCE(ct.change_amount, 0), 0)
                   WHEN ct.method = 'EFECTIVO' THEN GREATEST(ct.amount_received - COALESCE(ct.change_amount, 0), 0)
                   ELSE 0
                 END
               ), 0)::numeric(12,2) AS cash_net
             FROM open_sessions os
             LEFT JOIN cash_transactions ct ON ct.session_id = os.id
             LEFT JOIN payment_summary ps ON ps.transaction_id = ct.id
             GROUP BY os.id, os.opening_amount, os.opened_at
           )
           SELECT
             COUNT(*)::int AS open_count,
             MIN(session_id) AS first_session_id,
             MIN(opened_at) AS opened_at,
             COALESCE(SUM(opening_amount), 0)::numeric(12,2) AS opening_amount,
             COALESCE(SUM(opening_amount + cash_net), 0)::numeric(12,2) AS expected_cash_amount
           FROM session_cash`,
          [campusScopeId],
        ).then((result) => {
          summary.cash_register.open_session = {
            ...summary.cash_register.open_session,
            ...(result.rows[0] || {}),
          };
        }),
      );

      tasks.push(
        query(
          `SELECT
             ct.id,
             ct.customer_name,
             ct.total_amount,
             ct.method,
             ct.status,
             ct.created_at,
             (
               SELECT STRING_AGG(
                 CONCAT(p.method, ': S/ ', TO_CHAR(p.amount, 'FM999999990.00')),
                 ' + '
                 ORDER BY p.id
               )
               FROM cash_transaction_payments p
               WHERE p.transaction_id = ct.id
             ) AS payment_summary
           FROM cash_transactions ct
           WHERE ($1::bigint IS NULL OR ct.campus_id = $1)
           ORDER BY ct.created_at DESC, ct.id DESC
           LIMIT 5`,
          [campusScopeId],
        ).then((result) => {
          summary.cash_register.recent_transactions = result.rows;
        }),
      );

      tasks.push(
        query(
          `SELECT
             COUNT(*) FILTER (
               WHERE COALESCE(eds.sunat_status, 'PENDIENTE') IN ('PENDIENTE', 'PROCESANDO', 'ENVIADO')
             )::int AS sunat_pending_count,
             COUNT(*) FILTER (
               WHERE COALESCE(eds.sunat_status, 'PENDIENTE') IN ('ERROR', 'RECHAZADO')
             )::int AS sunat_error_count
           FROM cash_transactions ct
           LEFT JOIN electronic_document_submissions eds
             ON eds.source_type = 'CASH_TRANSACTION'
            AND eds.source_id = ct.id
           WHERE ($1::bigint IS NULL OR ct.campus_id = $1)
             AND ct.status = 'COMPLETED'
             AND ct.receipt_document_type IN ('BOLETA', 'FACTURA')
             AND ct.created_at::date = CURRENT_DATE`,
          [campusScopeId],
        ).then((result) => {
          const row = result.rows[0] || {};
          summary.cash_register.sunat_pending_count = row.sunat_pending_count || 0;
          summary.cash_register.sunat_error_count = row.sunat_error_count || 0;
        }),
      );
    }

    if (canViewReports) {
      tasks.push(
        query(
          `SELECT
             i.id AS installment_id,
             i.enrollment_id,
             i.due_date,
             i.total_amount,
             i.paid_amount,
             (i.total_amount - i.paid_amount) AS pending_amount,
             CONCAT(s.first_name, ' ', s.last_name) AS student_name,
             s.email AS student_email,
             c.name AS course_name,
             cp.name AS campus_name
           FROM installments i
           JOIN enrollments e ON e.id = i.enrollment_id
           JOIN students s ON s.id = e.student_id
           JOIN course_campus cc ON cc.id = e.course_campus_id
           JOIN courses c ON c.id = cc.course_id
           JOIN campuses cp ON cp.id = cc.campus_id
           WHERE i.due_date < CURRENT_DATE
             AND i.status IN ('PENDING', 'PARTIAL')
             AND ($1::bigint IS NULL OR cc.campus_id = $1)
           ORDER BY i.due_date ASC
           LIMIT 6`,
          [campusScopeId],
        ).then((result) => {
          summary.morosity = result.rows;
        }),
      );

      tasks.push(
        query(
          `SELECT
             cp.id AS campus_id,
             cp.name AS campus_name,
             COUNT(*)::int AS installments,
             COALESCE(SUM(i.total_amount - i.paid_amount), 0)::numeric(12,2) AS pending_amount
           FROM installments i
           JOIN enrollments e ON e.id = i.enrollment_id
           JOIN course_campus cc ON cc.id = e.course_campus_id
           JOIN campuses cp ON cp.id = cc.campus_id
           WHERE i.due_date < CURRENT_DATE
             AND i.status IN ('PENDING', 'PARTIAL')
             AND ($1::bigint IS NULL OR cc.campus_id = $1)
           GROUP BY cp.id, cp.name
           ORDER BY pending_amount DESC, cp.name ASC
           LIMIT 6`,
          [campusScopeId],
        ).then((result) => {
          summary.charts.morosity_by_campus = result.rows;
        }),
      );
    }

    await Promise.all(tasks);

    return res.json(summary);
  }),
);

module.exports = router;
