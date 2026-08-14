const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { query, withTransaction } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const validate = require('../middlewares/validate');
const { authenticate, authorizePermission } = require('../middlewares/auth');
const { parseCampusScopeId } = require('../utils/campusScope');
const {
  DEFAULT_RECEIPT_FORMAT,
  DEFAULT_RECEIPT_PAPER_SIZE,
  buildReceiptHtml,
  normalizeReceiptDocumentType,
  normalizeReceiptFormat,
  normalizeReceiptPaperSize,
} = require('../services/receiptTemplate.service');
const { buildQrDataUrl } = require('../services/qrCode.service');
const {
  RECEIPT_TOKEN_REGEX,
  hashReceiptToken,
  encryptReceiptToken,
  decryptReceiptToken,
} = require('../services/receiptTokenCrypto.service');
const {
  CASH_SOURCE_TYPE,
  buildCashTransactionSunatPayload,
  createSunatDocument,
  getSunatRuntimeConfig,
  normalizeSunatStatus,
  sendSunatDocument,
} = require('../services/sunatApi.service');
const {
  PAYMENT_METHODS,
  PAYMENT_DETAIL_METHODS,
  PAYMENT_METHOD_LABELS,
  buildPaymentSummaryText,
  normalizeTransactionPayments,
  round2,
} = require('../services/cashPayments.service');

const router = express.Router();

const RECEIPT_DOCUMENT_TYPES = ['BOLETA', 'FACTURA', 'RECIBO_INTERNO'];
const RECEIPT_DOCUMENT_PREFIXES = {
  BOLETA: 'BC',
  FACTURA: 'FC',
  RECIBO_INTERNO: 'RC',
};
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');

const booleanQuery = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'si', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;

  return value;
}, z.boolean().optional());

const nullableTrimmedText = ({ min = 1, max }) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null) return value;
      return String(value).trim() || null;
    },
    z.string().trim().min(min).max(max).nullable().optional(),
  );

const openSessionSchema = z.object({
  body: z.object({
    campus_id: z.number().int().positive().optional(),
    opening_amount: z.number().nonnegative().optional().default(0),
    notes: z.string().trim().max(400).nullable().optional(),
  }),
  params: z.object({}).optional(),
  query: z
    .object({
      campus_id: z.coerce.number().int().positive().optional(),
    })
    .optional(),
});

const closeSessionSchema = z.object({
  body: z.object({
    closing_amount: z.number().nonnegative(),
    notes: z.string().trim().max(400).nullable().optional(),
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const serviceItemSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(140),
    description: nullableTrimmedText({ max: 240 }),
    default_price: z.number().nonnegative(),
    is_active: z.boolean().optional().default(true),
    sort_order: z.number().int().optional().default(0),
  }),
  params: z.object({ id: z.coerce.number().int().positive().optional() }).optional(),
  query: z.object({}).optional(),
});

const transactionItemSchema = z.object({
  service_item_id: z.number().int().positive().nullable().optional(),
  description: z.string().trim().min(2).max(180),
  quantity: z.number().int().positive().optional().default(1),
  unit_price: z.number().nonnegative(),
});

const transactionPaymentSchema = z.object({
  method: z.enum(PAYMENT_DETAIL_METHODS),
  amount: z.number().positive(),
  reference_code: nullableTrimmedText({ max: 120 }),
});

const transactionSchema = z.object({
  body: z
    .object({
      session_id: z.number().int().positive().optional(),
      campus_id: z.number().int().positive().optional(),
      student_id: z.number().int().positive().nullable().optional(),
      customer_name: z.string().trim().min(2).max(180),
      customer_document: nullableTrimmedText({ max: 20 }),
      customer_address: nullableTrimmedText({ max: 240 }),
      method: z.enum(PAYMENT_METHODS).optional(),
      reference_code: nullableTrimmedText({ max: 120 }),
      amount_received: z.number().positive().optional(),
      payments: z.array(transactionPaymentSchema).min(1).max(8).optional(),
      receipt_document_type: z.enum(RECEIPT_DOCUMENT_TYPES).optional().default('BOLETA'),
      billing_name: nullableTrimmedText({ max: 180 }),
      billing_document: nullableTrimmedText({ max: 20 }),
      billing_address: nullableTrimmedText({ max: 240 }),
      notes: z.string().trim().max(400).nullable().optional(),
      items: z.array(transactionItemSchema).min(1).max(30),
    })
    .superRefine((payload, ctx) => {
      if (payload.payments?.length) {
        payload.payments.forEach((payment, index) => {
          if (payment.method !== 'EFECTIVO' && !payment.reference_code) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['payments', index, 'reference_code'],
              message: 'El número de operación es obligatorio para pagos no efectivo.',
            });
          }
        });
      } else if (!payload.method) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['method'],
          message: 'Selecciona un método de pago.',
        });
      } else if (payload.method === 'MIXTO') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['payments'],
          message: 'El pago mixto debe enviar el detalle de métodos.',
        });
      } else if (payload.method !== 'EFECTIVO' && !payload.reference_code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reference_code'],
          message: 'El número de operación es obligatorio para pagos no efectivo.',
        });
      }

      if (payload.receipt_document_type === 'FACTURA') {
        if (!/^\d{11}$/.test(payload.billing_document || '')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['billing_document'],
            message: 'El RUC debe tener exactamente 11 dígitos.',
          });
        }
        if (!payload.billing_name || payload.billing_name.length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['billing_name'],
            message: 'La razón social es obligatoria para la factura.',
          });
        }
        if (!payload.billing_address || payload.billing_address.length < 3) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['billing_address'],
            message: 'La dirección fiscal es obligatoria para la factura.',
          });
        }
      }
    }),
  params: z.object({}).optional(),
  query: z
    .object({
      campus_id: z.coerce.number().int().positive().optional(),
    })
    .optional(),
});

const transactionListSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z
    .object({
      campus_id: z.coerce.number().int().positive().optional(),
      session_id: z.coerce.number().int().positive().optional(),
      method: z.enum(PAYMENT_METHODS).optional(),
      status: z.enum(['COMPLETED', 'VOIDED']).optional(),
      date_from: dateString.optional(),
      date_to: dateString.optional(),
      page: z.coerce.number().int().positive().optional(),
      page_size: z.coerce.number().int().min(1).max(100).optional(),
      include_total: booleanQuery,
    })
    .optional(),
});

const transactionReceiptSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z
    .object({
      campus_id: z.coerce.number().int().positive().optional(),
      download: z.string().optional(),
      format: z.string().optional(),
      paper_size: z.string().optional(),
    })
    .optional(),
});

const sunatSubmissionSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z
    .object({
      campus_id: z.coerce.number().int().positive().optional(),
    })
    .optional(),
});

const transactionReceiptVerificationSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    token: z
      .string()
      .trim()
      .min(16)
      .max(128)
      .regex(RECEIPT_TOKEN_REGEX, 'Token de comprobante inválido.'),
  }),
  query: z
    .object({
      download: z.string().optional(),
      format: z.string().optional(),
      paper_size: z.string().optional(),
    })
    .optional(),
});

const voidTransactionSchema = z.object({
  body: z.object({
    notes: z.string().trim().min(3).max(400),
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const generateReceiptToken = () => crypto.randomBytes(16).toString('hex');

const getRequestProtocol = (req) => {
  const forwarded = req.headers['x-forwarded-proto'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.protocol || 'http';
};

const getFrontendOrigin = (req) => {
  const headerCandidates = [
    req.headers['x-frontend-origin'],
    req.headers.origin,
    req.headers.referer,
  ];

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

const buildReceiptVerificationPath = (receiptToken, format, paperSize) => {
  const normalizedToken = encodeURIComponent(String(receiptToken || '').trim());
  const searchParams = new URLSearchParams();
  const normalizedFormat = normalizeReceiptFormat(format);
  if (normalizedFormat !== DEFAULT_RECEIPT_FORMAT) {
    searchParams.set('format', normalizedFormat);
  }
  const normalizedPaperSize = normalizeReceiptPaperSize(paperSize);
  if (normalizedPaperSize !== DEFAULT_RECEIPT_PAPER_SIZE) {
    searchParams.set('paper_size', normalizedPaperSize);
  }
  const queryString = searchParams.toString();
  return `/api/cash-register/verify/${normalizedToken}${queryString ? `?${queryString}` : ''}`;
};

const buildReceiptVerificationUrl = (req, receiptToken, format, paperSize) =>
  buildFrontendAwareAbsoluteUrl(req, buildReceiptVerificationPath(receiptToken, format, paperSize));

const toDownloadFlag = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'si';
};

const resolveCampusIdForWrite = (req, requestedCampusId) => {
  const candidateCampusId = requestedCampusId || req?.body?.campus_id;
  if (candidateCampusId) {
    req.query = { ...(req.query || {}), campus_id: String(candidateCampusId) };
  }
  const campusId = parseCampusScopeId(req);
  if (!campusId) {
    throw new ApiError(400, 'Selecciona una sede para operar la caja.');
  }
  return campusId;
};

const mapTransactionItemsForReceipt = (items = []) =>
  items.map((item) => ({
    service_item_id: item.service_item_id ? Number(item.service_item_id) : null,
    description: item.description || 'Servicio',
    quantity: Number(item.quantity || 1),
    unit_price: Number(item.unit_price || 0),
    total: Number(item.total_amount || 0),
  }));

const mapTransactionItemsForSunat = (items = []) =>
  items.map((item) => ({
    service_item_id: item.service_item_id ? Number(item.service_item_id) : null,
    service_name: item.service_name || null,
    description: item.description || item.service_name || 'Servicio',
    quantity: Number(item.quantity || 1),
    unit_price: Number(item.unit_price || 0),
    total_amount: Number(item.total_amount || 0),
  }));

const getTransactionReceiptContextBySqlFilter = async ({ whereSql, whereParams }) => {
  const transactionResult = await query(
    `SELECT
       ct.id,
       ct.session_id,
       ct.campus_id,
       ct.student_id,
       ct.customer_name,
       ct.customer_document,
       ct.customer_address,
       ct.total_amount,
       ct.amount_received,
       ct.change_amount,
       ct.method,
       ct.reference_code,
       ct.status,
       ct.receipt_document_type,
       ct.billing_name,
       ct.billing_document,
       ct.billing_address,
       ct.receipt_token,
       eds.id AS sunat_submission_id,
       eds.sunat_document_type,
       eds.sunat_api_document_id,
       eds.sunat_series,
       eds.sunat_document_number,
       eds.sunat_status,
       eds.sunat_message,
       eds.sunat_error_code,
       eds.submitted_at,
       ct.notes,
       ct.created_at,
       cp.name AS campus_name,
       CONCAT(u.first_name, ' ', u.last_name) AS processed_by_name,
       CONCAT(s.first_name, ' ', s.last_name) AS student_name,
       s.document_number AS student_document
     FROM cash_transactions ct
     JOIN campuses cp ON cp.id = ct.campus_id
     LEFT JOIN users u ON u.id = ct.processed_by
     LEFT JOIN students s ON s.id = ct.student_id
     LEFT JOIN electronic_document_submissions eds
       ON eds.source_type = 'CASH_TRANSACTION'
      AND eds.source_id = ct.id
     ${whereSql}
     LIMIT 1`,
    whereParams,
  );

  if (transactionResult.rowCount === 0) {
    return null;
  }

  const transaction = transactionResult.rows[0];
  const itemResult = await query(
    `SELECT
       cti.service_item_id,
       cti.description,
       cti.quantity,
       cti.unit_price,
       cti.total_amount,
       csi.name AS service_name
     FROM cash_transaction_items cti
     LEFT JOIN cash_service_items csi ON csi.id = cti.service_item_id
     WHERE cti.transaction_id = $1
     ORDER BY cti.id ASC`,
    [transaction.id],
  );

  const paymentResult = await query(
    `SELECT method, amount, reference_code
     FROM cash_transaction_payments
     WHERE transaction_id = $1
     ORDER BY id ASC`,
    [transaction.id],
  );
  const paymentRows = paymentResult.rows.map((payment) => ({
    method: payment.method,
    amount: Number(payment.amount || 0),
    reference_code: payment.reference_code || null,
  }));

  return {
    transaction: {
      ...transaction,
      payment_summary: paymentRows.length ? buildPaymentSummaryText(paymentRows) : null,
    },
    detailRows: mapTransactionItemsForReceipt(itemResult.rows),
    paymentRows,
  };
};

const getTransactionReceiptContextById = async ({ transactionId, campusScopeId }) =>
  getTransactionReceiptContextBySqlFilter({
    whereSql: `WHERE ct.id = $1
      AND ($2::bigint IS NULL OR ct.campus_id = $2)`,
    whereParams: [transactionId, campusScopeId],
  });

const getTransactionReceiptContextByToken = async ({ receiptToken }) =>
  getTransactionReceiptContextBySqlFilter({
    whereSql: 'WHERE ct.receipt_token_hash = $1',
    whereParams: [hashReceiptToken(receiptToken)],
  });

const getCashTransactionForSunat = async ({ transactionId, campusScopeId }) => {
  const context = await getTransactionReceiptContextById({ transactionId, campusScopeId });
  if (!context) return null;
  return {
    transaction: context.transaction,
    items: mapTransactionItemsForSunat(context.detailRows),
  };
};

const getSunatSubmissionBySource = async ({ sourceType, sourceId }) => {
  const { rows } = await query(
    `SELECT
       id,
       source_type,
       source_id,
       receipt_document_type,
       sunat_document_type,
       sunat_api_document_id,
       sunat_series,
       sunat_document_number,
       sunat_status,
       sunat_message,
       sunat_error_code,
       submitted_at,
       created_at,
       updated_at
     FROM electronic_document_submissions
     WHERE source_type = $1
       AND source_id = $2
     LIMIT 1`,
    [sourceType, sourceId],
  );
  return rows[0] || null;
};

const upsertSunatSubmissionStarted = async ({
  sourceType,
  sourceId,
  receiptDocumentType,
  sunatDocumentType,
  series,
  requestPayload,
  submittedBy,
}) => {
  const { rows } = await query(
    `INSERT INTO electronic_document_submissions (
       source_type,
       source_id,
       receipt_document_type,
       sunat_document_type,
       sunat_series,
       sunat_status,
       request_payload,
       submitted_by,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, 'PROCESANDO', $6::jsonb, $7, NOW())
     ON CONFLICT (source_type, source_id)
     DO UPDATE SET
       receipt_document_type = EXCLUDED.receipt_document_type,
       sunat_document_type = EXCLUDED.sunat_document_type,
       sunat_series = EXCLUDED.sunat_series,
       sunat_status = 'PROCESANDO',
       sunat_message = NULL,
       sunat_error_code = NULL,
       request_payload = EXCLUDED.request_payload,
       submitted_by = EXCLUDED.submitted_by,
       updated_at = NOW()
     RETURNING *`,
    [
      sourceType,
      sourceId,
      receiptDocumentType,
      sunatDocumentType,
      series,
      JSON.stringify(requestPayload),
      submittedBy,
    ],
  );
  return rows[0];
};

const updateSunatSubmission = async ({
  submissionId,
  status,
  apiDocumentId = null,
  documentNumber = null,
  message = null,
  errorCode = null,
  createResponse = null,
  sendResponse = null,
  submitted = false,
}) => {
  const { rows } = await query(
    `UPDATE electronic_document_submissions
     SET sunat_api_document_id = COALESCE($2, sunat_api_document_id),
         sunat_document_number = COALESCE($3, sunat_document_number),
         sunat_status = $4,
         sunat_message = $5,
         sunat_error_code = $6,
         create_response = COALESCE($7::jsonb, create_response),
         send_response = COALESCE($8::jsonb, send_response),
         submitted_at = CASE WHEN $9::boolean THEN NOW() ELSE submitted_at END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      submissionId,
      apiDocumentId,
      documentNumber,
      status,
      message,
      errorCode,
      createResponse ? JSON.stringify(createResponse) : null,
      sendResponse ? JSON.stringify(sendResponse) : null,
      submitted,
    ],
  );
  return rows[0];
};

const buildTransactionReceiptHtml = async ({ req, transaction, detailRows, format, paperSize }) => {
  const documentType = normalizeReceiptDocumentType(transaction.receipt_document_type);
  const documentPrefix = RECEIPT_DOCUMENT_PREFIXES[documentType];
  const isInvoice = documentType === 'FACTURA';
  const rawReceiptToken = decryptReceiptToken(transaction.receipt_token);
  const verificationUrl = buildReceiptVerificationUrl(req, rawReceiptToken, format, paperSize);
  let qrImageDataUrl = '';

  try {
    qrImageDataUrl = await buildQrDataUrl(verificationUrl, { width: 180, margin: 1 });
  } catch (_error) {
    qrImageDataUrl = '';
  }

  const customerName = isInvoice
    ? transaction.billing_name
    : transaction.customer_name || transaction.student_name;
  const customerDocument = isInvoice
    ? transaction.billing_document
    : transaction.customer_document || transaction.student_document;
  const customerAddress = isInvoice
    ? transaction.billing_address
    : transaction.customer_address;

  const internalDocumentNumber = `${documentPrefix}-${String(transaction.id).padStart(7, '0')}`;

  return buildReceiptHtml({
    format: normalizeReceiptFormat(format),
    paperSize: normalizeReceiptPaperSize(paperSize),
    documentType,
    documentNumber: transaction.sunat_document_number || internalDocumentNumber,
    issueDate: transaction.created_at,
    issuedBy: transaction.processed_by_name,
    classroomLabel: `Caja - ${transaction.campus_name || 'Sede'}`,
    customerName,
    customerDocument,
    customerAddress,
    studentName: transaction.student_name || transaction.customer_name,
    studentDocument: transaction.student_document || transaction.customer_document,
    details: detailRows,
    totalAmount: transaction.total_amount,
    aCuentaAmount: transaction.amount_received,
    saldoAmount: 0,
    changeAmount: transaction.change_amount,
    paymentReceivedLabel: transaction.method === 'EFECTIVO' ? 'Pago con' : 'Recibido',
    paymentSummary: transaction.payment_summary || PAYMENT_METHOD_LABELS[transaction.method] || transaction.method,
    validationUrl: verificationUrl,
    qrImageDataUrl,
  });
};

const getSessionSummary = async (sessionId, db = { query }) => {
  const { rows } = await db.query(
    `WITH payment_summary AS (
       SELECT
         ctp.transaction_id,
         COUNT(*)::int AS payment_count,
         COALESCE(SUM(ctp.amount) FILTER (WHERE ctp.method = 'EFECTIVO'), 0)::NUMERIC(10,2) AS cash_received,
         COALESCE(SUM(ctp.amount) FILTER (WHERE ctp.method <> 'EFECTIVO'), 0)::NUMERIC(10,2) AS digital_received
       FROM cash_transaction_payments ctp
       GROUP BY ctp.transaction_id
     )
     SELECT
       COALESCE(SUM(ct.total_amount) FILTER (WHERE ct.status = 'COMPLETED'), 0)::NUMERIC(10,2) AS total_completed,
       COALESCE(SUM(ct.total_amount) FILTER (WHERE ct.status = 'VOIDED'), 0)::NUMERIC(10,2) AS total_voided,
       COALESCE(SUM(
         CASE
           WHEN ct.status <> 'COMPLETED' THEN 0
           WHEN COALESCE(ps.payment_count, 0) > 0
             THEN GREATEST(COALESCE(ps.cash_received, 0) - COALESCE(ct.change_amount, 0), 0)
           WHEN ct.method = 'EFECTIVO' THEN ct.total_amount
           ELSE 0
         END
       ), 0)::NUMERIC(10,2) AS cash_sales,
       COALESCE(SUM(
         CASE
           WHEN ct.status <> 'COMPLETED' THEN 0
           WHEN COALESCE(ps.payment_count, 0) > 0 THEN COALESCE(ps.digital_received, 0)
           WHEN ct.method <> 'EFECTIVO' THEN ct.total_amount
           ELSE 0
         END
       ), 0)::NUMERIC(10,2) AS digital_sales,
       COUNT(*) FILTER (WHERE ct.status = 'COMPLETED')::int AS completed_count,
       COUNT(*) FILTER (WHERE ct.status = 'VOIDED')::int AS voided_count
     FROM cash_transactions ct
     LEFT JOIN payment_summary ps ON ps.transaction_id = ct.id
     WHERE ct.session_id = $1`,
    [sessionId],
  );

  const summary = rows[0] || {};
  return {
    total_completed: Number(summary.total_completed || 0),
    total_voided: Number(summary.total_voided || 0),
    cash_sales: Number(summary.cash_sales || 0),
    digital_sales: Number(summary.digital_sales || 0),
    completed_count: Number(summary.completed_count || 0),
    voided_count: Number(summary.voided_count || 0),
  };
};

const decorateSessionRows = async (rows = []) => {
  const decorated = [];
  for (const row of rows) {
    const summary = await getSessionSummary(row.id);
    decorated.push({
      ...row,
      opening_amount: Number(row.opening_amount || 0),
      closing_amount: row.closing_amount === null ? null : Number(row.closing_amount || 0),
      expected_cash_amount:
        row.expected_cash_amount === null ? null : Number(row.expected_cash_amount || 0),
      difference_amount:
        row.difference_amount === null ? null : Number(row.difference_amount || 0),
      summary,
      current_expected_cash_amount:
        row.status === 'OPEN'
          ? round2(Number(row.opening_amount || 0) + Number(summary.cash_sales || 0))
          : Number(row.expected_cash_amount || 0),
    });
  }
  return decorated;
};

router.get(
  '/verify/:token',
  validate(transactionReceiptVerificationSchema),
  asyncHandler(async (req, res) => {
    const receiptToken = String(req.validated.params.token || '').trim().toLowerCase();
    const receiptFormat = normalizeReceiptFormat(req.validated.query?.format);
    const receiptPaperSize = normalizeReceiptPaperSize(req.validated.query?.paper_size);
    const shouldDownload = toDownloadFlag(req.validated.query?.download);

    const receiptContext = await getTransactionReceiptContextByToken({ receiptToken });
    if (!receiptContext) {
      throw new ApiError(404, 'Comprobante de caja no encontrado.');
    }

    const { transaction, detailRows } = receiptContext;
    const html = await buildTransactionReceiptHtml({
      req,
      transaction,
      detailRows,
      format: receiptFormat,
      paperSize: receiptPaperSize,
    });
    const fileName = `comprobante_caja_${transaction.id}.html`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `${shouldDownload ? 'attachment' : 'inline'}; filename="${fileName}"`);
    return res.send(html);
  }),
);

router.use(authenticate);

router.get(
  '/sunat/config',
  authorizePermission('cash_register.view', 'cash_register.manage'),
  asyncHandler(async (_req, res) => {
    const config = getSunatRuntimeConfig();
    return res.json({
      configured: config.configured,
      company_id: config.companyId,
      branch_id: config.branchId,
      boleta_serie: config.boletaSeries,
      factura_serie: config.facturaSeries,
      boleta_metodo_envio: config.boletaSendMode,
      tax_percent: config.taxPercent,
      igv_affectation: config.igvAffectation,
    });
  }),
);

router.get(
  '/services',
  authorizePermission('cash_register.view', 'cash_register.manage'),
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT id, name, description, default_price, is_active, sort_order, created_at, updated_at
       FROM cash_service_items
       ORDER BY is_active DESC, sort_order ASC, name ASC`,
    );
    return res.json({ items: rows });
  }),
);

router.post(
  '/services',
  authorizePermission('cash_register.manage'),
  validate(serviceItemSchema),
  asyncHandler(async (req, res) => {
    const { name, description = null, default_price, is_active = true, sort_order = 0 } = req.validated.body;
    const { rows } = await query(
      `INSERT INTO cash_service_items (name, description, default_price, is_active, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, default_price, is_active, sort_order, created_at, updated_at`,
      [name.trim().toUpperCase(), description, round2(default_price), is_active, sort_order, req.user.id],
    );
    return res.status(201).json({ message: 'Servicio de caja creado.', item: rows[0] });
  }),
);

router.patch(
  '/services/:id',
  authorizePermission('cash_register.manage'),
  validate(serviceItemSchema),
  asyncHandler(async (req, res) => {
    const serviceId = req.validated.params.id;
    const { name, description = null, default_price, is_active = true, sort_order = 0 } = req.validated.body;
    const { rows } = await query(
      `UPDATE cash_service_items
       SET name = $1,
           description = $2,
           default_price = $3,
           is_active = $4,
           sort_order = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, description, default_price, is_active, sort_order, created_at, updated_at`,
      [name.trim().toUpperCase(), description, round2(default_price), is_active, sort_order, serviceId],
    );

    if (!rows.length) {
      throw new ApiError(404, 'Servicio de caja no encontrado.');
    }

    return res.json({ message: 'Servicio de caja actualizado.', item: rows[0] });
  }),
);

router.get(
  '/sessions/current',
  authorizePermission('cash_register.view', 'cash_register.manage'),
  asyncHandler(async (req, res) => {
    const campusScopeId = parseCampusScopeId(req);
    const { rows } = await query(
      `SELECT
         crs.id,
         crs.campus_id,
         cp.name AS campus_name,
         crs.opening_amount,
         crs.opened_at,
         CONCAT(opened_by.first_name, ' ', opened_by.last_name) AS opened_by_name,
         crs.closing_amount,
         crs.expected_cash_amount,
         crs.difference_amount,
         crs.closed_at,
         CONCAT(closed_by.first_name, ' ', closed_by.last_name) AS closed_by_name,
         crs.status,
         crs.notes,
         crs.created_at,
         crs.updated_at
       FROM cash_register_sessions crs
       JOIN campuses cp ON cp.id = crs.campus_id
       LEFT JOIN users opened_by ON opened_by.id = crs.opened_by
       LEFT JOIN users closed_by ON closed_by.id = crs.closed_by
       WHERE crs.campus_id = $1
         AND crs.status = 'OPEN'
       ORDER BY crs.opened_at DESC
       LIMIT 1`,
      [campusScopeId],
    );

    const decorated = await decorateSessionRows(rows);
    return res.json({ item: decorated[0] || null });
  }),
);

router.get(
  '/sessions',
  authorizePermission('cash_register.view', 'cash_register.manage'),
  asyncHandler(async (req, res) => {
    const campusScopeId = parseCampusScopeId(req);
    const { rows } = await query(
      `SELECT
         crs.id,
         crs.campus_id,
         cp.name AS campus_name,
         crs.opening_amount,
         crs.opened_at,
         CONCAT(opened_by.first_name, ' ', opened_by.last_name) AS opened_by_name,
         crs.closing_amount,
         crs.expected_cash_amount,
         crs.difference_amount,
         crs.closed_at,
         CONCAT(closed_by.first_name, ' ', closed_by.last_name) AS closed_by_name,
         crs.status,
         crs.notes,
         crs.created_at,
         crs.updated_at
       FROM cash_register_sessions crs
       JOIN campuses cp ON cp.id = crs.campus_id
       LEFT JOIN users opened_by ON opened_by.id = crs.opened_by
       LEFT JOIN users closed_by ON closed_by.id = crs.closed_by
       WHERE crs.campus_id = $1
       ORDER BY crs.opened_at DESC
       LIMIT 20`,
      [campusScopeId],
    );

    return res.json({ items: await decorateSessionRows(rows) });
  }),
);

router.post(
  '/sessions/open',
  authorizePermission('cash_register.manage'),
  validate(openSessionSchema),
  asyncHandler(async (req, res) => {
    const body = req.validated.body;
    const { opening_amount = 0, notes = null } = body;
    const requestedCampusId = body.campus_id || req.validated.query?.campus_id || null;
    const campusId = resolveCampusIdForWrite(req, requestedCampusId);

    const created = await withTransaction(async (tx) => {
      const openSessionResult = await tx.query(
        `SELECT id
         FROM cash_register_sessions
         WHERE campus_id = $1
           AND status = 'OPEN'
         FOR UPDATE`,
        [campusId],
      );

      if (openSessionResult.rowCount > 0) {
        throw new ApiError(400, 'Ya existe una caja abierta para esta sede.');
      }

      const { rows } = await tx.query(
        `INSERT INTO cash_register_sessions (campus_id, opening_amount, opened_by, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING id, campus_id, opening_amount, opened_at, status, notes, created_at, updated_at`,
        [campusId, round2(opening_amount), req.user.id, notes || null],
      );

      return rows[0];
    });

    return res.status(201).json({ message: 'Caja abierta.', item: created });
  }),
);

router.patch(
  '/sessions/:id/close',
  authorizePermission('cash_register.manage'),
  validate(closeSessionSchema),
  asyncHandler(async (req, res) => {
    const sessionId = req.validated.params.id;
    const { closing_amount, notes = null } = req.validated.body;

    const closed = await withTransaction(async (tx) => {
      const sessionResult = await tx.query(
        `SELECT id, campus_id, opening_amount, status
         FROM cash_register_sessions
         WHERE id = $1
         FOR UPDATE`,
        [sessionId],
      );

      if (sessionResult.rowCount === 0) {
        throw new ApiError(404, 'Sesión de caja no encontrada.');
      }

      const session = sessionResult.rows[0];
      req.query = { ...(req.query || {}), campus_id: String(session.campus_id) };
      parseCampusScopeId(req);

      if (session.status !== 'OPEN') {
        throw new ApiError(400, 'La caja ya está cerrada.');
      }

      const summary = await getSessionSummary(sessionId, tx);
      const expectedCashAmount = round2(Number(session.opening_amount || 0) + summary.cash_sales);
      const closingAmount = round2(closing_amount);
      const differenceAmount = round2(closingAmount - expectedCashAmount);
      const { rows } = await tx.query(
        `UPDATE cash_register_sessions
         SET closing_amount = $1,
             expected_cash_amount = $2,
             difference_amount = $3,
             closed_by = $4,
             closed_at = NOW(),
             status = 'CLOSED',
             notes = COALESCE($5, notes),
             updated_at = NOW()
         WHERE id = $6
         RETURNING id, campus_id, opening_amount, opened_at, closing_amount, expected_cash_amount,
           difference_amount, closed_at, status, notes, created_at, updated_at`,
        [closingAmount, expectedCashAmount, differenceAmount, req.user.id, notes || null, sessionId],
      );

      return {
        ...rows[0],
        summary,
      };
    });

    return res.json({ message: 'Caja cerrada.', item: closed });
  }),
);

router.get(
  '/transactions',
  authorizePermission('cash_register.view', 'cash_register.manage'),
  validate(transactionListSchema),
  asyncHandler(async (req, res) => {
    const queryParams = req.validated.query || {};
    const campusScopeId = parseCampusScopeId(req);
    const sessionId = queryParams.session_id || null;
    const method = queryParams.method || null;
    const status = queryParams.status || null;
    const dateFrom = queryParams.date_from || null;
    const dateTo = queryParams.date_to || null;
    const pageSize = queryParams.page_size || 20;
    const page = queryParams.page || 1;
    const offset = (page - 1) * pageSize;
    const includeTotal = queryParams.include_total === true;

    const whereClause = `
      WHERE ($1::bigint IS NULL OR ct.campus_id = $1)
        AND ($2::bigint IS NULL OR ct.session_id = $2)
        AND (
          $3::text IS NULL
          OR ct.method = $3
          OR EXISTS (
            SELECT 1
            FROM cash_transaction_payments ctp_filter
            WHERE ctp_filter.transaction_id = ct.id
              AND ctp_filter.method = $3
          )
        )
        AND ($4::text IS NULL OR ct.status = $4)
        AND ($5::date IS NULL OR ct.created_at::date >= $5)
        AND ($6::date IS NULL OR ct.created_at::date <= $6)
    `;
    const whereParams = [campusScopeId, sessionId, method, status, dateFrom, dateTo];

    let total = null;
    if (includeTotal) {
      const totalResult = await query(
        `SELECT COUNT(*)::int AS total
         FROM cash_transactions ct
         ${whereClause}`,
        whereParams,
      );
      total = Number(totalResult.rows[0]?.total || 0);
    }

    const fetchLimit = includeTotal ? pageSize : pageSize + 1;
    const { rows } = await query(
      `SELECT
         ct.id,
         ct.session_id,
         ct.campus_id,
         cp.name AS campus_name,
         ct.student_id,
         ct.customer_name,
         ct.customer_document,
         ct.total_amount,
         ct.amount_received,
         ct.change_amount,
         ct.method,
         ct.reference_code,
         ct.status,
         ct.receipt_document_type,
         eds.id AS sunat_submission_id,
         eds.sunat_status,
         eds.sunat_document_number,
         eds.sunat_message,
         ct.notes,
         ct.created_at,
         CONCAT(u.first_name, ' ', u.last_name) AS processed_by_name,
         (
           SELECT STRING_AGG(
             CONCAT(
               CASE p.method
                 WHEN 'EFECTIVO' THEN 'Efectivo'
                 WHEN 'YAPE' THEN 'Yape'
                 WHEN 'PLIN' THEN 'Plin'
                 WHEN 'TRANSFERENCIA' THEN 'Transferencia'
                 WHEN 'QR' THEN 'QR'
                 WHEN 'TARJETA' THEN 'Tarjeta'
                 WHEN 'CANJE' THEN 'Canje'
                 ELSE 'Otro'
               END,
               ': S/ ',
               TO_CHAR(p.amount, 'FM999999990.00'),
               CASE WHEN p.reference_code IS NULL THEN '' ELSE CONCAT(' (', p.reference_code, ')') END
             ),
             ' + '
             ORDER BY p.id
           )
           FROM cash_transaction_payments p
           WHERE p.transaction_id = ct.id
         ) AS payment_summary,
         COALESCE((
           SELECT SUM(p.amount)
           FROM cash_transaction_payments p
           WHERE p.transaction_id = ct.id
             AND p.method = 'EFECTIVO'
         ), CASE WHEN ct.method = 'EFECTIVO' THEN ct.amount_received ELSE 0 END)::NUMERIC(10,2)
           AS cash_payment_amount,
         GREATEST(
           COALESCE((
             SELECT SUM(p.amount)
             FROM cash_transaction_payments p
             WHERE p.transaction_id = ct.id
               AND p.method = 'EFECTIVO'
           ), CASE WHEN ct.method = 'EFECTIVO' THEN ct.amount_received ELSE 0 END)
           - COALESCE(ct.change_amount, 0),
           0
         )::NUMERIC(10,2) AS cash_net_amount,
         COALESCE((
           SELECT SUM(p.amount)
           FROM cash_transaction_payments p
           WHERE p.transaction_id = ct.id
             AND p.method <> 'EFECTIVO'
         ), CASE WHEN ct.method <> 'EFECTIVO' THEN ct.total_amount ELSE 0 END)::NUMERIC(10,2)
           AS digital_payment_amount,
         COALESCE(
           STRING_AGG(cti.description, ', ' ORDER BY cti.id)
             FILTER (WHERE cti.id IS NOT NULL),
           ''
         ) AS item_summary
       FROM cash_transactions ct
       JOIN campuses cp ON cp.id = ct.campus_id
       LEFT JOIN users u ON u.id = ct.processed_by
       LEFT JOIN cash_transaction_items cti ON cti.transaction_id = ct.id
       LEFT JOIN electronic_document_submissions eds
         ON eds.source_type = 'CASH_TRANSACTION'
        AND eds.source_id = ct.id
       ${whereClause}
       GROUP BY ct.id, cp.id, u.id, eds.id, eds.sunat_status, eds.sunat_document_number, eds.sunat_message
       ORDER BY ct.created_at DESC, ct.id DESC
       LIMIT $7
       OFFSET $8`,
      [...whereParams, fetchLimit, offset],
    );

    const hasMore = !includeTotal && rows.length > pageSize;
    const items = includeTotal ? rows : rows.slice(0, pageSize);

    return res.json({
      items,
      meta: {
        total,
        page,
        page_size: pageSize,
        total_pages: includeTotal && total !== null ? Math.max(1, Math.ceil(total / pageSize)) : undefined,
        has_more: includeTotal && total !== null ? page * pageSize < total : hasMore,
        includes_total: includeTotal,
      },
    });
  }),
);

router.post(
  '/transactions',
  authorizePermission('cash_register.manage'),
  validate(transactionSchema),
  asyncHandler(async (req, res) => {
    const {
      session_id: requestedSessionId = null,
      campus_id: requestedCampusId = null,
      student_id = null,
      customer_name,
      customer_document = null,
      customer_address = null,
      method = null,
      reference_code = null,
      amount_received = undefined,
      payments = undefined,
      receipt_document_type = 'BOLETA',
      billing_name = null,
      billing_document = null,
      billing_address = null,
      notes = null,
      items,
    } = req.validated.body;

    const campusId = resolveCampusIdForWrite(
      req,
      requestedCampusId || req.validated.query?.campus_id || null,
    );

    const created = await withTransaction(async (tx) => {
      const sessionResult = await tx.query(
        `SELECT id, campus_id, status
         FROM cash_register_sessions
         WHERE ($1::bigint IS NULL OR id = $1)
           AND campus_id = $2
           AND status = 'OPEN'
         ORDER BY opened_at DESC
         LIMIT 1
         FOR UPDATE`,
        [requestedSessionId, campusId],
      );

      if (sessionResult.rowCount === 0) {
        throw new ApiError(400, 'Debe abrir caja antes de registrar operaciones.');
      }

      if (student_id) {
        const studentResult = await tx.query(
          `SELECT id
           FROM students
           WHERE id = $1
             AND status = 'ACTIVE'`,
          [student_id],
        );
        if (studentResult.rowCount === 0) {
          throw new ApiError(404, 'Alumno no encontrado.');
        }
      }

      let totalAmount = 0;
      const normalizedItems = items.map((item) => {
        const quantity = Number(item.quantity || 1);
        const unitPrice = round2(item.unit_price);
        const total = round2(quantity * unitPrice);
        totalAmount = round2(totalAmount + total);
        return {
          service_item_id: item.service_item_id || null,
          description: item.description.trim().toUpperCase(),
          quantity,
          unit_price: unitPrice,
          total_amount: total,
        };
      });

      if (totalAmount <= 0) {
        throw new ApiError(400, 'El total de la operación debe ser mayor a cero.');
      }

      const normalizedPayment = normalizeTransactionPayments({
        method,
        referenceCode: reference_code,
        amountReceived: amount_received,
        totalAmount,
        payments,
      });

      const normalizedDocumentType = normalizeReceiptDocumentType(receipt_document_type);
      const isInvoice = normalizedDocumentType === 'FACTURA';
      const rawReceiptToken = generateReceiptToken();
      const encryptedReceiptToken = encryptReceiptToken(rawReceiptToken);
      const receiptTokenHash = hashReceiptToken(rawReceiptToken);

      const transactionResult = await tx.query(
        `INSERT INTO cash_transactions (
          session_id,
          campus_id,
          student_id,
          customer_name,
          customer_document,
          customer_address,
          total_amount,
          amount_received,
          change_amount,
          method,
          reference_code,
          receipt_document_type,
          billing_name,
          billing_document,
          billing_address,
          receipt_token,
          receipt_token_hash,
          notes,
          processed_by
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        RETURNING id, session_id, campus_id, student_id, customer_name, customer_document,
          total_amount, amount_received, change_amount, method, reference_code, status,
          receipt_document_type, notes, receipt_token, created_at`,
        [
          sessionResult.rows[0].id,
          campusId,
          student_id || null,
          customer_name.trim(),
          customer_document || null,
          customer_address || null,
          totalAmount,
          normalizedPayment.amountReceived,
          normalizedPayment.changeAmount,
          normalizedPayment.method,
          normalizedPayment.referenceCode,
          normalizedDocumentType,
          isInvoice ? billing_name?.trim() || null : null,
          isInvoice ? billing_document?.trim() || null : null,
          isInvoice ? billing_address?.trim() || null : null,
          encryptedReceiptToken,
          receiptTokenHash,
          notes || null,
          req.user.id,
        ],
      );

      const transaction = transactionResult.rows[0];

      for (const item of normalizedItems) {
        await tx.query(
          `INSERT INTO cash_transaction_items (
            transaction_id,
            service_item_id,
            description,
            quantity,
            unit_price,
            total_amount
          )
          VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            transaction.id,
            item.service_item_id,
            item.description,
            item.quantity,
            item.unit_price,
            item.total_amount,
          ],
        );
      }

      for (const payment of normalizedPayment.paymentRows) {
        await tx.query(
          `INSERT INTO cash_transaction_payments (
            transaction_id,
            method,
            amount,
            reference_code
          )
          VALUES ($1, $2, $3, $4)`,
          [transaction.id, payment.method, payment.amount, payment.reference_code],
        );
      }

      await tx.query(
        `INSERT INTO cash_transaction_audit (transaction_id, old_status, new_status, changed_by, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [transaction.id, null, 'COMPLETED', req.user.id, notes || null],
      );

      return {
        ...transaction,
        payment_summary: normalizedPayment.paymentSummary,
        payments: normalizedPayment.paymentRows,
      };
    });

    return res.status(201).json({ message: 'Operación de caja registrada.', item: created });
  }),
);

router.get(
  '/transactions/:id/receipt',
  authorizePermission('cash_register.view', 'cash_register.manage'),
  validate(transactionReceiptSchema),
  asyncHandler(async (req, res) => {
    const transactionId = req.validated.params.id;
    const campusScopeId = parseCampusScopeId(req);
    const shouldDownload = toDownloadFlag(req.validated.query?.download);
    const receiptFormat = normalizeReceiptFormat(req.validated.query?.format);
    const receiptPaperSize = normalizeReceiptPaperSize(req.validated.query?.paper_size);

    const receiptContext = await getTransactionReceiptContextById({ transactionId, campusScopeId });
    if (!receiptContext) {
      throw new ApiError(404, 'Operación de caja no encontrada.');
    }

    const { transaction, detailRows } = receiptContext;
    const html = await buildTransactionReceiptHtml({
      req,
      transaction,
      detailRows,
      format: receiptFormat,
      paperSize: receiptPaperSize,
    });
    const fileName = `comprobante_caja_${transaction.id}.html`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `${shouldDownload ? 'attachment' : 'inline'}; filename="${fileName}"`);
    return res.send(html);
  }),
);

router.get(
  '/transactions/:id/sunat-status',
  authorizePermission('cash_register.view', 'cash_register.manage'),
  validate(sunatSubmissionSchema),
  asyncHandler(async (req, res) => {
    const transactionId = req.validated.params.id;
    const campusScopeId = parseCampusScopeId(req);
    const context = await getCashTransactionForSunat({ transactionId, campusScopeId });
    if (!context) {
      throw new ApiError(404, 'Operación de caja no encontrada.');
    }

    const submission = await getSunatSubmissionBySource({
      sourceType: CASH_SOURCE_TYPE,
      sourceId: transactionId,
    });

    return res.json({
      configured: getSunatRuntimeConfig().configured,
      item: submission,
    });
  }),
);

router.post(
  '/transactions/:id/send-sunat',
  authorizePermission('cash_register.manage'),
  validate(sunatSubmissionSchema),
  asyncHandler(async (req, res) => {
    const transactionId = req.validated.params.id;
    const campusScopeId = parseCampusScopeId(req);
    const context = await getCashTransactionForSunat({ transactionId, campusScopeId });
    if (!context) {
      throw new ApiError(404, 'Operación de caja no encontrada.');
    }

    const { transaction, items } = context;
    if (transaction.status !== 'COMPLETED') {
      throw new ApiError(400, 'Solo se pueden enviar a SUNAT operaciones completadas.');
    }

    const existingSubmission = await getSunatSubmissionBySource({
      sourceType: CASH_SOURCE_TYPE,
      sourceId: transactionId,
    });
    if (existingSubmission?.sunat_status === 'ACEPTADO') {
      return res.json({
        message: 'El comprobante ya fue aceptado por SUNAT.',
        item: existingSubmission,
      });
    }

    const { documentConfig, payload } = buildCashTransactionSunatPayload({ transaction, items });
    const submission = await upsertSunatSubmissionStarted({
      sourceType: CASH_SOURCE_TYPE,
      sourceId: transactionId,
      receiptDocumentType: documentConfig.receiptDocumentType,
      sunatDocumentType: documentConfig.sunatCode,
      series: payload.serie,
      requestPayload: payload,
      submittedBy: req.user.id,
    });

    try {
      const createResult = await createSunatDocument({
        apiPath: documentConfig.apiPath,
        payload,
      });
      const createdStatus = normalizeSunatStatus(createResult.documentData.status, 'PENDIENTE');
      let currentSubmission = await updateSunatSubmission({
        submissionId: submission.id,
        status: createdStatus,
        apiDocumentId: createResult.documentData.apiDocumentId ? String(createResult.documentData.apiDocumentId) : null,
        documentNumber: createResult.documentData.documentNumber,
        message: createResult.documentData.message,
        errorCode: createResult.documentData.errorCode,
        createResponse: createResult.responsePayload,
      });

      const sendResult = await sendSunatDocument({
        apiPath: documentConfig.apiPath,
        apiDocumentId: createResult.documentData.apiDocumentId,
      });
      const sentStatus = normalizeSunatStatus(sendResult.documentData.status, 'ENVIADO');
      currentSubmission = await updateSunatSubmission({
        submissionId: submission.id,
        status: sentStatus,
        apiDocumentId: sendResult.documentData.apiDocumentId
          ? String(sendResult.documentData.apiDocumentId)
          : currentSubmission.sunat_api_document_id,
        documentNumber: sendResult.documentData.documentNumber || currentSubmission.sunat_document_number,
        message: sendResult.documentData.message || 'Comprobante enviado a SUNAT.',
        errorCode: sendResult.documentData.errorCode,
        sendResponse: sendResult.responsePayload,
        submitted: true,
      });

      return res.json({
        message: 'Comprobante enviado a la API SUNAT.',
        item: currentSubmission,
      });
    } catch (error) {
      const failed = await updateSunatSubmission({
        submissionId: submission.id,
        status: 'ERROR',
        message: error.message || 'Error al enviar a SUNAT.',
        errorCode: error.sunatApiStatus ? String(error.sunatApiStatus) : null,
        sendResponse: error.details || null,
        submitted: true,
      });
      throw new ApiError(error.statusCode || 502, error.message || 'Error al enviar a SUNAT.', failed);
    }
  }),
);

router.patch(
  '/transactions/:id/void',
  authorizePermission('cash_register.manage'),
  validate(voidTransactionSchema),
  asyncHandler(async (req, res) => {
    const transactionId = req.validated.params.id;
    const { notes } = req.validated.body;

    const updated = await withTransaction(async (tx) => {
      const transactionResult = await tx.query(
        `SELECT id, campus_id, session_id, status
         FROM cash_transactions
         WHERE id = $1
         FOR UPDATE`,
        [transactionId],
      );

      if (transactionResult.rowCount === 0) {
        throw new ApiError(404, 'Operación de caja no encontrada.');
      }

      const transaction = transactionResult.rows[0];
      req.query = { ...(req.query || {}), campus_id: String(transaction.campus_id) };
      parseCampusScopeId(req);

      if (transaction.status === 'VOIDED') {
        throw new ApiError(400, 'La operación ya está anulada.');
      }

      const sessionResult = await tx.query(
        `SELECT status
         FROM cash_register_sessions
         WHERE id = $1
         FOR UPDATE`,
        [transaction.session_id],
      );
      if (sessionResult.rows[0]?.status !== 'OPEN') {
        throw new ApiError(400, 'Solo se pueden anular operaciones de una caja abierta.');
      }

      const { rows } = await tx.query(
        `UPDATE cash_transactions
         SET status = 'VOIDED',
             notes = CASE WHEN notes IS NULL OR notes = '' THEN $1 ELSE notes || ' | ANULADO: ' || $1 END,
             updated_at = NOW()
         WHERE id = $2
         RETURNING id, session_id, campus_id, total_amount, method, status, notes, updated_at`,
        [notes, transactionId],
      );

      await tx.query(
        `INSERT INTO cash_transaction_audit (transaction_id, old_status, new_status, changed_by, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [transactionId, transaction.status, 'VOIDED', req.user.id, notes],
      );

      return rows[0];
    });

    return res.json({ message: 'Operación de caja anulada.', item: updated });
  }),
);

module.exports = router;
