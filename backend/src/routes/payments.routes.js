const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { z } = require('zod');
const { query, withTransaction } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const validate = require('../middlewares/validate');
const { authenticate, authorizePermission } = require('../middlewares/auth');
const { parseCampusScopeId } = require('../utils/campusScope');
const {
  DEFAULT_RECEIPT_FORMAT,
  buildReceiptHtml,
  normalizeReceiptDocumentType,
  normalizeReceiptFormat,
} = require('../services/receiptTemplate.service');
const { buildQrDataUrl } = require('../services/qrCode.service');
const {
  RECEIPT_TOKEN_REGEX,
  hashReceiptToken,
  encryptReceiptToken,
  decryptReceiptToken,
} = require('../services/receiptTokenCrypto.service');
const {
  removeUploadedFileQuietly,
  validateUploadedFileSignature,
} = require('../utils/fileValidation');

const router = express.Router();

const PAYMENT_STATUS = ['PENDING', 'COMPLETED', 'REJECTED'];
const PAYMENT_METHODS = ['YAPE', 'PLIN', 'TRANSFERENCIA', 'QR', 'TARJETA', 'CANJE', 'EFECTIVO', 'OTRO'];
const RECEIPT_DOCUMENT_TYPES = ['BOLETA', 'FACTURA', 'RECIBO_INTERNO'];
const RECEIPT_DOCUMENT_PREFIXES = {
  BOLETA: 'BP',
  FACTURA: 'FP',
  RECIBO_INTERNO: 'RI',
};
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');
const PAYMENT_EVIDENCE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const booleanQuery = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'si', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;

  return value;
}, z.boolean().optional());
const paymentEvidenceDir = path.resolve(__dirname, '..', '..', 'uploads', 'payments');
const paymentEvidenceMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const paymentEvidenceExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

fs.mkdirSync(paymentEvidenceDir, { recursive: true });

const nullableTrimmedText = ({ min = 1, max }) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null) return value;
      return String(value).trim() || null;
    },
    z.string().trim().min(min).max(max).nullable().optional(),
  );

const paymentEvidenceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, paymentEvidenceDir),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname || '').toLowerCase();
      const safeExtension = /^[.a-z0-9]+$/.test(extension) ? extension.slice(0, 10) : '';
      callback(null, `${Date.now()}-${crypto.randomUUID()}${safeExtension}`);
    },
  }),
  limits: {
    fileSize: PAYMENT_EVIDENCE_MAX_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || '').toLowerCase();
    if (!paymentEvidenceMimeTypes.has(mimeType)) {
      return callback(new ApiError(400, 'Formato de evidencia no permitido. Use PDF, JPG, PNG o WEBP.'));
    }
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!paymentEvidenceExtensions.has(extension)) {
      return callback(new ApiError(400, 'Extensión de evidencia no permitida. Use PDF, JPG, PNG o WEBP.'));
    }
    return callback(null, true);
  },
});

const attachmentUrlSchema = z
  .string()
  .trim()
  .min(5)
  .max(1024)
  .refine((value) => {
    if (value.startsWith('/api/uploads/payments/')) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_error) {
      return false;
    }
  }, 'URL de evidencia inválida.');

const createPaymentSchema = z.object({
  body: z
    .object({
      student_id: z.number().int().positive(),
      enrollment_id: z.number().int().positive(),
      method: z.enum(PAYMENT_METHODS),
      status: z.enum(PAYMENT_STATUS).optional().default('COMPLETED'),
      reference_code: nullableTrimmedText({ max: 120 }),
      notes: z.string().max(400).nullable().optional(),
      amount_received: z.number().positive().optional(),
      receipt_document_type: z.enum(RECEIPT_DOCUMENT_TYPES).optional().default('BOLETA'),
      billing_name: nullableTrimmedText({ max: 180 }),
      billing_document: nullableTrimmedText({ max: 20 }),
      billing_address: nullableTrimmedText({ max: 240 }),
      evidence_name: z.string().trim().max(180).nullable().optional(),
      evidence_url: attachmentUrlSchema.nullable().optional(),
      no_evidence: z.boolean().optional().default(false),
      details: z
        .array(
          z.object({
            installment_id: z.number().int().positive(),
            amount: z.number().positive(),
          }),
        )
        .optional()
        .default([]),
    })
    .superRefine((payload, ctx) => {
      if (payload.method !== 'EFECTIVO' && !payload.reference_code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reference_code'],
          message: 'El número de operación es obligatorio para pagos no efectivo.',
        });
      }

      if (payload.method !== 'EFECTIVO' && !payload.no_evidence && !payload.evidence_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['evidence_url'],
          message: 'Debe adjuntar evidencia para pagos no efectivo o marcar "No se tiene evidencias".',
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
  query: z.object({}).optional(),
});

const statusSchema = z.object({
  body: z.object({
    status: z.enum(PAYMENT_STATUS),
    method: z.enum(PAYMENT_METHODS).optional(),
    notes: z.string().max(400).nullable().optional(),
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.object({}).optional(),
});

const paymentListSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z
    .object({
      status: z.enum(PAYMENT_STATUS).optional(),
      student_id: z.coerce.number().int().positive().optional(),
      enrollment_id: z.coerce.number().int().positive().optional(),
      campus_id: z.coerce.number().int().positive().optional(),
      date_from: dateString.optional(),
      date_to: dateString.optional(),
      page: z.coerce.number().int().positive().optional(),
      page_size: z.coerce.number().int().min(1).max(100).optional(),
      include_total: booleanQuery,
    })
    .optional(),
});

const paymentPendingSummarySchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    student_id: z.coerce.number().int().positive(),
  }),
});

