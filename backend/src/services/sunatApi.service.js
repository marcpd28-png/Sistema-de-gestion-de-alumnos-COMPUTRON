const env = require('../config/env');
const ApiError = require('../utils/apiError');

const CASH_SOURCE_TYPE = 'CASH_TRANSACTION';
const SUNAT_DOCUMENT_TYPES = {
  BOLETA: {
    apiPath: 'boletas',
    sunatCode: '03',
    seriesEnvKey: 'boletaSeries',
  },
  FACTURA: {
    apiPath: 'invoices',
    sunatCode: '01',
    seriesEnvKey: 'facturaSeries',
  },
};

const round2 = (value) => {
  const numeric = Number(value || 0);
  return Number(Number.isFinite(numeric) ? numeric.toFixed(2) : 0);
};

const trimTo = (value, maxLength) => String(value || '').trim().slice(0, maxLength);

const getSunatRuntimeConfig = () => {
  const config = env.sunatApi || {};
  return {
    ...config,
    configured: Boolean(config.baseUrl && config.token && config.companyId && config.branchId),
  };
};

const assertSunatConfigured = () => {
  const config = getSunatRuntimeConfig();
  if (!config.configured) {
    throw new ApiError(
      503,
      'La integración SUNAT no está configurada. Completa SUNAT_API_BASE_URL, SUNAT_API_TOKEN, SUNAT_API_COMPANY_ID y SUNAT_API_BRANCH_ID.',
    );
  }
  return config;
};

const getSunatDocumentConfig = (receiptDocumentType) => {
  const normalizedType = String(receiptDocumentType || '').toUpperCase();
  const documentConfig = SUNAT_DOCUMENT_TYPES[normalizedType];
  if (!documentConfig) {
    throw new ApiError(400, 'Solo boletas y facturas pueden enviarse a SUNAT.');
  }
  return {
    receiptDocumentType: normalizedType,
    ...documentConfig,
  };
};

const toPeruDate = (value) => {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
};

const inferClientDocumentType = ({ receiptDocumentType, documentNumber }) => {
  const normalizedNumber = String(documentNumber || '').replace(/\D/g, '');
  if (receiptDocumentType === 'FACTURA') return '6';
  if (/^\d{11}$/.test(normalizedNumber)) return '6';
  if (/^\d{8}$/.test(normalizedNumber)) return '1';
  if (normalizedNumber) return '0';
  return '0';
};

const normalizeClientDocumentNumber = (documentNumber) => {
  const normalizedNumber = String(documentNumber || '').trim();
  return normalizedNumber || '00000000';
};

const normalizeUnitValue = (unitPrice, config) => {
  const price = round2(unitPrice);
  const taxPercent = Number(config.taxPercent || 0);
  if (taxPercent > 0 && config.pricesIncludeIgv && config.igvAffectation === '10') {
    return round2(price / (1 + taxPercent / 100));
  }
  return price;
};

