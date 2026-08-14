const fs = require('fs');
const path = require('path');

const receiptTemplates = {
  F1: path.resolve(__dirname, '..', 'templates', 'boleta.formato1.html'),
  F2: path.resolve(__dirname, '..', 'templates', 'boleta.formato2.html'),
  F3: path.resolve(__dirname, '..', 'templates', 'boleta.formato3.html'),
};

const receiptAssets = {
  F3_LOGO: path.resolve(__dirname, '..', 'templates', 'assets', 'logo-computron-recibo.png'),
  F3_WATERMARK: path.resolve(__dirname, '..', 'templates', 'assets', 'watermark-computron-recibo.png'),
};

const templateCache = new Map();
const assetCache = new Map();
const DEFAULT_RECEIPT_FORMAT = 'F3';

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const toCurrency = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 'S/ 0.00';
  return `S/ ${numeric.toFixed(2)}`;
};

const toPlainAmount = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0.00';
  return numeric.toFixed(2);
};

const toDateParts = (value) => {
  if (!value) return { date: '-', time: '-' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '-', time: '-' };

  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  };
};

const normalizeReceiptFormat = (value) => {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  return receiptTemplates[raw] ? raw : DEFAULT_RECEIPT_FORMAT;
};

const RECEIPT_DOCUMENT_METADATA = {
  BOLETA: {
    title: 'Boleta de venta',
    customerDocumentLabel: 'DNI / CE',
    notice: 'Documento generado por el sistema para el control del pago.',
  },
  FACTURA: {
    title: 'Factura',
    customerDocumentLabel: 'R.U.C.',
    notice:
      'Documento generado por el sistema. Su validez tributaria depende de la emisión electrónica mediante SUNAT.',
  },
  RECIBO_INTERNO: {
    title: 'Recibo interno',
    customerDocumentLabel: 'Documento',
    notice: 'Documento interno de control. No es un comprobante de pago electrónico.',
  },
};

const normalizeReceiptDocumentType = (value) => {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  return RECEIPT_DOCUMENT_METADATA[raw] ? raw : 'BOLETA';
};

const toWordsBelowHundred = (n) => {
  const units = [
    'cero',
    'uno',
    'dos',
    'tres',
    'cuatro',
    'cinco',
    'seis',
    'siete',
    'ocho',
    'nueve',
    'diez',
    'once',
    'doce',
    'trece',
    'catorce',
    'quince',
    'dieciseis',
    'diecisiete',
    'dieciocho',
    'diecinueve',
    'veinte',
  ];

  if (n <= 20) return units[n];
  if (n < 30) {
    const veinti = ['veintiuno', 'veintidos', 'veintitres', 'veinticuatro', 'veinticinco', 'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve'];
    return veinti[n - 21];
  }

  const tensNames = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const ten = Math.floor(n / 10);
  const unit = n % 10;
  return unit ? `${tensNames[ten]} y ${units[unit]}` : tensNames[ten];
};

const toWordsInt = (n) => {
  if (n === 0) return 'cero';
  if (n < 100) return toWordsBelowHundred(n);
  if (n === 100) return 'cien';
  if (n < 1000) {
    const hundredsNames = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    return rest ? `${hundredsNames[hundreds]} ${toWordsBelowHundred(rest)}` : hundredsNames[hundreds];
  }
  if (n < 2000) {
    const rest = n % 1000;
    return rest ? `mil ${toWordsInt(rest)}` : 'mil';
  }
  if (n < 1000000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    return rest ? `${toWordsInt(thousands)} mil ${toWordsInt(rest)}` : `${toWordsInt(thousands)} mil`;
  }
  if (n < 2000000) {
    const rest = n % 1000000;
    return rest ? `un millon ${toWordsInt(rest)}` : 'un millon';
  }
  const millions = Math.floor(n / 1000000);
  const rest = n % 1000000;
  return rest ? `${toWordsInt(millions)} millones ${toWordsInt(rest)}` : `${toWordsInt(millions)} millones`;
};

const amountToWords = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 'CERO CON 00/100 SOLES';
  const integer = Math.floor(numeric);
  const cents = String(Math.round((numeric - integer) * 100)).padStart(2, '0');
  return `${toWordsInt(integer)} con ${cents}/100 soles`.toUpperCase();
};

const loadTemplateByFormat = (format) => {
  const normalized = normalizeReceiptFormat(format);
  const templatePath = receiptTemplates[normalized];

  const stat = fs.statSync(templatePath);
  const cached = templateCache.get(normalized);

  if (!cached || cached.mtimeMs !== stat.mtimeMs) {
    const html = fs.readFileSync(templatePath, 'utf8');
    templateCache.set(normalized, { html, mtimeMs: stat.mtimeMs });
    return html;
  }

  return cached.html;
};