const paymentReceiptSchema = z.object({
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

const paymentEvidenceFileSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z
    .object({
      campus_id: z.coerce.number().int().positive().optional(),
      download: z.string().optional(),
    })
    .optional(),
});

const paymentReceiptVerificationSchema = z.object({
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
    })
    .optional(),
});

const paymentReceiptPreviewSchema = z.object({
  body: z
    .object({
      format: z.string().optional(),
      receipt_document_type: z.enum(RECEIPT_DOCUMENT_TYPES).optional().default('BOLETA'),
      billing_name: nullableTrimmedText({ max: 180 }),
      billing_document: nullableTrimmedText({ max: 20 }),
      billing_address: nullableTrimmedText({ max: 240 }),
      student_id: z.number().int().positive().optional(),
      enrollment_id: z.number().int().positive().optional(),
      amount_received: z.number().nonnegative().optional(),
      issue_date: z.string().optional(),
      details: z
        .array(
          z.object({
            description: z.string().trim().min(1).max(180),
            amount: z.number().nonnegative(),
            quantity: z.number().int().positive().optional(),
          }),
        )
        .default([]),
    })
    .superRefine((payload, ctx) => {
      if (payload.receipt_document_type !== 'FACTURA') return;

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
    }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const recalculateInstallmentStatus = (paid, total) => {
  if (paid <= 0) return 'PENDING';
  if (paid >= total) return 'PAID';
  return 'PARTIAL';
};

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
  if (!host) {
    return normalizedRelativePath;
  }

  return `${getRequestProtocol(req)}://${host}${normalizedRelativePath}`;
};

const buildPaymentEvidenceUrl = (req, fileName) => {
  const encodedFileName = encodeURIComponent(fileName);
  const relativeUrl = `/api/uploads/payments/${encodedFileName}`;
  return buildFrontendAwareAbsoluteUrl(req, relativeUrl);
};

const resolveStoredPaymentEvidencePath = (evidenceUrl) => {
  const normalizedUrl = String(evidenceUrl || '').trim();
  if (!normalizedUrl) return null;

  try {
    const parsed = new URL(normalizedUrl);
    if (!parsed.pathname.startsWith('/api/uploads/payments/')) return null;
    return path.resolve(paymentEvidenceDir, path.basename(decodeURIComponent(parsed.pathname)));
  } catch (_error) {
    if (!normalizedUrl.startsWith('/api/uploads/payments/')) return null;
    return path.resolve(paymentEvidenceDir, path.basename(decodeURIComponent(normalizedUrl)));
  }
};

const toSafeHeaderFilename = (fileName = 'evidencia') => {
  const normalized = String(fileName || 'evidencia').trim() || 'evidencia';
  return normalized.replace(/[^\w.\- ]+/g, '_').slice(0, 180) || 'evidencia';
};

const assertEvidencePathInsideDir = (filePath) => {
  const resolvedFilePath = path.resolve(filePath || '');
  const resolvedBaseDir = path.resolve(paymentEvidenceDir);
  if (!resolvedFilePath.startsWith(`${resolvedBaseDir}${path.sep}`)) {
    throw new ApiError(400, 'Ruta de evidencia invalida.');
  }
  return resolvedFilePath;
};

const sendProtectedEvidenceFile = (res, { filePath, fileName, download = false }) => {
  const resolvedFilePath = assertEvidencePathInsideDir(filePath);
  if (!fs.existsSync(resolvedFilePath)) {
    throw new ApiError(404, 'Evidencia no encontrada en el servidor.');
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

  return res.sendFile(resolvedFilePath);
};

const generateReceiptToken = () => crypto.randomBytes(16).toString('hex');

const buildReceiptVerificationPath = (receiptToken, format) => {
  const normalizedToken = encodeURIComponent(String(receiptToken || '').trim());
  const searchParams = new URLSearchParams();
  const normalizedFormat = normalizeReceiptFormat(format);
  if (normalizedFormat !== DEFAULT_RECEIPT_FORMAT) {
    searchParams.set('format', normalizedFormat);
  }
  const queryString = searchParams.toString();
  return `/api/payments/verify/${normalizedToken}${queryString ? `?${queryString}` : ''}`;
};

const buildReceiptVerificationUrl = (req, receiptToken, format) => {
  const relativePath = buildReceiptVerificationPath(receiptToken, format);
  return buildFrontendAwareAbsoluteUrl(req, relativePath);
};

const toDownloadFlag = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'si';
};

const mapPaymentDetailRows = (payment, detailsResultRows = []) => {
  if (detailsResultRows.length > 0) {
    return detailsResultRows.map((detail) => ({
      description: detail.concept_name || `Cuota #${detail.installment_id}`,
      quantity: 1,
      unit_price: Number(detail.amount || 0),
      total: Number(detail.amount || 0),
    }));
  }

  return [
    {
      description: 'Pago',
      quantity: 1,
      unit_price: Number(payment.total_amount || 0),
      total: Number(payment.total_amount || 0),
    },
  ];
};

const getPaymentReceiptContextBySqlFilter = async ({ whereSql, whereParams }) => {
  const paymentResult = await query(
    `SELECT
       p.id,
       p.total_amount,
       p.amount_received,
       p.overpayment_amount,
       p.method,
       p.reference_code,
       p.status,
       p.payment_date,
       p.notes,
       p.created_at,
       p.receipt_token,
       p.receipt_document_type,
       p.billing_name,
       p.billing_document,
       p.billing_address,
       CONCAT(s.first_name, ' ', s.last_name) AS student_name,
       s.document_number AS student_document,
       c.name AS course_name,
       cp.name AS campus_name,
       ap.name AS period_name,
       CONCAT(u.first_name, ' ', u.last_name) AS processed_by_name
     FROM payments p
     JOIN students s ON s.id = p.student_id
     JOIN enrollments e ON e.id = p.enrollment_id
     JOIN course_campus cc ON cc.id = e.course_campus_id
     JOIN courses c ON c.id = cc.course_id
     JOIN campuses cp ON cp.id = cc.campus_id
     JOIN academic_periods ap ON ap.id = e.period_id
     LEFT JOIN users u ON u.id = p.processed_by
     ${whereSql}
     LIMIT 1`,
    whereParams,
  );

  if (paymentResult.rowCount === 0) {
    return null;
  }

  const payment = paymentResult.rows[0];
  const detailsResult = await query(
    `SELECT
       pd.amount,
       i.id AS installment_id,
       i.due_date,
       i.description,
       pc.name AS concept_name
     FROM payment_details pd
     JOIN installments i ON i.id = pd.installment_id
     LEFT JOIN payment_concepts pc ON pc.id = i.concept_id
     WHERE pd.payment_id = $1
     ORDER BY i.due_date ASC NULLS LAST, i.id ASC`,
    [payment.id],
  );

  return {
    payment,
    detailRows: mapPaymentDetailRows(payment, detailsResult.rows),
  };
};

const getPaymentReceiptContextById = async ({ paymentId, campusScopeId }) =>
  getPaymentReceiptContextBySqlFilter({
    whereSql: `WHERE p.id = $1
         AND ($2::bigint IS NULL OR cc.campus_id = $2)`,
    whereParams: [paymentId, campusScopeId],
  });

const getPaymentReceiptContextByToken = async ({ receiptToken }) =>
  getPaymentReceiptContextBySqlFilter({
    whereSql: 'WHERE p.receipt_token_hash = $1',
    whereParams: [hashReceiptToken(receiptToken)],
  });

const getReceiptSnapshotByToken = async ({ receiptToken }) => {
  const snapshotResult = await query(
    `SELECT id, payload_html, created_at
     FROM receipt_snapshots
     WHERE receipt_token_hash = $1
     LIMIT 1`,
    [hashReceiptToken(receiptToken)],
  );

  if (snapshotResult.rowCount === 0) {
    return null;
  }

  return snapshotResult.rows[0];
};

const buildPaymentReceiptHtml = async ({ req, payment, detailRows, format }) => {
  const documentType = normalizeReceiptDocumentType(payment.receipt_document_type);
  const documentPrefix = RECEIPT_DOCUMENT_PREFIXES[documentType];
  const isInvoice = documentType === 'FACTURA';
  const rawReceiptToken = decryptReceiptToken(payment.receipt_token);
  const verificationUrl = buildReceiptVerificationUrl(req, rawReceiptToken, format);
  let qrImageDataUrl = '';
  try {
    qrImageDataUrl = await buildQrDataUrl(verificationUrl, { width: 180, margin: 1 });
  } catch (_error) {
    qrImageDataUrl = '';
  }

  return buildReceiptHtml({
    format: normalizeReceiptFormat(format),
    documentType,
    documentNumber: `${documentPrefix}-${String(payment.id).padStart(7, '0')}`,
    issueDate: payment.payment_date || payment.created_at,
    issuedBy: payment.processed_by_name,
    classroomLabel: [payment.course_name, payment.period_name, payment.campus_name].filter(Boolean).join(' - '),
    customerName: isInvoice ? payment.billing_name : payment.student_name,
    customerDocument: isInvoice ? payment.billing_document : payment.student_document,
    customerAddress: isInvoice ? payment.billing_address : null,
    studentName: payment.student_name,
    studentDocument: payment.student_document,
    details: detailRows,
    totalAmount: payment.amount_received,
    aCuentaAmount: payment.amount_received,
    saldoAmount: 0,
    validationUrl: verificationUrl,
    qrImageDataUrl,
  });
};

const uploadPaymentEvidence = (req, res, next) => {
  paymentEvidenceUpload.single('file')(req, res, (error) => {
    if (!error) {
      if (!req.file) return next();

      try {
        validateUploadedFileSignature({
          filePath: req.file.path,
          originalName: req.file.originalname,
          mimetype: req.file.mimetype,
          allowedExtensions: paymentEvidenceExtensions,
          allowedMimeTypes: paymentEvidenceMimeTypes,
          label: 'evidencia',
        });
        return next();
      } catch (validationError) {
        removeUploadedFileQuietly(req.file.path);
        return next(validationError);
      }
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(
        new ApiError(
          400,
          `La evidencia excede el tamaño máximo permitido de ${Math.round(
            PAYMENT_EVIDENCE_MAX_SIZE_BYTES / (1024 * 1024),
          )}MB.`,
        ),
      );
    }

    return next(error);
  });
};

const applyPaymentEffect = async (tx, paymentId, direction) => {
  const detailResult = await tx.query(
    `SELECT pd.installment_id, pd.amount
     FROM payment_details pd
     WHERE pd.payment_id = $1`,
    [paymentId],
  );

  if (detailResult.rowCount === 0) {
    throw new ApiError(400, 'El pago no tiene detalles de cuota para aplicar.');
  }

  for (const detail of detailResult.rows) {
    const installmentResult = await tx.query(
      `SELECT id, total_amount, paid_amount
       FROM installments
       WHERE id = $1
       FOR UPDATE`,
      [detail.installment_id],
    );

    if (installmentResult.rowCount === 0) {
      throw new ApiError(404, `Cuota ${detail.installment_id} no encontrada.`);
    }

    const installment = installmentResult.rows[0];
    const totalAmount = Number(installment.total_amount);
    const paidAmount = Number(installment.paid_amount);
    const amount = Number(detail.amount);

    let updatedPaid;
    if (direction === 1) {
      if (paidAmount + amount > totalAmount + 0.000001) {
        throw new ApiError(
          400,
          `El monto excede el saldo pendiente de la cuota ${detail.installment_id}.`,
        );
      }
      updatedPaid = paidAmount + amount;
    } else {
      updatedPaid = Math.max(0, paidAmount - amount);
    }

    const status = recalculateInstallmentStatus(updatedPaid, totalAmount);

    await tx.query(
      `UPDATE installments
       SET paid_amount = $1,
           status = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [updatedPaid, status, detail.installment_id],
    );
  }
};

router.get(
  '/verify/:token',
  validate(paymentReceiptVerificationSchema),
  asyncHandler(async (req, res) => {
    const receiptToken = String(req.validated.params.token || '')
      .trim()
      .toLowerCase();
    const receiptFormat = normalizeReceiptFormat(req.validated.query?.format);
    const shouldDownload = toDownloadFlag(req.validated.query?.download);

    const receiptContext = await getPaymentReceiptContextByToken({ receiptToken });
    if (receiptContext) {
      const { payment, detailRows } = receiptContext;
      const html = await buildPaymentReceiptHtml({
        req,
        payment,
        detailRows,
        format: receiptFormat,
      });
      const fileName = `comprobante_pago_${payment.id}.html`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `${shouldDownload ? 'attachment' : 'inline'}; filename="${fileName}"`);
      return res.send(html);
    }

    const snapshot = await getReceiptSnapshotByToken({ receiptToken });
    if (!snapshot) {
      throw new ApiError(404, 'Comprobante no encontrado.');
    }

    const fileName = `comprobante_preview_${snapshot.id}.html`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `${shouldDownload ? 'attachment' : 'inline'}; filename="${fileName}"`);
    return res.send(snapshot.payload_html);
  }),
);

router.use(authenticate);

router.post(
  '/evidence',
  authorizePermission('payments.manage'),
  uploadPaymentEvidence,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ApiError(400, 'Debe adjuntar un archivo de evidencia.');
    }

    const evidenceName = String(req.file.originalname || req.file.filename || 'evidencia')
      .trim()
      .slice(0, 180);

    return res.status(201).json({
      message: 'Evidencia cargada.',
      item: {
        evidence_name: evidenceName || 'evidencia',
        evidence_url: buildPaymentEvidenceUrl(req, req.file.filename),
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
      },
    });
  }),
);

router.get(
  '/:id/evidence',
  authorizePermission('payments.view', 'payments.manage'),
  validate(paymentEvidenceFileSchema),
  asyncHandler(async (req, res) => {
    const paymentId = req.validated.params.id;
    const campusScopeId = parseCampusScopeId(req);

    const evidenceResult = await query(
      `SELECT
         p.id,
         p.evidence_name,
         p.evidence_url,
         p.no_evidence
       FROM payments p
       JOIN enrollments e ON e.id = p.enrollment_id
       JOIN course_campus cc ON cc.id = e.course_campus_id
       WHERE p.id = $1
         AND ($2::bigint IS NULL OR cc.campus_id = $2)
       LIMIT 1`,
      [paymentId, campusScopeId],
    );

    if (!evidenceResult.rowCount) {
      throw new ApiError(404, 'Pago no encontrado.');
    }

    const evidence = evidenceResult.rows[0];
    if (evidence.no_evidence || !evidence.evidence_url) {
      throw new ApiError(404, 'Este pago no tiene evidencia adjunta.');
    }

    const filePath = resolveStoredPaymentEvidencePath(evidence.evidence_url);
    if (!filePath) {
      throw new ApiError(404, 'La evidencia no esta disponible en el almacenamiento seguro.');
    }

    return sendProtectedEvidenceFile(res, {
      filePath,
      fileName: evidence.evidence_name || `evidencia_pago_${paymentId}`,
      download: toDownloadFlag(req.validated.query?.download),
    });
  }),
);

router.get(
  '/',
  authorizePermission('payments.view'),
  validate(paymentListSchema),
  asyncHandler(async (req, res) => {
    const queryParams = req.validated.query || {};
    const status = queryParams.status || null;
    const studentId = queryParams.student_id || null;
    const enrollmentId = queryParams.enrollment_id || null;
    const dateFrom = queryParams.date_from || null;
    const dateTo = queryParams.date_to || null;
    const campusScopeId = parseCampusScopeId(req);
    const pageSize = queryParams.page_size || 10;
    const page = queryParams.page || 1;
    const offset = (page - 1) * pageSize;
    const includeTotal = queryParams.include_total === true;

    const whereClause = `
      WHERE ($1::text IS NULL OR p.status = $1)
        AND ($2::bigint IS NULL OR p.student_id = $2)
        AND ($3::bigint IS NULL OR p.enrollment_id = $3)
        AND ($4::date IS NULL OR p.payment_date::date >= $4)
        AND ($5::date IS NULL OR p.payment_date::date <= $5)
        AND ($6::bigint IS NULL OR cc.campus_id = $6)
    `;

    let total = null;
    if (includeTotal) {
      const totalResult = await query(
        `SELECT COUNT(*)::int AS total
         FROM payments p
         JOIN enrollments e ON e.id = p.enrollment_id
         JOIN course_campus cc ON cc.id = e.course_campus_id
         ${whereClause}`,
        [status, studentId, enrollmentId, dateFrom, dateTo, campusScopeId],
      );
      total = Number(totalResult.rows[0]?.total || 0);
    }

    const fetchLimit = includeTotal ? pageSize : pageSize + 1;
    const paymentResult = await query(
      `SELECT
        p.id,
        p.student_id,
        CONCAT(s.first_name, ' ', s.last_name) AS student_name,
        p.enrollment_id,
        p.total_amount,
        p.amount_received,
        p.overpayment_amount,
        p.method,
        p.reference_code,
        p.status,
        p.payment_date,
        p.notes,
        p.evidence_name,
        (p.evidence_url IS NOT NULL AND p.evidence_url <> '') AS has_evidence,
        p.no_evidence,
        p.receipt_document_type,
        p.created_at,
        CONCAT(u.first_name, ' ', u.last_name) AS processed_by_name
      FROM payments p
      JOIN students s ON s.id = p.student_id
      JOIN enrollments e ON e.id = p.enrollment_id
      JOIN course_campus cc ON cc.id = e.course_campus_id
      LEFT JOIN users u ON u.id = p.processed_by
      ${whereClause}
      ORDER BY p.payment_date DESC, p.id DESC
      LIMIT $7
      OFFSET $8`,
      [status, studentId, enrollmentId, dateFrom, dateTo, campusScopeId, fetchLimit, offset],
    );
    const rawRows = paymentResult.rows || [];
    const hasMore = !includeTotal && rawRows.length > pageSize;
    const items = includeTotal ? rawRows : rawRows.slice(0, pageSize);

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

router.get(
  '/pending-summary',
  authorizePermission('payments.view'),
  validate(paymentPendingSummarySchema),
  asyncHandler(async (req, res) => {
    const studentId = req.validated.query.student_id;
    const campusScopeId = parseCampusScopeId(req);

    const studentResult = await query(
      `SELECT id, first_name, last_name, document_number
       FROM students
       WHERE id = $1`,
      [studentId],
    );

    if (studentResult.rowCount === 0) {
      throw new ApiError(404, 'Alumno no encontrado.');
    }

    const { rows } = await query(
      `SELECT
         e.id AS enrollment_id,
         e.status AS enrollment_status,
         c.name AS course_name,
         cp.name AS campus_name,
         i.id AS installment_id,
         i.due_date,
         i.total_amount,
         i.paid_amount,
         (i.total_amount - i.paid_amount) AS pending_amount,
         i.status AS installment_status,
         pc.name AS concept_name,
         i.description
       FROM enrollments e
       JOIN course_campus cc ON cc.id = e.course_campus_id
       JOIN courses c ON c.id = cc.course_id
       JOIN campuses cp ON cp.id = cc.campus_id
       JOIN installments i ON i.enrollment_id = e.id
       LEFT JOIN payment_concepts pc ON pc.id = i.concept_id
       WHERE e.student_id = $1
         AND e.status <> 'CANCELED'
         AND i.status IN ('PENDING', 'PARTIAL')
         AND (i.total_amount - i.paid_amount) > 0
         AND ($2::bigint IS NULL OR cc.campus_id = $2)
       ORDER BY i.due_date ASC, i.id ASC`,
      [studentId, campusScopeId],
    );

    const totalPending = rows.reduce((sum, item) => sum + Number(item.pending_amount || 0), 0);

    return res.json({
      student: studentResult.rows[0],
      summary: {
        installments: rows.length,
        total_pending: totalPending,
      },
      items: rows,
    });
  }),
);

router.post(
  '/',
  authorizePermission('payments.manage'),
  validate(createPaymentSchema),
  asyncHandler(async (req, res) => {
    const {
      student_id,
      enrollment_id,
      method,
      status = 'COMPLETED',
      reference_code,
      notes = null,
      amount_received = undefined,
      receipt_document_type = 'BOLETA',
      billing_name = null,
      billing_document = null,
      billing_address = null,
      evidence_name = null,
      evidence_url = null,
      no_evidence = false,
      details = [],
    } = req.validated.body;

    if (status === 'COMPLETED' && details.length === 0) {
      throw new ApiError(400, 'Un pago COMPLETED debe incluir detalles de cuotas.');
    }

    const created = await withTransaction(async (tx) => {
      const enrollmentResult = await tx.query(
        `SELECT id, student_id
         FROM enrollments
         WHERE id = $1`,
        [enrollment_id],
      );

      if (enrollmentResult.rowCount === 0) {
        throw new ApiError(404, 'Matrícula no encontrada.');
      }

      if (Number(enrollmentResult.rows[0].student_id) !== student_id) {
        throw new ApiError(400, 'La matrícula no pertenece al alumno indicado.');
      }

      let totalAmount = 0;

      for (const detail of details) {
        const installment = await tx.query(
          `SELECT id, enrollment_id, total_amount, paid_amount
           FROM installments
           WHERE id = $1
           FOR UPDATE`,
          [detail.installment_id],
        );

        if (installment.rowCount === 0) {
          throw new ApiError(404, `Cuota ${detail.installment_id} no encontrada.`);
        }

        const row = installment.rows[0];
        if (Number(row.enrollment_id) !== enrollment_id) {
          throw new ApiError(400, `Cuota ${detail.installment_id} no corresponde a la matrícula.`);
        }

        if (status === 'COMPLETED') {
          const pending = Number(row.total_amount) - Number(row.paid_amount);
          if (detail.amount > pending + 0.000001) {
            throw new ApiError(400, `El monto supera el saldo pendiente en cuota ${detail.installment_id}.`);
          }
        }

        totalAmount += detail.amount;
      }

      const normalizedEvidenceName = evidence_name?.trim() || null;
      const normalizedEvidenceUrl = evidence_url?.trim() || null;
      const normalizedReferenceCode =
        reference_code?.trim() || (method === 'EFECTIVO' ? 'EFECTIVO' : null);
      const normalizedDocumentType = normalizeReceiptDocumentType(receipt_document_type);
      const isInvoice = normalizedDocumentType === 'FACTURA';
      const normalizedBillingName = isInvoice ? billing_name?.trim() || null : null;
      const normalizedBillingDocument = isInvoice ? billing_document?.trim() || null : null;
      const normalizedBillingAddress = isInvoice ? billing_address?.trim() || null : null;
      const receivedAmount = Number(amount_received ?? totalAmount);
      const roundedReceivedAmount = Number(receivedAmount.toFixed(2));
      const roundedTotalAmount = Number(totalAmount.toFixed(2));

      if (method !== 'EFECTIVO' && !no_evidence && !normalizedEvidenceUrl) {
        throw new ApiError(
          400,
          'Debe adjuntar evidencia para pagos no efectivo o marcar "No se tiene evidencias".',
        );
      }

      if (roundedReceivedAmount + 0.000001 < roundedTotalAmount) {
        throw new ApiError(400, 'El monto recibido no puede ser menor al monto aplicado.');
      }

      const overpaymentAmount = Number(Math.max(roundedReceivedAmount - roundedTotalAmount, 0).toFixed(2));
      const rawReceiptToken = generateReceiptToken();
      const encryptedReceiptToken = encryptReceiptToken(rawReceiptToken);
      const receiptTokenHash = hashReceiptToken(rawReceiptToken);

      const paymentResult = await tx.query(
        `INSERT INTO payments (
          student_id,
          enrollment_id,
          total_amount,
          amount_received,
          overpayment_amount,
          method,
          reference_code,
          status,
          notes,
          evidence_name,
          evidence_url,
          no_evidence,
          receipt_token,
          receipt_token_hash,
          receipt_document_type,
          billing_name,
          billing_document,
          billing_address,
          processed_by
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, $19
         )
         RETURNING
           id,
           student_id,
           enrollment_id,
           total_amount,
           amount_received,
           overpayment_amount,
           method,
           status,
           payment_date,
           receipt_token,
           receipt_document_type,
           billing_name,
           billing_document,
           billing_address,
           evidence_name,
           evidence_url,
           no_evidence,
           created_at`,
        [
          student_id,
          enrollment_id,
          roundedTotalAmount,
          roundedReceivedAmount,
          overpaymentAmount,
          method,
          normalizedReferenceCode,
          status,
          notes,
          normalizedEvidenceName,
          normalizedEvidenceUrl,
          no_evidence,
          encryptedReceiptToken,
          receiptTokenHash,
          normalizedDocumentType,
          normalizedBillingName,
          normalizedBillingDocument,
          normalizedBillingAddress,
          req.user.id,
        ],
      );

      const payment = paymentResult.rows[0];

      for (const detail of details) {
        await tx.query(
          `INSERT INTO payment_details (payment_id, installment_id, amount)
           VALUES ($1, $2, $3)`,
          [payment.id, detail.installment_id, detail.amount],
        );
      }

      if (status === 'COMPLETED') {
        await applyPaymentEffect(tx, payment.id, 1);
      }

      await tx.query(
        `INSERT INTO payment_audit (payment_id, old_status, new_status, method, changed_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [payment.id, null, status, method, req.user.id, notes],
      );

      return payment;
    });

    return res.status(201).json({ message: 'Pago registrado.', item: created });
  }),
);

