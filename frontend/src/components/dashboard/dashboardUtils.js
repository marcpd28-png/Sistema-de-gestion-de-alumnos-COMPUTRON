const PAYMENT_STATUS_LABELS = {
  COMPLETED: 'Completado',
  PENDING: 'Pendiente',
  REJECTED: 'Rechazado',
};

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

export const CHART_COLORS = ['#1d4ed8', '#f97316', '#0f766e', '#dc2626', '#7c3aed', '#0891b2'];

export const toPaymentStatusLabel = (status) => {
  const key = String(status || '').toUpperCase();
  return PAYMENT_STATUS_LABELS[key] || status || '-';
};

export const toPaymentMethodLabel = (method) => {
  const key = String(method || '').toUpperCase();
  return PAYMENT_METHOD_LABELS[key] || method || '-';
};

export const formatCurrency = (value) => `S/ ${Number(value || 0).toFixed(2)}`;

export const formatShortDate = (value) => {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
};

export const buildConicSegments = (items) => {
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
  if (!total) return 'conic-gradient(#e2e8f0 0 360deg)';

  let offset = 0;
  const segments = items.map((item, index) => {
    const share = (Number(item.value || 0) / total) * 360;
    const start = offset;
    const end = offset + share;
    offset = end;
    return `${item.color || CHART_COLORS[index % CHART_COLORS.length]} ${start}deg ${end}deg`;
  });

  return `conic-gradient(${segments.join(', ')})`;
};

export const createDashboardViewModel = ({ summary, hideIncome = false } = {}) => {
  const totals = summary?.totals || {};
  const recentPayments = summary?.recent_payments || [];
  const morosity = summary?.morosity || [];
  const chartSummary = summary?.charts || {};
  const cashRegisterSummary = summary?.cash_register || {};
  const visibility = summary?.visibility || {};

  const rawStatusItems = chartSummary.payment_status || [];
  const rawMethodItems = chartSummary.payment_methods || [];

  const totalStatusCount = rawStatusItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const totalMethodAmount = rawMethodItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const paymentStatusChart = rawStatusItems.map((item, index) => {
    const value = Number(item.total || 0);
    const share = totalStatusCount > 0 ? (value / totalStatusCount) * 100 : 0;
    return {
      key: item.status,
      label: toPaymentStatusLabel(item.status),
      value,
      color: CHART_COLORS[index % CHART_COLORS.length],
      detail: formatCurrency(item.amount),
      amount: Number(item.amount || 0),
      shareLabel: `${share.toFixed(1)}% del total`,
    };
  });

  const paymentMethodsChart = rawMethodItems.map((item, index) => {
    const amount = Number(item.amount || 0);
    const share = totalMethodAmount > 0 ? (amount / totalMethodAmount) * 100 : 0;
    return {
      key: item.method,
      label: toPaymentMethodLabel(item.method),
      value: amount,
      color: CHART_COLORS[index % CHART_COLORS.length],
      detail: `${Number(item.total || 0)} pago(s)`,
      total: Number(item.total || 0),
      shareLabel: `${share.toFixed(1)}% del monto`,
    };
  });

  return {
    totals,
    visibility,
    recentPayments,
    morosity,
    cashRegister: {
      today: cashRegisterSummary.today || {},
      openSession: cashRegisterSummary.open_session || {},
      recentTransactions: cashRegisterSummary.recent_transactions || [],
    },
    paymentStatusChart,
    paymentMethodsChart,
    paymentsByDayChart: chartSummary.payments_by_day || [],
    morosityByCampusChart: chartSummary.morosity_by_campus || [],
    incomeValue: visibility.payments
      ? hideIncome
        ? '••••••'
        : formatCurrency(totals.income || 0)
      : '-',
    incomeHint: visibility.payments
      ? hideIncome
        ? 'Monto facturado oculto'
        : 'Acumulado total'
      : 'Sin permiso',
  };
};