const loadAssetDataUrl = (assetPath, mimeType) => {
  const stat = fs.statSync(assetPath);
  const cached = assetCache.get(assetPath);

  if (!cached || cached.mtimeMs !== stat.mtimeMs) {
    const base64 = fs.readFileSync(assetPath).toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;
    assetCache.set(assetPath, { dataUrl, mtimeMs: stat.mtimeMs });
    return dataUrl;
  }

  return cached.dataUrl;
};

const replaceTokens = (template, replacements) =>
  Object.entries(replacements).reduce((current, [key, value]) => {
    return current.replaceAll(`{{${key}}}`, String(value ?? ''));
  }, template);

const normalizeDetailItem = (item = {}) => {
  const quantity = Number(item.quantity || 1);
  const unitPrice = Number(item.unit_price ?? item.total ?? 0);
  const total = Number(item.total ?? quantity * unitPrice);
  return {
    description: String(item.description || '-'),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
    total: Number.isFinite(total) ? total : 0,
  };
};

const buildDetailRowsForF1 = (details = []) => {
  if (!details.length) {
    return '<tr><td>-</td><td class="num">1</td><td class="num">0.00</td><td class="num">0.00</td></tr>';
  }

  return details
    .map((item) => {
      const normalized = normalizeDetailItem(item);
      return `<tr><td>${escapeHtml(normalized.description)}</td><td class="num">${escapeHtml(
        String(normalized.quantity),
      )}</td><td class="num">${escapeHtml(toPlainAmount(normalized.unit_price))}</td><td class="num">${escapeHtml(
        toPlainAmount(normalized.total),
      )}</td></tr>`;
    })
    .join('');
};

const buildDetailRowsForF2 = (details = []) => {
  if (!details.length) {
    return '<tr><td>1</td><td>1</td><td>-</td><td class="num">0.00</td><td class="num">0.00</td></tr>';
  }

  return details
    .map((item, index) => {
      const normalized = normalizeDetailItem(item);
      return `<tr><td>${index + 1}</td><td>${escapeHtml(String(normalized.quantity))}</td><td>${escapeHtml(
        normalized.description,
      )}</td><td class="num">${escapeHtml(toPlainAmount(normalized.unit_price))}</td><td class="num">${escapeHtml(
        toPlainAmount(normalized.total),
      )}</td></tr>`;
    })
    .join('');
};

const buildQrBoxContent = (qrImageDataUrl, validationUrl) => {
  const safeValidationUrl = escapeHtml(validationUrl || '-');
  const safeQrImageDataUrl = String(qrImageDataUrl || '').trim();

  if (safeQrImageDataUrl) {
    return `<div class="qr-content"><img src="${escapeHtml(
      safeQrImageDataUrl,
    )}" alt="QR de validacion de boleta" /><small>${safeValidationUrl}</small></div>`;
  }

  return `<div class="qr-content"><strong>QR</strong><small>${safeValidationUrl}</small></div>`;
};

