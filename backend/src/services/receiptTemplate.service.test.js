const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildReceiptHtml,
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

test('usa A5 como papel predeterminado del formato Computron', () => {
  const html = buildSampleReceipt();

  assert.equal(normalizeReceiptPaperSize(), 'A5');
  assert.match(html, /<body class="paper-a5">/);
  assert.match(html, /@page\s*\{\s*size: A5 portrait;/);
  assert.match(html, /viewBox="0 0 148\.5 210"/);
});

test('mantiene el modo A4 doble bajo parametro explicito', () => {
  const html = buildSampleReceipt('A4_DUPLICATE');

  assert.equal(normalizeReceiptPaperSize('doble'), 'A4_DUPLICATE');
  assert.match(html, /<body class="paper-a4-duplicate">/);
  assert.match(html, /@page f3-a4-duplicate\s*\{\s*size: A4 landscape;/);
  assert.match(html, /viewBox="0 0 297 210"/);
});
