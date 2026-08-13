const ApiError = require('../utils/apiError');

const PAYMENT_METHODS = [
  'YAPE',
  'PLIN',
  'TRANSFERENCIA',
  'QR',
  'TARJETA',
  'CANJE',
  'EFECTIVO',
  'OTRO',
  'MIXTO',
];

const PAYMENT_DETAIL_METHODS = PAYMENT_METHODS.filter((method) => method !== 'MIXTO');

const PAYMENT_METHOD_LABELS = {
  YAPE: 'Yape',
  PLIN: 'Plin',
  TRANSFERENCIA: 'Transferencia',
  QR: 'QR',
  TARJETA: 'Tarjeta',
  CANJE: 'Canje',
  EFECTIVO: 'Efectivo',
  OTRO: 'Otro',
  MIXTO: 'Mixto',
};

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const formatPaymentAmount = (value) => `S/ ${round2(value).toFixed(2)}`;

const buildPaymentSummaryText = (payments = []) =>
  payments
    .map((payment) => {
      const label = PAYMENT_METHOD_LABELS[payment.method] || payment.method;
      const reference = payment.reference_code ? ` (${payment.reference_code})` : '';
      return `${label}: ${formatPaymentAmount(payment.amount)}${reference}`;
    })
    .join(' + ');

const normalizeTransactionPayments = ({
  method,
  referenceCode,
  amountReceived,
  totalAmount,
  payments,
}) => {
  const rawPayments = payments?.length
    ? payments
    : [
        {
          method,
          reference_code: referenceCode,
          amount: amountReceived ?? totalAmount,
        },
      ];

  const normalizedPayments = rawPayments.map((payment) => {
    const normalizedMethod = String(payment.method || '').trim().toUpperCase();
    if (!PAYMENT_DETAIL_METHODS.includes(normalizedMethod)) {
      throw new ApiError(400, 'Método de pago inválido.');
    }

    const amount = round2(payment.amount);
    if (amount <= 0) {
      throw new ApiError(400, 'Cada método de pago debe tener un importe mayor a cero.');
    }

    const normalizedReferenceCode = String(payment.reference_code || '').trim() || null;
    if (normalizedMethod !== 'EFECTIVO' && !normalizedReferenceCode) {
      throw new ApiError(400, 'Ingresa el número de operación para cada pago no efectivo.');
    }

    return {
      method: normalizedMethod,
      amount,
      reference_code: normalizedReferenceCode,
    };
  });

  const normalizedTotalAmount = round2(totalAmount);
  const paymentTotal = round2(normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0));
  if (paymentTotal + 0.000001 < normalizedTotalAmount) {
    throw new ApiError(400, 'El monto recibido no puede ser menor al total.');
  }

  const cashReceived = round2(
    normalizedPayments
      .filter((payment) => payment.method === 'EFECTIVO')
      .reduce((sum, payment) => sum + payment.amount, 0),
  );
  const changeAmount = round2(Math.max(paymentTotal - normalizedTotalAmount, 0));
  if (changeAmount > cashReceived + 0.000001) {
    throw new ApiError(400, 'El vuelto no puede ser mayor al efectivo recibido.');
  }

  const storedMethod = normalizedPayments.length > 1 ? 'MIXTO' : normalizedPayments[0].method;
  const referenceParts = normalizedPayments
    .filter((payment) => payment.reference_code)
    .map((payment) => `${payment.method}:${payment.reference_code}`);
  const storedReferenceCode =
    storedMethod === 'MIXTO'
      ? referenceParts.join(' + ').slice(0, 120) || 'PAGO MIXTO'
      : normalizedPayments[0].reference_code || (storedMethod === 'EFECTIVO' ? 'EFECTIVO' : null);

  return {
    paymentRows: normalizedPayments,
    amountReceived: paymentTotal,
    changeAmount,
    method: storedMethod,
    referenceCode: storedReferenceCode,
    cashReceived,
    paymentSummary: buildPaymentSummaryText(normalizedPayments),
  };
};

module.exports = {
  PAYMENT_METHODS,
  PAYMENT_DETAIL_METHODS,
  PAYMENT_METHOD_LABELS,
  buildPaymentSummaryText,
  formatPaymentAmount,
  normalizeTransactionPayments,
  round2,
};