const buildReceiptHtml = ({
  format = DEFAULT_RECEIPT_FORMAT,
  documentType = 'BOLETA',
  documentNumber,
  issueDate,
  issuedBy,
  classroomLabel,
  customerName,
  customerDocument,
  customerAddress,
  studentName,
  studentDocument,
  details = [],
  totalAmount = 0,
  aCuentaAmount = null,
  saldoAmount = null,
  changeAmount = 0,
  paymentReceivedLabel = 'A Cta',
  paymentSummary = '',
  validationUrl = 'www.macroedunet.com',
  qrImageDataUrl = '',
  rucNumber = '20508338288',
}) => {
  const selectedFormat = normalizeReceiptFormat(format);
  const selectedDocumentType = normalizeReceiptDocumentType(documentType);
  const documentMetadata = RECEIPT_DOCUMENT_METADATA[selectedDocumentType];
  const template = loadTemplateByFormat(selectedFormat);
  const normalizedDetails = details.map(normalizeDetailItem);
  const totalNumeric = Number(totalAmount || 0);
  const aCuentaNumeric = aCuentaAmount === null ? totalNumeric : Number(aCuentaAmount || 0);
  const saldoNumeric = saldoAmount === null ? Math.max(totalNumeric - aCuentaNumeric, 0) : Number(saldoAmount || 0);
  const changeNumeric = Number(changeAmount || 0);
  const dateParts = toDateParts(issueDate);

  const isCanceled = Math.abs(saldoNumeric) < 0.000001;
  const statusLabel = isCanceled ? 'CANCELADO' : 'PENDIENTE';
  const safeCustomerAddress = String(customerAddress || '').trim();
  const safePaymentReceivedLabel = String(paymentReceivedLabel || 'A Cta');
  const safePaymentSummary = String(paymentSummary || '').trim();
  const f3DocumentTitle = selectedDocumentType === 'FACTURA' ? documentMetadata.title : 'Recibo Ingreso';
  const f3AmountWords = amountToWords(totalNumeric).replace(' CON ', ' con ');
  const f3CustomerName = String(customerName || '').trim();
  const f3StudentName = String(studentName || '').trim();
  const f3SenoresValue =
    f3CustomerName && f3CustomerName.toLowerCase() !== f3StudentName.toLowerCase() ? f3CustomerName : '';
  const f3LogoImage = selectedFormat === 'F3' ? loadAssetDataUrl(receiptAssets.F3_LOGO, 'image/png') : '';
  const f3WatermarkImage =
    selectedFormat === 'F3' ? loadAssetDataUrl(receiptAssets.F3_WATERMARK, 'image/png') : '';

  const replacements = {
    F3_LOGO_IMAGE: escapeHtml(f3LogoImage),
    F3_WATERMARK_IMAGE: escapeHtml(f3WatermarkImage),
    DOCUMENT_TITLE: escapeHtml(documentMetadata.title),
    DOCUMENT_TITLE_F3: escapeHtml(f3DocumentTitle),
    DOCUMENT_NUMBER: escapeHtml(documentNumber || '-'),
    ISSUE_DATE: escapeHtml(dateParts.date),
    ISSUE_TIME: escapeHtml(dateParts.time),
    ISSUED_BY: escapeHtml(issuedBy || '-'),
    CLASSROOM_LABEL: escapeHtml(classroomLabel || '-'),
    CUSTOMER_NAME: escapeHtml(customerName || studentName || '-'),
    CUSTOMER_NAME_F3: escapeHtml(f3SenoresValue),
    CUSTOMER_DOCUMENT_LABEL: escapeHtml(documentMetadata.customerDocumentLabel),
    CUSTOMER_DOCUMENT: escapeHtml(customerDocument || studentDocument || '-'),
    CUSTOMER_ADDRESS_ROW_F1: safeCustomerAddress
      ? `<p class="line">Direccion: ${escapeHtml(safeCustomerAddress)}</p>`
      : '',
    CUSTOMER_ADDRESS_ROW_F2: safeCustomerAddress
      ? `<p class="info-line"><span><strong>Direccion:</strong> ${escapeHtml(safeCustomerAddress)}</span></p>`
      : '',
    STUDENT_NAME: escapeHtml(studentName || '-'),
    STUDENT_DOCUMENT: escapeHtml(studentDocument || '-'),
    DETAIL_ROWS_F1: buildDetailRowsForF1(normalizedDetails),
    DETAIL_ROWS_F2: buildDetailRowsForF2(normalizedDetails),
    OP_GRAVADA: escapeHtml(toPlainAmount(0)),
    OP_INAFECTA: escapeHtml(toPlainAmount(totalNumeric)),
    OP_EXONERADA: escapeHtml(toPlainAmount(0)),
    IGV: escapeHtml(toPlainAmount(0)),
    TOTAL_AMOUNT_PLAIN: escapeHtml(toPlainAmount(totalNumeric)),
    TOTAL_CURRENCY: escapeHtml(toCurrency(totalNumeric)),
    PAYMENT_RECEIVED_LABEL: escapeHtml(safePaymentReceivedLabel),
    A_CUENTA_CURRENCY: escapeHtml(toCurrency(aCuentaNumeric)),
    SALDO_CURRENCY: escapeHtml(toCurrency(saldoNumeric)),
    PAYMENT_SUMMARY_ROW_F1: safePaymentSummary
      ? `<div class="payment-detail"><strong>Pago:</strong> ${escapeHtml(safePaymentSummary)}</div>`
      : '',
    PAYMENT_SUMMARY_ROW_F2: safePaymentSummary
      ? `<div class="payment-detail"><strong>Pago:</strong> ${escapeHtml(safePaymentSummary)}</div>`
      : '',
    CHANGE_ROWS_F1:
      changeNumeric > 0
        ? `<div class="sum-row"><span>${escapeHtml(
            safePaymentReceivedLabel.toUpperCase(),
          )}</span><span>${escapeHtml(toPlainAmount(aCuentaNumeric))}</span></div>
            <div class="sum-row"><span>VUELTO</span><span>${escapeHtml(toPlainAmount(changeNumeric))}</span></div>`
        : '',
    CHANGE_ROW_F2:
      changeNumeric > 0
        ? `<div class="summary-row"><span>Vuelto:</span><strong>${escapeHtml(toCurrency(changeNumeric))}</strong></div>`
        : '',
    STATUS_LABEL: escapeHtml(statusLabel),
    AMOUNT_WORDS: escapeHtml(amountToWords(totalNumeric)),
    AMOUNT_WORDS_F3: escapeHtml(f3AmountWords),
    VALIDATION_URL: escapeHtml(validationUrl),
    QR_BOX_CONTENT: buildQrBoxContent(qrImageDataUrl, validationUrl),
    RUC_NUMBER: escapeHtml(rucNumber),
    DOCUMENT_NOTICE: escapeHtml(documentMetadata.notice),
  };

  return replaceTokens(template, replacements);
};

module.exports = {
  DEFAULT_RECEIPT_FORMAT,
  buildReceiptHtml,
  normalizeReceiptDocumentType,
  normalizeReceiptFormat,
  toCurrency,
};
