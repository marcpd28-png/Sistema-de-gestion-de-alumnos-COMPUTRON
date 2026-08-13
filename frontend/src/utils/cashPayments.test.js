import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCashCartTotals,
  normalizeCashPaymentsForSubmit,
  normalizeMoneyInput,
} from './cashPayments.js';

test('calcula vuelto exacto cuando el cliente paga de más en efectivo', () => {
  const totals = calculateCashCartTotals({
    cartItems: [{ quantity: 1, unit_price: 52 }],
    paymentLines: [{ method: 'EFECTIVO', amount: '60', reference_code: '' }],
  });

  assert.equal(totals.totalAmount, 52);
  assert.equal(totals.amountReceived, 60);
  assert.equal(totals.changeAmount, 8);
  assert.equal(totals.cashNetAmount, 52);
  assert.equal(totals.invalidChangeAmount, 0);
});

test('marca como invalido el vuelto si el excedente viene de un metodo digital', () => {
  const totals = calculateCashCartTotals({
    cartItems: [{ quantity: 1, unit_price: 52 }],
    paymentLines: [{ method: 'YAPE', amount: '60', reference_code: 'OP123' }],
  });

  assert.equal(totals.changeAmount, 8);
  assert.equal(totals.invalidChangeAmount, 8);
});

test('normaliza pago mixto con efectivo y yape', () => {
  const result = normalizeCashPaymentsForSubmit({
    totalAmount: 52,
    paymentLines: [
      { method: 'EFECTIVO', amount: '40', reference_code: '' },
      { method: 'YAPE', amount: '20', reference_code: 'OP123' },
    ],
  });

  assert.equal(result.amountReceived, 60);
  assert.equal(result.changeToReturn, 8);
  assert.deepEqual(result.payments, [
    { method: 'EFECTIVO', amount: 40, reference_code: null },
    { method: 'YAPE', amount: 20, reference_code: 'OP123' },
  ]);
});

test('limita input monetario a dos decimales', () => {
  assert.equal(normalizeMoneyInput('S/ 12,3456'), '12.34');
});