router.patch(
  '/:id/status',
  authorizePermission('payments.manage'),
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    const paymentId = req.validated.params.id;
    const { status: newStatus, method, notes = null } = req.validated.body;

    const updated = await withTransaction(async (tx) => {
      const paymentResult = await tx.query(
        `SELECT id, status, method
         FROM payments
         WHERE id = $1
         FOR UPDATE`,
        [paymentId],
      );

      if (paymentResult.rowCount === 0) {
        throw new ApiError(404, 'Pago no encontrado.');
      }

      const payment = paymentResult.rows[0];
      const oldStatus = payment.status;
      const currentMethod = payment.method;

      if (oldStatus === newStatus) {
        return { id: paymentId, status: newStatus, method: method || currentMethod };
      }

      if (oldStatus !== 'COMPLETED' && newStatus === 'COMPLETED') {
        await applyPaymentEffect(tx, paymentId, 1);
      }

      if (oldStatus === 'COMPLETED' && newStatus !== 'COMPLETED') {
        await applyPaymentEffect(tx, paymentId, -1);
      }

      const paymentUpdate = await tx.query(
        `UPDATE payments
         SET status = $1,
             method = COALESCE($2, method),
             notes = COALESCE($3, notes),
             updated_at = NOW()
         WHERE id = $4
         RETURNING id, status, method, payment_date, updated_at`,
        [newStatus, method || null, notes, paymentId],
      );

      await tx.query(
        `INSERT INTO payment_audit (payment_id, old_status, new_status, method, changed_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [paymentId, oldStatus, newStatus, method || currentMethod, req.user.id, notes],
      );

      return paymentUpdate.rows[0];
    });

    return res.json({ message: 'Estado de pago actualizado.', item: updated });
  }),
);

router.post(
  '/receipt-preview',
  authorizePermission('payments.view', 'payments.manage'),
  validate(paymentReceiptPreviewSchema),
  asyncHandler(async (req, res) => {
    const {
      format,
      receipt_document_type: receiptDocumentType = 'BOLETA',
      billing_name: billingName = null,
      billing_document: billingDocument = null,
      billing_address: billingAddress = null,
      student_id: studentId = null,
      enrollment_id: enrollmentId = null,
      amount_received: amountReceived = null,
      issue_date: issueDate = null,
      details = [],
    } = req.validated.body;

    let studentName = 'Alumno por definir';
    let studentDocument = '-';
    let classroomLabel = 'Curso por definir';

    if (studentId) {
      const studentResult = await query(
        `SELECT CONCAT(first_name, ' ', last_name) AS student_name, document_number
         FROM students
         WHERE id = $1
         LIMIT 1`,
        [studentId],
      );

      if (studentResult.rowCount > 0) {
        studentName = studentResult.rows[0].student_name || studentName;
        studentDocument = studentResult.rows[0].document_number || studentDocument;
      }
    }

    if (enrollmentId) {
      const enrollmentResult = await query(
        `SELECT
           c.name AS course_name,
           ap.name AS period_name,
           cp.name AS campus_name
         FROM enrollments e
         JOIN course_campus cc ON cc.id = e.course_campus_id
         JOIN courses c ON c.id = cc.course_id
         JOIN campuses cp ON cp.id = cc.campus_id
         JOIN academic_periods ap ON ap.id = e.period_id
         WHERE e.id = $1
         LIMIT 1`,
        [enrollmentId],
      );

      if (enrollmentResult.rowCount > 0) {
        const enrollment = enrollmentResult.rows[0];
        classroomLabel = [enrollment.course_name, enrollment.period_name, enrollment.campus_name]
          .filter(Boolean)
          .join(' - ');
      }
    }

    const normalizedDetails = details
      .filter((item) => Number(item.amount || 0) > 0)
      .map((item) => ({
        description: item.description,
        quantity: item.quantity || 1,
        unit_price: Number(item.amount || 0),
        total: Number(item.amount || 0),
      }));

    const totalFromDetails = normalizedDetails.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const totalAmount = Number(amountReceived ?? totalFromDetails ?? 0);
    const normalizedDocumentType = normalizeReceiptDocumentType(receiptDocumentType);
    const documentPrefix = RECEIPT_DOCUMENT_PREFIXES[normalizedDocumentType];
    const isInvoice = normalizedDocumentType === 'FACTURA';
    const previewRawToken = generateReceiptToken();
    const previewTokenHash = hashReceiptToken(previewRawToken);
    const previewEncryptedToken = encryptReceiptToken(previewRawToken);
    const previewVerificationUrl = buildReceiptVerificationUrl(req, previewRawToken, format);
    let previewQrImageDataUrl = '';
    try {
      previewQrImageDataUrl = await buildQrDataUrl(previewVerificationUrl, { width: 180, margin: 1 });
    } catch (_error) {
      previewQrImageDataUrl = '';
    }

    const html = buildReceiptHtml({
      format: normalizeReceiptFormat(format),
      documentType: normalizedDocumentType,
      documentNumber: `${documentPrefix}-PREVIEW`,
      issueDate: issueDate || new Date().toISOString(),
      classroomLabel,
      customerName: isInvoice ? billingName : studentName,
      customerDocument: isInvoice ? billingDocument : studentDocument,
      customerAddress: isInvoice ? billingAddress : null,
      studentName,
      studentDocument,
      details:
        normalizedDetails.length > 0
          ? normalizedDetails
          : [
              {
                description: 'Pago',
                quantity: 1,
                unit_price: totalAmount,
                total: totalAmount,
              },
            ],
      totalAmount,
      aCuentaAmount: totalAmount,
      saldoAmount: 0,
      validationUrl: previewVerificationUrl,
      qrImageDataUrl: previewQrImageDataUrl,
    });

    await query(
      `INSERT INTO receipt_snapshots ("source", payload_html, receipt_token, receipt_token_hash)
       VALUES ($1, $2, $3, $4)`,
      ['PAYMENT_PREVIEW', html, previewEncryptedToken, previewTokenHash],
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(html);
  }),
);

router.get(
  '/:id/receipt',
  authorizePermission('payments.view', 'payments.manage'),
  validate(paymentReceiptSchema),
  asyncHandler(async (req, res) => {
    const paymentId = req.validated.params.id;
    const campusScopeId = parseCampusScopeId(req);
    const shouldDownload = toDownloadFlag(req.validated.query?.download);
    const receiptFormat = normalizeReceiptFormat(req.validated.query?.format);

    const receiptContext = await getPaymentReceiptContextById({ paymentId, campusScopeId });
    if (!receiptContext) {
      throw new ApiError(404, 'Pago no encontrado.');
    }

    const { payment, detailRows } = receiptContext;
    const html = await buildPaymentReceiptHtml({
      req,
      payment,
      detailRows,
      format: receiptFormat,
    });

    const fileName = `comprobante_pago_${payment.id}.html`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `${shouldDownload ? 'attachment' : 'inline'}; filename="${fileName}"`);
    return res.send(html);
  }),
);

router.get(
  '/:id/audit',
  authorizePermission('payments.audit.view'),
  validate(
    z.object({
      body: z.object({}).optional(),
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({}).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const paymentId = req.validated.params.id;

    const { rows } = await query(
      `SELECT
         pa.id,
         pa.payment_id,
         pa.old_status,
         pa.new_status,
         pa.method,
         pa.changed_at,
         pa.notes,
         CONCAT(u.first_name, ' ', u.last_name) AS changed_by_name
       FROM payment_audit pa
       LEFT JOIN users u ON u.id = pa.changed_by
       WHERE pa.payment_id = $1
       ORDER BY pa.changed_at DESC`,
      [paymentId],
    );

    return res.json({ items: rows });
  }),
);

module.exports = router;