const buildCashTransactionSunatPayload = ({ transaction, items }) => {
  const config = assertSunatConfigured();
  const documentConfig = getSunatDocumentConfig(transaction.receipt_document_type);
  const isInvoice = documentConfig.receiptDocumentType === 'FACTURA';

  const customerName = trimTo(
    isInvoice ? transaction.billing_name : transaction.customer_name || transaction.student_name,
    255,
  );
  const customerDocument = isInvoice
    ? transaction.billing_document
    : transaction.customer_document || transaction.student_document;
  const customerAddress = trimTo(isInvoice ? transaction.billing_address : transaction.customer_address, 255);
  const series = config[documentConfig.seriesEnvKey];

  const payload = {
    company_id: config.companyId,
    branch_id: config.branchId,
    serie: series,
    fecha_emision: toPeruDate(transaction.created_at),
    moneda: 'PEN',
    tipo_operacion: '0101',
    forma_pago_tipo: 'Contado',
    client: {
      tipo_documento: inferClientDocumentType({
        receiptDocumentType: documentConfig.receiptDocumentType,
        documentNumber: customerDocument,
      }),
      numero_documento: normalizeClientDocumentNumber(customerDocument),
      razon_social: customerName || 'CLIENTE VARIOS',
      direccion: customerAddress || undefined,
      ubigeo: config.defaultUbigeo || undefined,
      distrito: config.defaultDistrito || undefined,
      provincia: config.defaultProvincia || undefined,
      departamento: config.defaultDepartamento || undefined,
    },
    detalles: (items || []).map((item, index) => {
      const serviceCode = item.service_item_id
        ? `${config.defaultItemCode}-${item.service_item_id}`
        : `${config.defaultItemCode}-${index + 1}`;
      return {
        codigo: trimTo(serviceCode, 30),
        descripcion: trimTo(item.description || item.service_name || 'SERVICIO', 255),
        unidad: trimTo(config.defaultUnit || 'ZZ', 3),
        cantidad: Number(item.quantity || 1),
        mto_valor_unitario: normalizeUnitValue(item.unit_price, config),
        porcentaje_igv: Number(config.taxPercent || 0),
        tip_afe_igv: String(config.igvAffectation || '30'),
        codigo_producto_sunat: config.defaultProductSunatCode || undefined,
      };
    }),
    datos_adicionales: {
      source: CASH_SOURCE_TYPE,
      transaction_id: Number(transaction.id),
      internal_receipt_type: documentConfig.receiptDocumentType,
      payment_method: transaction.payment_summary || transaction.method,
      reference_code: transaction.reference_code || undefined,
    },
    usuario_creacion: trimTo(transaction.processed_by_name || 'computron', 100),
  };

  if (documentConfig.receiptDocumentType === 'BOLETA') {
    payload.metodo_envio = config.boletaSendMode || 'resumen_diario';
  }

  return {
    documentConfig,
    payload,
  };
};

const parseApiResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
};

const requestSunatApi = async (path, { method = 'GET', body = null } = {}) => {
  const config = assertSunatConfigured();
  if (typeof fetch !== 'function') {
    throw new ApiError(500, 'La versión de Node.js no tiene fetch disponible para consumir la API SUNAT.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const url = `${config.baseUrl}/${normalizedPath}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const parsed = await parseApiResponse(response);

    if (!response.ok || parsed?.success === false) {
      const message = parsed?.message || parsed?.error || `SUNAT API respondió HTTP ${response.status}.`;
      const error = new ApiError(502, `SUNAT API: ${message}`);
      error.details = parsed;
      error.sunatApiStatus = response.status;
      throw error;
    }

    return parsed;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError(504, 'SUNAT API no respondió dentro del tiempo configurado.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const extractDocumentData = (responsePayload) => {
  const data = responsePayload?.data?.data || responsePayload?.data || responsePayload || {};
  return {
    raw: data,
    apiDocumentId: data.id || data.document_id || data.boleta_id || data.invoice_id || null,
    documentNumber: data.numero_completo || data.document_number || data.serie_correlativo || null,
    status: data.estado_sunat || data.sunat_status || data.status || null,
    message: responsePayload?.message || data.message || null,
    errorCode: responsePayload?.error_code || data.error_code || null,
  };
};

const normalizeSunatStatus = (status, fallback = 'PENDIENTE') => {
  const normalized = String(status || fallback)
    .trim()
    .toUpperCase();
  if (!normalized) return fallback;
  if (normalized === 'SUCCESS') return 'ACEPTADO';
  if (normalized === 'FAILED') return 'ERROR';
  return normalized;
};

const createSunatDocument = async ({ apiPath, payload }) => {
  const responsePayload = await requestSunatApi(`api/v1/${apiPath}`, {
    method: 'POST',
    body: payload,
  });
  return {
    responsePayload,
    documentData: extractDocumentData(responsePayload),
  };
};

const sendSunatDocument = async ({ apiPath, apiDocumentId }) => {
  if (!apiDocumentId) {
    throw new ApiError(502, 'La API SUNAT no devolvió el ID del documento creado.');
  }

  const responsePayload = await requestSunatApi(`api/v1/${apiPath}/${apiDocumentId}/send-sunat`, {
    method: 'POST',
  });
  return {
    responsePayload,
    documentData: extractDocumentData(responsePayload),
  };
};

module.exports = {
  CASH_SOURCE_TYPE,
  buildCashTransactionSunatPayload,
  createSunatDocument,
  getSunatDocumentConfig,
  getSunatRuntimeConfig,
  normalizeSunatStatus,
  sendSunatDocument,
};
