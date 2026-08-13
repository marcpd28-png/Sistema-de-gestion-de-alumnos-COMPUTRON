const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeTransactionPayments } = require('./cashPayments.service');

test('calcula vuelto cuando el pago en efectivo supera el total', () => {
  const result = normalizeTransactionPayments({
    method: 'EFECTIVO',
    totalAmount: 52,
    payments: [{ method: 'EFECTIVO', amount: 60 }],
  });

  assert.equal(result.method, 'EFECTIVO');
  assert.equal(result.amountReceived, 60);
  assert.equal(result.changeAmount, 8);
  assert.equal(result.cashReceived, 60);
});

test('permite pago mixto y descuenta el vuelto solo del efectivo', () => {
  const result = normalizeTransactionPayments({
    totalAmount: 52,
    payments: [
      { method: 'EFECTIVO', amount: 40 },
      { method: 'YAPE', amount: 20, reference_code: 'OP123' },
    ],
  });

  assert.equal(result.method, 'MIXTO');
  assert.equal(result.amountReceived, 60);
  assert.equal(result.changeAmount, 8);
  assert.equal(result.cashReceived, 40);
  assert.equal(result.referenceCode, 'YAPE:OP123');
});

test('rechaza vuelto cuando el excedente no proviene de efectivo', () => {
  assert.throws(
    () =>
      normalizeTransactionPayments({
        totalAmount: 52,
        payments: [{ method: 'YAPE', amount: 60, reference_code: 'OP123' }],
      }),
    (error) =>
      error.statusCode === 400 &&
      error.message === 'El vuelto no puede ser mayor al efectivo recibido.',
  );
});

test('requiere referencia para pagos no efectivos', () => {
  assert.throws(
    () =>
      normalizeTransactionPayments({
        totalAmount: 52,
        payments: [{ method: 'PLIN', amount: 52 }],
      }),
    (error) =>
      error.statusCode === 400 &&
      error.message === 'Ingresa el número de operación para cada pago no efectivo.',
  );
});
