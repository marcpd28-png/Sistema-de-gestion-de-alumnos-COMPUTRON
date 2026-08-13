export const toMoneyNumber = (value) => {
  if (value === undefined || value === null) return 0;
  const normalized = String(value).trim().replace(',', '.');
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
};

export const normalizeMoneyInput = (value) => {
  const normalized = String(value || '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  const [integerPart, ...decimalParts] = normalized.split('.');
  const decimals = decimalParts.join('').slice(0, 2);
  return decimalParts.length > 0 ? `${integerPart}.${decimals}` : integerPart;
};

export const round2 = (value) => Number(toMoneyNumber(value).toFixed(2));

export const calculateCashCartTotals = ({ cartItems = [], paymentLines = [] } = {}) => {
  const totalAmount = round2(
    cartItems.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * toMoneyNumber(item.unit_price),
      0,
    ),
  );
  const hasPaymentInput = paymentLines.some((payment) => String(payment.amount || '').trim() !== '');
  const enteredPaymentTotal = round2(
    paymentLines.reduce((sum, payment) => sum + toMoneyNumber(payment.amount), 0),
  );
  const enteredCashReceived = round2(
    paymentLines
      .filter((payment) => payment.method === 'EFECTIVO')
      .reduce((sum, payment) => sum + toMoneyNumber(payment.amount), 0),
  );
  const enteredDigitalReceived = round2(
    paymentLines
      .filter((payment) => payment.method !== 'EFECTIVO')
      .reduce((sum, payment) => sum + toMoneyNumber(payment.amount), 0),
  );
  const firstPaymentMethod = paymentLines[0]?.method || 'EFECTIVO';
  const cashReceived = hasPaymentInput
    ? enteredCashReceived
    : firstPaymentMethod === 'EFECTIVO'
      ? totalAmount
      : 0;
  const digitalReceived = hasPaymentInput
    ? enteredDigitalReceived
    : firstPaymentMethod !== 'EFECTIVO'
      ? totalAmount
      : 0;
  const amountReceived = round2(hasPaymentInput ? enteredPaymentTotal : totalAmount);
  const changeAmount = round2(Math.max(amountReceived - totalAmount, 0));
  const invalidChangeAmount = changeAmount > cashReceived + 0.000001 ? changeAmount : 0;
  const cashNetAmount = round2(Math.max(cashReceived - changeAmount, 0));
  const missingAmount = round2(Math.max(totalAmount - amountReceived, 0));

  return {
    totalAmount,
    amountReceived,
    cashReceived,
    cashNetAmount,
    digitalReceived,
    changeAmount,
    invalidChangeAmount,
    missingAmount,
  };
};

export const normalizeCashPaymentsForSubmit = ({ paymentLines = [], totalAmount = 0 } = {}) => {
  const hasPaymentInput = paymentLines.some((payment) => String(payment.amount || '').trim() !== '');
  const normalizedPayments = (hasPaymentInput
    ? paymentLines
    : [
        {
          ...paymentLines[0],
          amount: round2(totalAmount).toFixed(2),
        },
      ])
    .map((payment) => ({
      method: payment.method,
      amount: round2(payment.amount),
      reference_code: String(payment.reference_code || '').trim() || null,
    }))
    .filter((payment) => payment.amount > 0);

  if (!normalizedPayments.length) {
    throw new Error('Ingresa al menos un método de pago con importe.');
  }

  const paymentTotal = round2(normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0));
  if (paymentTotal + 0.000001 < round2(totalAmount)) {
    throw new Error('El monto cobrado no puede ser menor al total.');
  }

  const missingReference = normalizedPayments.find(
    (payment) => payment.method !== 'EFECTIVO' && !payment.reference_code,
  );
  if (missingReference) {
    throw new Error('Ingresa el número de operación para cada método no efectivo.');
  }

  const cashReceived = round2(
    normalizedPayments
      .filter((payment) => payment.method === 'EFECTIVO')
      .reduce((sum, payment) => sum + payment.amount, 0),
  );
  const changeToReturn = round2(Math.max(paymentTotal - round2(totalAmount), 0));
  if (changeToReturn > cashReceived + 0.000001) {
    throw new Error('El vuelto debe salir del efectivo recibido. Ajusta el pago en efectivo.');
  }

  return {
    payments: normalizedPayments.map((payment) => ({
      ...payment,
      reference_code: payment.method === 'EFECTIVO' ? payment.reference_code || null : payment.reference_code,
    })),
    amountReceived: paymentTotal,
    changeToReturn,
  };
};
