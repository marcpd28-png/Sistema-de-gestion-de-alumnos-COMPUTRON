const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildReceiptHtml,
  formatInstallmentReceiptLabel,
  normalizeReceiptPaperSize,
} = require('./receiptTemplate.service');

const buildSampleReceipt = (paperSize) =>
  buildReceiptHtml({
    format: 'F3',
    paperSize,
    documentNumber: 'BI-0000001',
    issueDate: '2026-08-14T10:30:00-05:00',
    classroomLabel: 'Caja - Puente Piedra',
    customerName: 'Cliente de prueba',
    studentName: 'Alumno de prueba',
    studentDocument: '12345678',
    details: [{ description: 'CERTIFICADO POR CURSO', quantity: 1, unit_price: 40, total: 40 }],
    totalAmount: 40,
    aCuentaAmount: 40,
    saldoAmount: 0,
  });

test('usa A5 doble como papel predeterminado del formato Computron', () => {
  const html = buildSampleReceipt();

  assert.equal(normalizeReceiptPaperSize(), 'A5');
  assert.match(html, /<body class="paper-a5-duplicate">/);
  assert.match(html, /@page\s*\{\s*size: A5 landscape;/);
  assert.match(html, /viewBox="0 0 297 210"/);
  assert.match(html, /--f3-a5-page-height:\s*148\.15mm;/);
  assert.match(html, /\.receipt-content\s*\{[\s\S]*position:\s*absolute;[\s\S]*transform:\s*scale\(var\(--f3-a5-scale\)\)/);
  assert.match(html, /transform:\s*scale\(var\(--f3-a5-scale\)\)/);
});

test('formatea cuotas por numero secuencial para comprobantes', () => {
  assert.equal(formatInstallmentReceiptLabel(1), 'CUOTA 1');
  assert.equal(formatInstallmentReceiptLabel(2), 'CUOTA 2');
  assert.equal(formatInstallmentReceiptLabel(3), 'CUOTA 3');
  assert.equal(formatInstallmentReceiptLabel(4), 'CUOTA 4');
  assert.equal(formatInstallmentReceiptLabel(null), 'CUOTA');
});

test('oculta los datos preimpresos solo al imprimir y mantiene orientacion normal', () => {
  const html = buildSampleReceipt();

  assert.match(html, /\.print-static-brand,\s*\.company-data,\s*\.cut-line\s*\{\s*display: none;/);
  assert.match(html, /class="print-static-brand" href="data:image\/png;base64,/);
  assert.match(html, /<section class="company-data">/);
  assert.doesNotMatch(html, /transform:\s*rotate\(180deg\)/);
});

test('mantiene el modo A4 doble bajo parametro explicito', () => {
  const html = buildSampleReceipt('A4_DUPLICATE');

  assert.equal(normalizeReceiptPaperSize('doble'), 'A4_DUPLICATE');
  assert.match(html, /<body class="paper-a4-duplicate">/);
  assert.match(html, /@page f3-a4-duplicate\s*\{\s*size: A4 landscape;/);
  assert.match(html, /viewBox="0 0 297 210"/);
});
