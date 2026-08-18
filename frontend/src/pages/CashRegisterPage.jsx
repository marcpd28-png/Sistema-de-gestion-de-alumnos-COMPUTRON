import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Lock,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  Trash2,
  Unlock,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../constants/permissions';
import { getCampusScopeId } from '../utils/campusScope';
import {
  calculateCashCartTotals,
  normalizeCashPaymentsForSubmit,
  normalizeMoneyInput,
  round2,
  toMoneyNumber,
} from '../utils/cashPayments';

const PAYMENT_METHOD_LABELS = {
  EFECTIVO: 'Efectivo',
  YAPE: 'Yape',
  PLIN: 'Plin',
  TRANSFERENCIA: 'Transferencia',
  QR: 'QR',
  TARJETA: 'Tarjeta',
  CANJE: 'Canje',
  OTRO: 'Otro',
  MIXTO: 'Mixto',
};

const PAYMENT_LINE_METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABELS).filter(
  ([value]) => value !== 'MIXTO',
);

const RECEIPT_DOCUMENT_TYPE_LABELS = {
  BOLETA: 'Boleta',
  FACTURA: 'Factura',
  RECIBO_INTERNO: 'Recibo interno',
};

const DEFAULT_RECEIPT_FORMAT = 'F3';
const RECEIPT_FORMAT_LABELS = {
  F3: 'Computron',
  F2: 'A4 simple',
  F1: 'Ticket',
};
const DEFAULT_RECEIPT_PAPER_SIZE = 'A5';
const RECEIPT_PAPER_SIZE_LABELS = {
  A5: 'A5 doble',
  A4_DUPLICATE: 'A4 doble',
};

const SUNAT_STATUS_LABELS = {
  PENDIENTE: 'Pendiente',
  PROCESANDO: 'Procesando',
  ENVIADO: 'Enviado',
  ACEPTADO: 'Aceptado',
  RECHAZADO: 'Rechazado',
  ERROR: 'Error',
};

const getSunatStatusClassName = (status) => {
  const normalized = String(status || 'PENDIENTE').toUpperCase();
  if (normalized === 'ACEPTADO') return 'bg-emerald-100 text-emerald-800';
  if (normalized === 'ENVIADO' || normalized === 'PROCESANDO') return 'bg-blue-100 text-blue-800';
  if (normalized === 'RECHAZADO' || normalized === 'ERROR') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-800';
};

const isSunatDocumentType = (documentType) => ['BOLETA', 'FACTURA'].includes(documentType);

const CASH_INITIAL_LIMIT = 12;
const CASH_LOAD_STEP = 12;
const QUICK_CASH_AMOUNTS = [20, 50, 100, 200];

const saleDefaults = {
  student_id: '',
  customer_name: '',
  customer_document: '',
  customer_address: '',
  receipt_document_type: 'BOLETA',
  billing_name: '',
  billing_document: '',
  billing_address: '',
  notes: '',
};

const createPaymentLine = () => ({
  temp_id: `payment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  method: 'EFECTIVO',
  amount: '',
  reference_code: '',
});

const serviceDefaults = {
  name: '',
  description: '',
  default_price: '',
  sort_order: '',
  is_active: true,
};

const formatCurrency = (value) => `S/ ${round2(value).toFixed(2)}`;

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('es-PE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const getTodayIsoDate = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const getApiErrorMessage = (requestError, fallbackMessage) => {
  const payload = requestError?.response?.data;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      if (parsed?.message) return parsed.message;
    } catch {
      // non-JSON text response
    }
  }
  return payload?.message || requestError?.message || fallbackMessage;
};

const openReceiptWindow = (title) => {
  const popup = window.open('about:blank', '_blank');
  if (!popup) return null;

  popup.document.open();
  popup.document.write(
    `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 24px; color: #1f2937; }
      .hint { color: #475569; font-size: 14px; }
    </style>
  </head>
  <body>
    <h2>Generando comprobante...</h2>
    <p class="hint">Espera un momento.</p>
  </body>
</html>`,
  );
  popup.document.close();

  return popup;
};

const renderReceiptWindow = (popup, html) => {
  if (!popup || popup.closed) return;
  popup.document.open();
  popup.document.write(html || '');
  popup.document.close();
};

const YieldToBrowser = () =>
  new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    window.requestAnimationFrame(() => resolve());
  });

export default function CashRegisterPage() {
  const { hasPermission, refreshUser } = useAuth();
  const canViewCash = hasPermission(PERMISSIONS.CASH_REGISTER_VIEW);
  const canManageCash = hasPermission(PERMISSIONS.CASH_REGISTER_MANAGE);
  const canViewStudents = hasPermission(PERMISSIONS.STUDENTS_VIEW);
  const canViewCampuses = hasPermission(PERMISSIONS.CAMPUSES_VIEW);

  const [services, setServices] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [students, setStudents] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [sunatConfig, setSunatConfig] = useState({ configured: false });

  const [saleForm, setSaleForm] = useState(saleDefaults);
  const [cartItems, setCartItems] = useState([]);
  const [paymentLines, setPaymentLines] = useState(() => [createPaymentLine()]);
  const [serviceForm, setServiceForm] = useState(serviceDefaults);
  const [editingServiceId, setEditingServiceId] = useState(null);

  const [studentSearch, setStudentSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('COMPLETED');
  const [dateFromFilter, setDateFromFilter] = useState(getTodayIsoDate);
  const [dateToFilter, setDateToFilter] = useState(getTodayIsoDate);
  const [visibleCount, setVisibleCount] = useState(CASH_INITIAL_LIMIT);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false);
  const [receiptFormat, setReceiptFormat] = useState(DEFAULT_RECEIPT_FORMAT);
  const [receiptPaperSize, setReceiptPaperSize] = useState(DEFAULT_RECEIPT_PAPER_SIZE);
  const [showServiceEditor, setShowServiceEditor] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('0.00');
  const [openingNotes, setOpeningNotes] = useState('');
  const [closingAmount, setClosingAmount] = useState('');
  const [closingNotes, setClosingNotes] = useState('');
  const [voidingTransactionId, setVoidingTransactionId] = useState(null);
  const [voidNotes, setVoidNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [savingSale, setSavingSale] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [savingService, setSavingService] = useState(false);
  const [savingVoid, setSavingVoid] = useState(false);
  const [sendingSunatId, setSendingSunatId] = useState(null);
  const [refreshingPermissions, setRefreshingPermissions] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const submitModeRef = useRef('save');

  const canAccessCash = canViewCash || canManageCash;

  const transactionFilterParams = useMemo(
    () => ({
      method: methodFilter === 'ALL' ? undefined : methodFilter,
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      date_from: dateFromFilter || undefined,
      date_to: dateToFilter || undefined,
    }),
    [dateFromFilter, dateToFilter, methodFilter, statusFilter],
  );

  const activeServices = useMemo(
    () => services.filter((service) => service.is_active),
    [services],
  );

  const cartTotals = useMemo(
    () => calculateCashCartTotals({ cartItems, paymentLines }),
    [cartItems, paymentLines],
  );
  const hasPaymentInput = useMemo(
    () => paymentLines.some((payment) => String(payment.amount || '').trim() !== ''),
    [paymentLines],
  );
  const cashDueAmount = round2(Math.max(cartTotals.totalAmount - cartTotals.digitalReceived, 0));
  const quickCashAmounts = useMemo(
    () =>
      QUICK_CASH_AMOUNTS.filter((amount) => amount > 0).map((amount) => ({
        label: `S/ ${amount}`,
        value: amount,
      })),
    [],
  );
  const missingPaymentReference = useMemo(
    () =>
      paymentLines.some((payment, index) => {
        if (payment.method === 'EFECTIVO') return false;
        const amount = toMoneyNumber(payment.amount);
        const shouldCountAsPayment = amount > 0 || (!hasPaymentInput && index === 0 && cartTotals.totalAmount > 0);
        return shouldCountAsPayment && !String(payment.reference_code || '').trim();
      }),
    [cartTotals.totalAmount, hasPaymentInput, paymentLines],
  );
  const saleSubmitBlocker = useMemo(() => {
    if (!currentSession) return 'Abre caja para cobrar.';
    if (!cartItems.length) return 'Agrega al menos un servicio.';
    if (!saleForm.customer_name.trim()) return 'Ingresa el cliente.';
    if (cartTotals.missingAmount > 0) return `Falta cobrar ${formatCurrency(cartTotals.missingAmount)}.`;
    if (cartTotals.invalidChangeAmount > 0) return 'El vuelto debe salir del efectivo recibido.';
    if (missingPaymentReference) return 'Falta número de operación.';
    return '';
  }, [cartItems.length, cartTotals.invalidChangeAmount, cartTotals.missingAmount, currentSession, missingPaymentReference, saleForm.customer_name]);
  const canSubmitSale = Boolean(canManageCash && currentSession && !savingSale && !saleSubmitBlocker);

  const sessionSummary = currentSession?.summary || {};
  const expectedCashAmount = currentSession
    ? round2(currentSession.current_expected_cash_amount ?? currentSession.opening_amount)
    : 0;

  const loadServices = useCallback(async () => {
    if (!canAccessCash) return;

    try {
      const response = await api.get('/cash-register/services');
      setServices(response.data?.items || []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No se pudo cargar el catálogo de caja.'));
    }
  }, [canAccessCash]);

  const loadSunatConfig = useCallback(async () => {
    if (!canAccessCash) return;

    try {
      const response = await api.get('/cash-register/sunat/config');
      setSunatConfig(response.data || { configured: false });
    } catch {
      setSunatConfig({ configured: false });
    }
  }, [canAccessCash]);

  const loadCurrentSession = useCallback(async () => {
    if (!canAccessCash) return;

    try {
      const response = await api.get('/cash-register/sessions/current');
      setCurrentSession(response.data?.item || null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No se pudo cargar la sesión de caja.'));
    }
  }, [canAccessCash]);

  const loadSessions = useCallback(async () => {
    if (!canAccessCash) return;

    try {
      const response = await api.get('/cash-register/sessions');
      setSessions(response.data?.items || []);
    } catch {
      setSessions([]);
    }
  }, [canAccessCash]);

  const loadTransactions = useCallback(
    async ({ limit = visibleCount } = {}) => {
      if (!canAccessCash) return;

      setLoading(true);
      try {
        const response = await api.get('/cash-register/transactions', {
          params: {
            ...transactionFilterParams,
            page: 1,
            page_size: limit,
            include_total: false,
          },
        });
        const items = response.data?.items || [];
        const meta = response.data?.meta || {};
        setTransactions(items);
        setHasMoreTransactions(Boolean(meta.has_more));
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, 'No se pudieron cargar los movimientos de caja.'));
      } finally {
        setLoading(false);
      }
    },
    [canAccessCash, transactionFilterParams, visibleCount],
  );

  const loadStudents = useCallback(async () => {
    if (!canViewStudents) {
      setStudents([]);
      return;
    }

    setLoadingStudents(true);
    try {
      const response = await api.get('/students', {
        params: {
          q: studentSearch.trim() || undefined,
          page: 1,
          page_size: 25,
        },
      });
      setStudents(response.data?.items || []);
    } catch {
      setStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  }, [canViewStudents, studentSearch]);

  const loadCampuses = useCallback(async () => {
    if (!canViewCampuses) return;

    try {
      const response = await api.get('/campuses', { _skipCampusScope: true });
      setCampuses(response.data?.items || []);
    } catch {
      setCampuses([]);
    }
  }, [canViewCampuses]);

  const refreshCashData = useCallback(async () => {
    await Promise.all([loadCurrentSession(), loadSessions(), loadTransactions()]);
  }, [loadCurrentSession, loadSessions, loadTransactions]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  useEffect(() => {
    loadSunatConfig();
  }, [loadSunatConfig]);

  useEffect(() => {
    refreshCashData();
  }, [refreshCashData]);

  useEffect(() => {
    loadCampuses();
  }, [loadCampuses]);

  useEffect(() => {
    if (!studentSearch.trim()) {
      setStudents([]);
      return;
    }
    const timeoutId = window.setTimeout(loadStudents, 350);
    return () => window.clearTimeout(timeoutId);
  }, [loadStudents, studentSearch]);

  const resetSale = () => {
    setSaleForm(saleDefaults);
    setCartItems([]);
    setPaymentLines([createPaymentLine()]);
    setStudentSearch('');
  };

  const addServiceToCart = (service) => {
    setCartItems((current) => {
      const existing = current.find((item) => String(item.service_item_id) === String(service.id));
      if (existing) {
        return current.map((item) =>
          String(item.service_item_id) === String(service.id)
            ? {
                ...item,
                quantity: Number(item.quantity || 1) + 1,
              }
            : item,
        );
      }

      return [
        ...current,
        {
          temp_id: `service-${service.id}-${Date.now()}`,
          service_item_id: Number(service.id),
          description: service.name,
          quantity: 1,
          unit_price: round2(service.default_price),
        },
      ];
    });

  };

  const addCustomItem = () => {
    setCartItems((current) => [
      ...current,
      {
        temp_id: `custom-${Date.now()}`,
        service_item_id: null,
        description: 'SERVICIO ADMINISTRATIVO',
        quantity: 1,
        unit_price: 0,
      },
    ]);
  };

  const updateCartItem = (index, patch) => {
    setCartItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    );
  };

  const removeCartItem = (index) => {
    setCartItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const addPaymentLine = () => {
    setPaymentLines((current) => [...current, createPaymentLine()]);
  };

  const applyQuickCashAmount = (amount) => {
    const normalizedAmount = round2(amount).toFixed(2);
    setPaymentLines((current) => {
      const existingLines = current.length ? current : [createPaymentLine()];
      const cashIndex = existingLines.findIndex((payment) => payment.method === 'EFECTIVO');

      if (cashIndex >= 0) {
        return existingLines.map((payment, paymentIndex) =>
          paymentIndex === cashIndex
            ? {
                ...payment,
                method: 'EFECTIVO',
                amount: normalizedAmount,
                reference_code: '',
              }
            : payment,
        );
      }

      return [
        {
          ...createPaymentLine(),
          method: 'EFECTIVO',
          amount: normalizedAmount,
          reference_code: '',
        },
        ...existingLines,
      ];
    });
  };

  const updatePaymentLine = (index, patch) => {
    setPaymentLines((current) =>
      current.map((payment, paymentIndex) =>
        paymentIndex === index
          ? {
              ...payment,
              ...patch,
            }
          : payment,
      ),
    );
  };

  const removePaymentLine = (index) => {
    setPaymentLines((current) => {
      const next = current.filter((_, paymentIndex) => paymentIndex !== index);
      return next.length ? next : [createPaymentLine()];
    });
  };

  const normalizePaymentLinesForSubmit = () => {
    try {
      return normalizeCashPaymentsForSubmit({
        paymentLines,
        totalAmount: cartTotals.totalAmount,
      });
    } catch (error) {
      const message = error?.message || 'Revisa los métodos de pago.';
      if (message.includes('número de operación')) {
        throw new Error('Ingresa el número de operación para cada método no efectivo.');
      }
      throw error;
    }
  };

  const selectStudent = (student) => {
    const fullName = `${student.first_name || ''} ${student.last_name || ''}`.trim();
    setSaleForm((prev) => ({
      ...prev,
      student_id: student.id ? String(student.id) : '',
      customer_name: fullName || prev.customer_name,
      customer_document: student.document_number || prev.customer_document,
      customer_address: student.address || prev.customer_address,
    }));
    setStudentSearch(fullName);
    setStudents([]);
  };

  const openCashSession = async (event) => {
    event.preventDefault();
    if (!canManageCash) return;

    setSavingSession(true);
    setMessage('');
    setError('');

    try {
      const campusId = getCampusScopeId();
      await YieldToBrowser();
      await api.post('/cash-register/sessions/open', {
        campus_id: campusId || undefined,
        opening_amount: round2(openingAmount || 0),
        notes: openingNotes.trim() || null,
      });
      setOpeningAmount('0.00');
      setOpeningNotes('');
      setMessage('Caja abierta correctamente.');
      await refreshCashData();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No se pudo abrir la caja.'));
    } finally {
      setSavingSession(false);
    }
  };

  const closeCashSession = async (event) => {
    event.preventDefault();
    if (!canManageCash || !currentSession?.id) return;

    setSavingSession(true);
    setMessage('');
    setError('');

    try {
      await YieldToBrowser();
      await api.patch(`/cash-register/sessions/${currentSession.id}/close`, {
        closing_amount: round2(closingAmount),
        notes: closingNotes.trim() || null,
      });
      setClosingAmount('');
      setClosingNotes('');
      setMessage('Caja cerrada correctamente.');
      await refreshCashData();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No se pudo cerrar la caja.'));
    } finally {
      setSavingSession(false);
    }
  };

  const openCashReceipt = useCallback(
    async (
      transactionId,
      {
        silent = false,
        format = receiptFormat,
        paperSize = receiptPaperSize,
        autoPrint = false,
        targetWindow = null,
        campusId = null,
      } = {},
    ) => {
      if (!transactionId) return;

      const receiptWindow = targetWindow || openReceiptWindow('Comprobante de caja');
      if (!receiptWindow) {
        if (!silent) {
          setError('El navegador bloqueó la apertura del comprobante. Habilita ventanas emergentes e intenta de nuevo.');
        }
        return;
      }

      try {
        const response = await api.get(`/cash-register/transactions/${transactionId}/receipt`, {
          params: {
            format,
            paper_size: paperSize,
            campus_id: campusId || undefined,
            _t: Date.now(),
          },
        });
        renderReceiptWindow(receiptWindow, response.data || '');

        if (autoPrint) {
          receiptWindow.focus();
          receiptWindow.setTimeout(() => {
            if (!receiptWindow.closed) {
              receiptWindow.focus();
              receiptWindow.print();
            }
          }, 650);
        }
      } catch (requestError) {
        if (!receiptWindow.closed) {
          receiptWindow.close();
        }
        if (!silent) {
          setError(getApiErrorMessage(requestError, 'No se pudo emitir el comprobante de caja.'));
        }
      }
    },
    [receiptFormat, receiptPaperSize],
  );

  const submitSale = async (event) => {
    event.preventDefault();
    if (!canManageCash) return;
    const shouldPrintReceipt = submitModeRef.current === 'print';
    let receiptWindow = null;

    setSavingSale(true);
    setMessage('');
    setError('');

    try {
      if (!currentSession?.id) {
        throw new Error('Abre caja antes de registrar una operación.');
      }
      const cashCampusId = Number(currentSession?.campus_id || getCampusScopeId() || 0);
      if (!cashCampusId) {
        throw new Error('La caja abierta no tiene una sede asociada. Vuelve a abrir caja seleccionando una sede.');
      }
      if (!saleForm.customer_name.trim()) {
        throw new Error('Ingresa el nombre del cliente o selecciona un alumno.');
      }
      if (!cartItems.length) {
        throw new Error('Agrega al menos un servicio.');
      }

      const normalizedItems = cartItems.map((item) => {
        const quantity = Number(item.quantity || 0);
        const unitPrice = round2(item.unit_price);
        const total = round2(quantity * unitPrice);
        if (!item.description.trim() || quantity <= 0 || unitPrice < 0 || total <= 0) {
          throw new Error('Revisa los servicios: descripción, cantidad y precio deben ser válidos.');
        }
        return {
          service_item_id: item.service_item_id ? Number(item.service_item_id) : null,
          description: item.description.trim(),
          quantity,
          unit_price: unitPrice,
        };
      });

      if (saleForm.receipt_document_type === 'FACTURA') {
        if (!/^\d{11}$/.test(saleForm.billing_document.trim())) {
          throw new Error('El RUC debe tener exactamente 11 dígitos.');
        }
        if (saleForm.billing_name.trim().length < 2) {
          throw new Error('Ingresa la razón social para la factura.');
        }
        if (saleForm.billing_address.trim().length < 3) {
          throw new Error('Ingresa la dirección fiscal para la factura.');
        }
      }

      const normalizedPayment = normalizePaymentLinesForSubmit();
      const method =
        normalizedPayment.payments.length > 1 ? 'MIXTO' : normalizedPayment.payments[0].method;
      const referenceCode =
        normalizedPayment.payments.length > 1
          ? 'PAGO MIXTO'
          : normalizedPayment.payments[0].reference_code || null;

      receiptWindow = openReceiptWindow(
        shouldPrintReceipt ? 'Comprobante de caja para imprimir' : 'Comprobante de caja',
      );
      if (!receiptWindow) {
        throw new Error('El navegador bloqueó la boleta. Habilita ventanas emergentes para este sitio.');
      }

      await YieldToBrowser();

      const response = await api.post('/cash-register/transactions', {
        session_id: Number(currentSession.id),
        campus_id: cashCampusId,
        student_id: saleForm.student_id ? Number(saleForm.student_id) : null,
        customer_name: saleForm.customer_name.trim(),
        customer_document: saleForm.customer_document.trim() || null,
        customer_address: saleForm.customer_address.trim() || null,
        method,
        reference_code: referenceCode,
        amount_received: normalizedPayment.amountReceived,
        payments: normalizedPayment.payments,
        receipt_document_type: saleForm.receipt_document_type,
        billing_name: saleForm.billing_name.trim() || null,
        billing_document: saleForm.billing_document.trim() || null,
        billing_address: saleForm.billing_address.trim() || null,
        notes: saleForm.notes.trim() || null,
        items: normalizedItems,
      });

      const transactionId = response.data?.item?.id;
      const resultParts = [`Operación registrada por ${formatCurrency(cartTotals.totalAmount)}.`];
      if (normalizedPayment.changeToReturn > 0) {
        resultParts.push(`Vuelto a entregar: ${formatCurrency(normalizedPayment.changeToReturn)}.`);
      }
      setMessage(resultParts.join(' '));
      if (transactionId) {
        await openCashReceipt(transactionId, {
          silent: false,
          format: receiptFormat,
          paperSize: receiptPaperSize,
          autoPrint: shouldPrintReceipt,
          targetWindow: receiptWindow,
          campusId: cashCampusId,
        });
      } else {
        renderReceiptWindow(
          receiptWindow,
          '<!doctype html><html lang="es"><body><h2>No se pudo obtener el comprobante</h2><p>La operación fue registrada, pero el servidor no devolvió el identificador.</p></body></html>',
        );
      }
      resetSale();
      setVisibleCount(CASH_INITIAL_LIMIT);
      await refreshCashData();
    } catch (requestError) {
      if (receiptWindow && !receiptWindow.closed) {
        receiptWindow.close();
      }
      setError(getApiErrorMessage(requestError, 'No se pudo registrar la operación de caja.'));
    } finally {
      submitModeRef.current = 'save';
      setSavingSale(false);
    }
  };

  const saveService = async (event) => {
    event.preventDefault();
    if (!canManageCash) return;

    setSavingService(true);
    setMessage('');
    setError('');

    try {
      await YieldToBrowser();
      const payload = {
        name: serviceForm.name.trim(),
        description: serviceForm.description.trim() || null,
        default_price: round2(serviceForm.default_price),
        sort_order: Number(serviceForm.sort_order || 0),
        is_active: Boolean(serviceForm.is_active),
      };

      if (editingServiceId) {
        await api.patch(`/cash-register/services/${editingServiceId}`, payload);
        setMessage('Servicio actualizado.');
      } else {
        await api.post('/cash-register/services', payload);
        setMessage('Servicio creado.');
      }

      setServiceForm(serviceDefaults);
      setEditingServiceId(null);
      await loadServices();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No se pudo guardar el servicio.'));
    } finally {
      setSavingService(false);
    }
  };

  const editService = (service) => {
    setEditingServiceId(service.id);
    setShowServiceEditor(true);
    setServiceForm({
      name: service.name || '',
      description: service.description || '',
      default_price: round2(service.default_price).toFixed(2),
      sort_order: String(service.sort_order || ''),
      is_active: Boolean(service.is_active),
    });
  };

  const confirmVoidTransaction = async () => {
    if (!voidingTransactionId || !voidNotes.trim()) return;

    setSavingVoid(true);
    setMessage('');
    setError('');

    try {
      await YieldToBrowser();
      await api.patch(`/cash-register/transactions/${voidingTransactionId}/void`, {
        notes: voidNotes.trim(),
      });
      setVoidingTransactionId(null);
      setVoidNotes('');
      setMessage('Operación anulada.');
      await refreshCashData();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No se pudo anular la operación.'));
    } finally {
      setSavingVoid(false);
    }
  };

  const sendTransactionToSunat = async (transaction) => {
    if (!canManageCash || !transaction?.id) return;
    if (!sunatConfig?.configured) {
      setError('SUNAT no está configurado. Completa las variables SUNAT_API_* en el backend.');
      return;
    }
    if (!['BOLETA', 'FACTURA'].includes(transaction.receipt_document_type)) {
      setError('Solo boletas y facturas pueden enviarse a SUNAT.');
      return;
    }

    setSendingSunatId(transaction.id);
    setMessage('');
    setError('');

    try {
      const response = await api.post(
        `/cash-register/transactions/${transaction.id}/send-sunat`,
        {},
        { params: { campus_id: transaction.campus_id || undefined } },
      );
      setMessage(response.data?.message || 'Comprobante enviado a SUNAT.');
      await loadTransactions();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No se pudo enviar el comprobante a SUNAT.'));
      await loadTransactions();
    } finally {
      setSendingSunatId(null);
    }
  };

  const refreshCashPermissions = async () => {
    setRefreshingPermissions(true);
    setMessage('');
    setError('');

    try {
      await refreshUser?.();
      setMessage('Permisos actualizados. Si tu rol tiene gestión de caja, ya deberías ver la apertura.');
    } catch {
      setError('No se pudieron refrescar tus permisos. Cierra sesión y vuelve a ingresar.');
    } finally {
      setRefreshingPermissions(false);
    }
  };

  const clearFilters = () => {
    setMethodFilter('ALL');
    setStatusFilter('COMPLETED');
    setDateFromFilter(getTodayIsoDate());
    setDateToFilter(getTodayIsoDate());
    setVisibleCount(CASH_INITIAL_LIMIT);
  };

  if (!canAccessCash) {
    return (
      <section className="card">
        <h1 className="text-xl font-semibold">Caja</h1>
        <p className="mt-2 text-sm text-primary-700">No tienes permisos para acceder a este módulo.</p>
      </section>
    );
  }

  return (
    <section className="app-page">
      <div className="app-page-header">
        <div>
          <h1 className="app-title">Caja</h1>
          <p className="app-subtitle">Registra servicios, pagos mixtos, vuelto y comprobantes desde una operación única.</p>
        </div>
        <div className="app-toolbar">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
              currentSession ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {currentSession ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {currentSession ? `Caja abierta #${currentSession.id}` : 'Caja cerrada'}
          </span>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
              sunatConfig?.configured ? 'bg-blue-100 text-blue-800' : 'bg-primary-100 text-primary-700'
            }`}
          >
            <Send className="h-3.5 w-3.5" />
            {sunatConfig?.configured ? 'SUNAT listo' : 'SUNAT pendiente'}
          </span>
          <select
            className="app-input app-input-compact"
            value={receiptFormat}
            onChange={(event) => setReceiptFormat(event.target.value)}
            aria-label="Diseño de comprobante"
          >
            <option value="F3">Computron</option>
            <option value="F2">A4 simple</option>
            <option value="F1">Ticket</option>
          </select>
          <select
            className="app-input app-input-compact"
            value={receiptPaperSize}
            onChange={(event) => setReceiptPaperSize(event.target.value)}
            aria-label="Tamaño de papel"
          >
            {Object.entries(RECEIPT_PAPER_SIZE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {canManageCash ? (
            <button
              type="button"
              onClick={() => setShowServiceEditor((current) => !current)}
              className="btn-secondary"
            >
              <Settings2 className="h-4 w-4" />
              Servicios
            </button>
          ) : null}
        </div>
      </div>

      {message ? <p className="app-alert app-alert-info">{message}</p> : null}
      {error ? <p className="app-alert app-alert-danger">{error}</p> : null}

      {!currentSession ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <article className="overflow-hidden rounded-lg border border-amber-200 bg-white">
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                  <Lock className="h-3.5 w-3.5" />
                  Caja cerrada
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-primary-700">
                  {activeServices.length} servicios activos
                </span>
              </div>
              <h2 className="mt-3 text-xl font-semibold text-primary-950">Abrir caja para comenzar</h2>
              <p className="mt-1 text-sm text-slate-600">
                Define el efectivo inicial y la sede activa antes de registrar cobros.
              </p>
            </div>

            <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
              {canManageCash ? (
                <form onSubmit={openCashSession} className="space-y-4">
                  {canViewCampuses && campuses.length ? (
                    <p className="rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-sm text-primary-800">
                      Se abrirá en la sede activa del selector superior.
                    </p>
                  ) : null}
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase text-primary-700">Monto inicial en efectivo</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="app-input text-lg font-semibold"
                      placeholder="0.00"
                      value={openingAmount}
                      onChange={(event) => setOpeningAmount(normalizeMoneyInput(event.target.value))}
                      required
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase text-primary-700">Nota de apertura</span>
                    <input
                      className="app-input"
                      maxLength={400}
                      placeholder="Opcional"
                      value={openingNotes}
                      onChange={(event) => setOpeningNotes(event.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={savingSession}
                    className="btn-success w-full"
                  >
                    <Unlock className="h-4 w-4" />
                    {savingSession ? 'Abriendo...' : 'Abrir caja ahora'}
                  </button>
                </form>
              ) : (
                <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
                  <p className="font-semibold text-amber-900">No tienes permiso para abrir caja.</p>
                  <p className="mt-1 text-sm text-amber-800">
                    Necesitas el permiso cash_register.manage para iniciar operaciones.
                  </p>
                  <button
                    type="button"
                    onClick={refreshCashPermissions}
                    disabled={refreshingPermissions}
                    className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
                  >
                    {refreshingPermissions ? 'Refrescando...' : 'Refrescar permisos'}
                  </button>
                </div>
              )}

              <div className="space-y-3">
                <div className="metric-tile bg-white">
                  <p className="metric-label">Comprobante</p>
                  <p className="metric-value">
                    {RECEIPT_FORMAT_LABELS[receiptFormat] || 'Computron'} ·{' '}
                    {RECEIPT_PAPER_SIZE_LABELS[receiptPaperSize] || 'A5 doble'}
                  </p>
                </div>
                <div className="metric-tile bg-white">
                  <p className="metric-label">SUNAT</p>
                  <p className="metric-value">{sunatConfig?.configured ? 'Listo' : 'Pendiente'}</p>
                </div>
                <div className="metric-tile bg-white">
                  <p className="metric-label">Última revisión</p>
                  <p className="metric-value">{sessions.length ? formatDateTime(sessions[0]?.opened_at) : 'Sin sesiones'}</p>
                </div>
              </div>
            </div>
          </article>

          <aside className="space-y-4">
            <article className="card space-y-3">
              <h2 className="text-lg font-semibold text-primary-900">Últimas sesiones</h2>
              <div className="space-y-2">
                {sessions.slice(0, 4).map((session) => (
                  <div key={session.id} className="rounded-lg border border-primary-100 bg-white p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-primary-900">Caja #{session.id}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          session.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-primary-100 text-primary-700'
                        }`}
                      >
                        {session.status === 'OPEN' ? 'Abierta' : 'Cerrada'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-primary-600">{formatDateTime(session.opened_at)}</p>
                    <p className="mt-2 text-xs text-primary-700">
                      Total: {formatCurrency(session.summary?.total_completed)} · Efectivo:{' '}
                      {formatCurrency(session.summary?.cash_sales)}
                    </p>
                    {session.status === 'CLOSED' ? (
                      <p className="text-xs text-primary-700">
                        Dif.: {formatCurrency(session.difference_amount || 0)}
                      </p>
                    ) : null}
                  </div>
                ))}
                {!sessions.length ? <p className="text-sm text-primary-600">Sin sesiones registradas.</p> : null}
              </div>
            </article>
          </aside>
        </div>
      ) : (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <article className="panel-soft space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-primary-900">Operación actual</h2>
            </div>
            <button
              type="button"
              onClick={addCustomItem}
              disabled={!canManageCash || !currentSession}
              className="btn-secondary"
            >
              <Plus className="h-4 w-4" />
              Ítem libre
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {activeServices.map((service) => (
              <button
                type="button"
                key={service.id}
                onClick={() => addServiceToCart(service)}
                disabled={!canManageCash || !currentSession}
                className="service-tile"
              >
                <span className="line-clamp-2 text-xs font-bold text-primary-900">{service.name}</span>
                <span className="mt-2 text-base font-semibold text-emerald-700">{formatCurrency(service.default_price)}</span>
              </button>
            ))}
          </div>

          <form id="cash-sale-form" onSubmit={submitSale} className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-primary-100 bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-primary-600">
                    <th className="pb-2 pl-3 pr-3 pt-3">Servicio</th>
                    <th className="pb-2 pr-3 pt-3">Cant.</th>
                    <th className="pb-2 pr-3 pt-3">P. unit.</th>
                    <th className="pb-2 pr-3 pt-3">Total</th>
                    <th className="pb-2 pr-3 pt-3" aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {cartItems.map((item, index) => {
                    const total = round2(Number(item.quantity || 0) * toMoneyNumber(item.unit_price));
                    return (
                      <tr key={item.temp_id || `${item.service_item_id}-${index}`} className="border-t border-primary-100">
                        <td className="py-2 pl-3 pr-3">
                          <input
                            className="app-input min-w-[240px]"
                            value={item.description}
                            maxLength={180}
                            onChange={(event) => updateCartItem(index, { description: event.target.value })}
                            required
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            className="app-input w-20"
                            value={item.quantity}
                            onChange={(event) =>
                              updateCartItem(index, { quantity: Number(event.target.value || 1) })
                            }
                            required
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="text"
                            inputMode="decimal"
                            className="app-input w-28"
                            value={item.unit_price}
                            onChange={(event) =>
                              updateCartItem(index, { unit_price: normalizeMoneyInput(event.target.value) })
                            }
                            required
                          />
                        </td>
                        <td className="py-2 pr-3 font-semibold text-primary-900">{formatCurrency(total)}</td>
                        <td className="py-2 pr-3">
                          <button
                            type="button"
                            onClick={() => removeCartItem(index)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-100 text-red-600 transition hover:bg-red-50"
                            aria-label="Quitar servicio"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!cartItems.length ? (
                    <tr>
                      <td colSpan={5} className="py-5 text-center text-sm text-primary-600">
                        Agrega servicios desde el catálogo.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 lg:grid-cols-4">
              {canViewStudents ? (
                <label className="space-y-1 lg:col-span-2">
                  <span className="text-xs font-semibold uppercase text-primary-700">Buscar alumno</span>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary-500" />
                    <input
                      className="app-input pl-9"
                      placeholder="Nombre, DNI o teléfono"
                      value={studentSearch}
                      onChange={(event) => setStudentSearch(event.target.value)}
                    />
                  </div>
                  {students.length ? (
                    <div className="max-h-44 overflow-y-auto rounded-xl border border-primary-100 bg-white shadow-sm">
                      {students.map((student) => {
                        const fullName = `${student.first_name || ''} ${student.last_name || ''}`.trim();
                        return (
                          <button
                            key={student.id}
                            type="button"
                            onClick={() => selectStudent(student)}
                            className="block w-full border-b border-primary-50 px-3 py-2 text-left text-sm transition last:border-b-0 hover:bg-primary-50"
                          >
                            <span className="font-semibold text-primary-900">{fullName}</span>
                            <span className="ml-2 text-xs text-primary-600">{student.document_number || '-'}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {loadingStudents ? <span className="text-xs text-primary-600">Buscando alumnos...</span> : null}
                </label>
              ) : null}

              <label className={`space-y-1 ${canViewStudents ? 'lg:col-span-2' : 'lg:col-span-4'}`}>
                <span className="text-xs font-semibold uppercase text-primary-700">Cliente</span>
                <input
                  className="app-input"
                  placeholder="Nombre del cliente"
                  value={saleForm.customer_name}
                  onChange={(event) =>
                    setSaleForm((prev) => ({ ...prev, customer_name: event.target.value, student_id: '' }))
                  }
                  required
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-primary-700">Documento</span>
                <input
                  className="app-input"
                  maxLength={20}
                  placeholder="DNI / CE"
                  value={saleForm.customer_document}
                  onChange={(event) => setSaleForm((prev) => ({ ...prev, customer_document: event.target.value }))}
                />
              </label>

              <label className="space-y-1 lg:col-span-3">
                <span className="text-xs font-semibold uppercase text-primary-700">Dirección</span>
                <input
                  className="app-input"
                  maxLength={240}
                  placeholder="Opcional"
                  value={saleForm.customer_address}
                  onChange={(event) => setSaleForm((prev) => ({ ...prev, customer_address: event.target.value }))}
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-primary-700">Comprobante</span>
                <select
                  className="app-input"
                  value={saleForm.receipt_document_type}
                  onChange={(event) =>
                    setSaleForm((prev) => ({ ...prev, receipt_document_type: event.target.value }))
                  }
                >
                  {Object.entries(RECEIPT_DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 lg:col-span-3">
                <span className="text-xs font-semibold uppercase text-primary-700">Observación</span>
                <input
                  className="app-input"
                  maxLength={400}
                  placeholder="Opcional"
                  value={saleForm.notes}
                  onChange={(event) => setSaleForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </label>
            </div>

            <fieldset className="rounded-xl border border-primary-200 bg-white p-4">
              <legend className="px-2 text-sm font-semibold text-primary-900">Pagos</legend>
              <div className="space-y-3">
                {paymentLines.map((payment, index) => (
                  <div
                    key={payment.temp_id || index}
                    className="grid gap-2 rounded-lg border border-primary-100 bg-primary-50/40 p-3 lg:grid-cols-[160px_140px_minmax(0,1fr)_40px]"
                  >
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase text-primary-700">Método</span>
                      <select
                        className="app-input"
                        value={payment.method}
                        onChange={(event) =>
                          updatePaymentLine(index, {
                            method: event.target.value,
                            reference_code: event.target.value === 'EFECTIVO' ? '' : payment.reference_code,
                          })
                        }
                        required
                      >
                        {PAYMENT_LINE_METHOD_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase text-primary-700">Importe</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="app-input"
                        placeholder={index === 0 ? cartTotals.totalAmount.toFixed(2) : '0.00'}
                        value={payment.amount}
                        onChange={(event) =>
                          updatePaymentLine(index, { amount: normalizeMoneyInput(event.target.value) })
                        }
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase text-primary-700">
                        {payment.method === 'EFECTIVO' ? 'Referencia' : 'Nro. operación'}
                      </span>
                      <input
                        className="app-input"
                        maxLength={120}
                        placeholder={payment.method === 'EFECTIVO' ? 'Opcional' : 'Obligatorio'}
                        value={payment.reference_code}
                        onChange={(event) => updatePaymentLine(index, { reference_code: event.target.value })}
                        required={
                          payment.method !== 'EFECTIVO' &&
                          (toMoneyNumber(payment.amount) > 0 || (!hasPaymentInput && index === 0))
                        }
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => removePaymentLine(index)}
                      disabled={paymentLines.length === 1}
                      className="mt-6 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-100 bg-white text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Quitar método de pago"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={addPaymentLine}
                  className="btn-secondary"
                >
                  <Plus className="h-4 w-4" />
                  Agregar método
                </button>
                <p className="text-xs font-semibold text-primary-700">
                  Digital/otros: {formatCurrency(cartTotals.digitalReceived)}
                </p>
              </div>
            </fieldset>

            {saleForm.receipt_document_type === 'FACTURA' ? (
              <fieldset className="rounded-xl border border-primary-200 bg-primary-50/40 p-4">
                <legend className="px-2 text-sm font-semibold text-primary-900">Datos de facturación</legend>
                <div className="grid gap-3 lg:grid-cols-4">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase text-primary-700">RUC</span>
                    <input
                      className="app-input"
                      inputMode="numeric"
                      maxLength={11}
                      value={saleForm.billing_document}
                      onChange={(event) =>
                        setSaleForm((prev) => ({
                          ...prev,
                          billing_document: event.target.value.replace(/\D/g, '').slice(0, 11),
                        }))
                      }
                      required
                    />
                  </label>
                  <label className="space-y-1 lg:col-span-3">
                    <span className="text-xs font-semibold uppercase text-primary-700">Razón social</span>
                    <input
                      className="app-input"
                      maxLength={180}
                      value={saleForm.billing_name}
                      onChange={(event) => setSaleForm((prev) => ({ ...prev, billing_name: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="space-y-1 lg:col-span-4">
                    <span className="text-xs font-semibold uppercase text-primary-700">Dirección fiscal</span>
                    <input
                      className="app-input"
                      maxLength={240}
                      value={saleForm.billing_address}
                      onChange={(event) =>
                        setSaleForm((prev) => ({ ...prev, billing_address: event.target.value }))
                      }
                      required
                    />
                  </label>
                </div>
              </fieldset>
            ) : null}

            <div className="rounded-lg border border-primary-100 bg-slate-50 p-3 xl:hidden">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-600">Total</span>
                <span className="ui-numeric text-xl font-semibold text-primary-900">
                  {formatCurrency(cartTotals.totalAmount)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-600">Vuelto</span>
                <span className="ui-numeric text-xl font-semibold text-emerald-700">
                  {formatCurrency(cartTotals.changeAmount)}
                </span>
              </div>
            </div>
          </form>
        </article>

        <aside className="space-y-4">
          <article className="card space-y-4 border-emerald-200 xl:sticky xl:top-24">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-primary-900">Cobro</h2>
                <p className="text-xs text-slate-500">Totales y emisión</p>
              </div>
              {saleSubmitBlocker ? (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-700" />
              )}
            </div>

            <div className="rounded-lg bg-primary-900 p-4 text-white">
              <p className="text-xs font-semibold uppercase text-primary-100">Total a cobrar</p>
              <p className="ui-numeric mt-1 text-3xl font-semibold">{formatCurrency(cartTotals.totalAmount)}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-white/10 p-2">
                  <p className="text-primary-100">Cobrado</p>
                  <p className="ui-numeric font-semibold">{formatCurrency(cartTotals.amountReceived)}</p>
                </div>
                <div className="rounded-lg bg-white/10 p-2">
                  <p className="text-primary-100">Falta</p>
                  <p className="ui-numeric font-semibold">{formatCurrency(cartTotals.missingAmount)}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="metric-tile bg-white">
                <div className="flex items-center justify-between gap-2">
                  <p className="metric-label">Efectivo</p>
                  <Banknote className="h-4 w-4 text-primary-600" />
                </div>
                <p className="metric-value">{formatCurrency(cartTotals.cashReceived)}</p>
              </div>
              <div className="metric-tile bg-white">
                <div className="flex items-center justify-between gap-2">
                  <p className="metric-label">Digital</p>
                  <CreditCard className="h-4 w-4 text-primary-600" />
                </div>
                <p className="metric-value">{formatCurrency(cartTotals.digitalReceived)}</p>
              </div>
              <div className="metric-tile bg-white">
                <p className="metric-label">Efectivo caja</p>
                <p className="metric-value">{formatCurrency(cartTotals.cashNetAmount)}</p>
              </div>
              <div className="metric-tile bg-emerald-50">
                <p className="metric-label text-emerald-700">Vuelto</p>
                <p className="ui-numeric mt-1 text-2xl font-semibold text-emerald-800">
                  {formatCurrency(cartTotals.changeAmount)}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-primary-700">Efectivo rápido</p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => applyQuickCashAmount(cashDueAmount)}
                  disabled={cartTotals.totalAmount <= 0}
                  className="rounded-lg border border-primary-200 bg-white px-2 py-2 text-sm font-semibold text-primary-800 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Exacto
                </button>
                {quickCashAmounts.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => applyQuickCashAmount(option.value)}
                    disabled={cartTotals.totalAmount <= 0}
                    className="rounded-lg border border-primary-200 bg-white px-2 py-2 text-sm font-semibold text-primary-800 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {saleSubmitBlocker ? (
              <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                {saleSubmitBlocker}
              </p>
            ) : (
              <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                Listo para emitir comprobante.
              </p>
            )}

            <div className="space-y-2">
              <button
                type="submit"
                form="cash-sale-form"
                onClick={() => {
                  submitModeRef.current = 'save';
                }}
                disabled={!canSubmitSale}
                className="btn-primary w-full"
              >
                <Save className="h-4 w-4" />
                {savingSale ? 'Guardando...' : 'Guardar y emitir'}
              </button>
              <button
                type="submit"
                form="cash-sale-form"
                onClick={() => {
                  submitModeRef.current = 'print';
                }}
                disabled={!canSubmitSale}
                className="btn-secondary w-full"
              >
                <Printer className="h-4 w-4" />
                {savingSale ? 'Procesando...' : 'Guardar e imprimir'}
              </button>
              <button
                type="button"
                onClick={resetSale}
                className="btn-secondary w-full"
              >
                <RotateCcw className="h-4 w-4" />
                Limpiar operación
              </button>
            </div>
          </article>

          <article className="card space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-primary-900">Sesión</h2>
              <CircleDollarSign className="h-5 w-5 text-primary-700" />
            </div>

            {currentSession ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="metric-tile">
                    <p className="metric-label">Apertura</p>
                    <p className="metric-value">{formatCurrency(currentSession.opening_amount)}</p>
                  </div>
                  <div className="metric-tile">
                    <p className="metric-label">Efectivo esperado</p>
                    <p className="metric-value">{formatCurrency(expectedCashAmount)}</p>
                  </div>
                  <div className="metric-tile">
                    <p className="metric-label">Efectivo cobrado</p>
                    <p className="metric-value">{formatCurrency(sessionSummary.cash_sales)}</p>
                  </div>
                  <div className="metric-tile">
                    <p className="metric-label">Digital</p>
                    <p className="metric-value">{formatCurrency(sessionSummary.digital_sales)}</p>
                  </div>
                </div>
                <p className="text-xs text-primary-700">
                  Abierta: {formatDateTime(currentSession.opened_at)} · {currentSession.campus_name || 'Sede'}
                </p>
                {canManageCash ? (
                  <form onSubmit={closeCashSession} className="space-y-2 border-t border-primary-100 pt-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="app-input"
                      placeholder={`Conteo efectivo ${expectedCashAmount.toFixed(2)}`}
                      value={closingAmount}
                      onChange={(event) => setClosingAmount(normalizeMoneyInput(event.target.value))}
                      required
                    />
                    <input
                      className="app-input"
                      maxLength={400}
                      placeholder="Nota de cierre"
                      value={closingNotes}
                      onChange={(event) => setClosingNotes(event.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={savingSession}
                      className="btn-primary w-full"
                    >
                      <Lock className="h-4 w-4" />
                      {savingSession ? 'Cerrando...' : 'Cerrar caja'}
                    </button>
                  </form>
                ) : null}
              </>
            ) : canManageCash ? (
              <form onSubmit={openCashSession} className="space-y-2">
                {canViewCampuses && campuses.length ? (
                  <p className="text-xs text-primary-700">
                    Se abrirá en la sede activa del selector superior.
                  </p>
                ) : null}
                <input
                  type="text"
                  inputMode="decimal"
                  className="app-input"
                  placeholder="Monto inicial"
                  value={openingAmount}
                  onChange={(event) => setOpeningAmount(normalizeMoneyInput(event.target.value))}
                  required
                />
                <input
                  className="app-input"
                  maxLength={400}
                  placeholder="Nota de apertura"
                  value={openingNotes}
                  onChange={(event) => setOpeningNotes(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={savingSession}
                  className="btn-success w-full"
                >
                  <Unlock className="h-4 w-4" />
                  {savingSession ? 'Abriendo...' : 'Abrir caja'}
                </button>
              </form>
            ) : (
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900">No tienes permiso para abrir caja.</p>
                <p className="mt-1 text-xs text-amber-800">
                  Necesitas el permiso cash_register.manage. Si tu sesión estaba abierta antes del cambio,
                  refresca permisos.
                </p>
                <button
                  type="button"
                  onClick={refreshCashPermissions}
                  disabled={refreshingPermissions}
                  className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
                >
                  {refreshingPermissions ? 'Refrescando...' : 'Refrescar permisos'}
                </button>
              </div>
            )}
          </article>

          <article className="card space-y-3">
            <h2 className="text-lg font-semibold text-primary-900">Últimas sesiones</h2>
            <div className="space-y-2">
              {sessions.slice(0, 4).map((session) => (
                <div key={session.id} className="rounded-xl border border-primary-100 bg-white p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-primary-900">Caja #{session.id}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        session.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-primary-100 text-primary-700'
                      }`}
                    >
                      {session.status === 'OPEN' ? 'Abierta' : 'Cerrada'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-primary-600">{formatDateTime(session.opened_at)}</p>
                  <p className="mt-2 text-xs text-primary-700">
                    Total: {formatCurrency(session.summary?.total_completed)} · Efectivo:{' '}
                    {formatCurrency(session.summary?.cash_sales)}
                  </p>
                  {session.status === 'CLOSED' ? (
                    <p className="text-xs text-primary-700">
                      Dif.: {formatCurrency(session.difference_amount || 0)}
                    </p>
                  ) : null}
                </div>
              ))}
              {!sessions.length ? <p className="text-sm text-primary-600">Sin sesiones registradas.</p> : null}
            </div>
          </article>
        </aside>
      </div>
      )}

      {showServiceEditor ? (
        <article className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-primary-900">Catálogo de servicios</h2>
            <button
              type="button"
              onClick={() => {
                setEditingServiceId(null);
                setServiceForm(serviceDefaults);
              }}
              className="btn-secondary"
            >
              <Plus className="h-4 w-4" />
              Nuevo
            </button>
          </div>

          <form onSubmit={saveService} className="grid gap-3 lg:grid-cols-6">
            <input
              className="app-input lg:col-span-2"
              placeholder="Nombre del servicio"
              value={serviceForm.name}
              onChange={(event) => setServiceForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
            <input
              className="app-input lg:col-span-2"
              placeholder="Descripción"
              value={serviceForm.description}
              onChange={(event) => setServiceForm((prev) => ({ ...prev, description: event.target.value }))}
            />
            <input
              type="text"
              inputMode="decimal"
              className="app-input"
              placeholder="Precio"
              value={serviceForm.default_price}
              onChange={(event) =>
                setServiceForm((prev) => ({ ...prev, default_price: normalizeMoneyInput(event.target.value) }))
              }
              required
            />
            <input
              type="number"
              step="1"
              className="app-input"
              placeholder="Orden"
              value={serviceForm.sort_order}
              onChange={(event) => setServiceForm((prev) => ({ ...prev, sort_order: event.target.value }))}
            />
            <label className="app-input flex items-center gap-2 lg:col-span-2">
              <input
                type="checkbox"
                checked={serviceForm.is_active}
                onChange={(event) => setServiceForm((prev) => ({ ...prev, is_active: event.target.checked }))}
              />
              Activo
            </label>
            <button
              type="submit"
              disabled={savingService}
              className="btn-primary"
            >
              <Save className="h-4 w-4" />
              {savingService ? 'Guardando...' : editingServiceId ? 'Actualizar' : 'Crear'}
            </button>
          </form>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {services.map((service) => (
              <div key={service.id} className="rounded-xl border border-primary-100 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold uppercase text-primary-900" title={service.name}>
                      {service.name}
                    </p>
                    <p className="mt-1 text-xs text-primary-600">{service.description || 'Sin descripción'}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-emerald-700">
                    {formatCurrency(service.default_price)}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      service.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {service.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                  <button
                    type="button"
                    onClick={() => editService(service)}
                    className="btn-secondary min-h-0 px-3 py-1.5 text-xs"
                  >
                    Editar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      <article className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-primary-900">Movimientos de caja</h2>
          <button
            type="button"
            onClick={clearFilters}
            className="btn-secondary"
          >
            Limpiar filtros
          </button>
        </div>

        <div className="mb-4 grid gap-2 lg:grid-cols-4">
          <select
            className="app-input"
            value={methodFilter}
            onChange={(event) => {
              setMethodFilter(event.target.value);
              setVisibleCount(CASH_INITIAL_LIMIT);
            }}
          >
            <option value="ALL">Todos los métodos</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="app-input"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setVisibleCount(CASH_INITIAL_LIMIT);
            }}
          >
            <option value="ALL">Todos los estados</option>
            <option value="COMPLETED">Completados</option>
            <option value="VOIDED">Anulados</option>
          </select>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase text-primary-700">Desde</span>
            <input
              type="date"
              className="app-input"
              value={dateFromFilter}
              onChange={(event) => {
                setDateFromFilter(event.target.value);
                setVisibleCount(CASH_INITIAL_LIMIT);
              }}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase text-primary-700">Hasta</span>
            <input
              type="date"
              className="app-input"
              value={dateToFilter}
              onChange={(event) => {
                setDateToFilter(event.target.value);
                setVisibleCount(CASH_INITIAL_LIMIT);
              }}
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {transactions.map((transaction) => (
            <div
              key={transaction.id}
              className="flex flex-col rounded-xl border border-primary-100 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold text-primary-900" title={transaction.customer_name}>
                    {transaction.customer_name}
                  </h3>
                  <p className="mt-0.5 text-xs text-primary-600">
                    #{transaction.id} · {formatDateTime(transaction.created_at)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    transaction.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                  }`}
                >
                  {transaction.status === 'COMPLETED' ? 'Completado' : 'Anulado'}
                </span>
              </div>

              <div className="mt-3 flex-1 rounded-xl border border-primary-50 bg-primary-50/50 p-3 text-xs">
                <p className="line-clamp-2 font-medium text-primary-900">{transaction.item_summary || 'Servicio'}</p>
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-primary-600">Método</span>
                    <span className="font-semibold text-primary-900">
                      {PAYMENT_METHOD_LABELS[transaction.method] || transaction.method}
                    </span>
                  </div>
                  {transaction.payment_summary ? (
                    <p className="rounded-md bg-white px-2 py-1 text-[11px] font-medium text-primary-700">
                      {transaction.payment_summary}
                    </p>
                  ) : null}
                  <div className="flex justify-between gap-2">
                    <span className="text-primary-600">Total</span>
                    <span className="font-bold text-emerald-700">{formatCurrency(transaction.total_amount)}</span>
                  </div>
                  {transaction.method === 'EFECTIVO' || transaction.method === 'MIXTO' ? (
                    <>
                      <div className="flex justify-between gap-2">
                        <span className="text-primary-600">Efectivo recibido</span>
                        <span className="font-semibold text-primary-900">
                          {formatCurrency(transaction.cash_payment_amount)}
                        </span>
                      </div>
                      {transaction.method === 'MIXTO' ? (
                        <div className="flex justify-between gap-2">
                          <span className="text-primary-600">Efectivo caja</span>
                          <span className="font-semibold text-primary-900">
                            {formatCurrency(transaction.cash_net_amount)}
                          </span>
                        </div>
                      ) : null}
                      {toMoneyNumber(transaction.change_amount) > 0 ? (
                        <div className="flex justify-between gap-2">
                          <span className="text-primary-600">Vuelto</span>
                          <span className="font-bold text-emerald-700">
                            {formatCurrency(transaction.change_amount)}
                          </span>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex justify-between gap-2">
                    <span className="text-primary-600">Comprobante</span>
                    <span className="font-semibold text-primary-900">
                      {RECEIPT_DOCUMENT_TYPE_LABELS[transaction.receipt_document_type] || 'Comprobante'}
                    </span>
                  </div>
                  {isSunatDocumentType(transaction.receipt_document_type) ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-primary-600">SUNAT</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${getSunatStatusClassName(
                            transaction.sunat_status,
                          )}`}
                        >
                          {SUNAT_STATUS_LABELS[String(transaction.sunat_status || 'PENDIENTE').toUpperCase()] ||
                            transaction.sunat_status ||
                            'Pendiente'}
                        </span>
                      </div>
                      {transaction.sunat_document_number ? (
                        <div className="flex justify-between gap-2">
                          <span className="text-primary-600">Nro. SUNAT</span>
                          <span className="truncate font-semibold text-primary-900">
                            {transaction.sunat_document_number}
                          </span>
                        </div>
                      ) : null}
                      {transaction.sunat_message &&
                      ['ERROR', 'RECHAZADO'].includes(String(transaction.sunat_status || '').toUpperCase()) ? (
                        <p className="rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700">
                          {transaction.sunat_message}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex justify-between gap-2">
                    <span className="text-primary-600">Operación</span>
                    <span className="truncate font-semibold text-primary-900">{transaction.reference_code || '-'}</span>
                  </div>
                </div>
              </div>

              {transaction.notes ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                  {transaction.notes}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2 border-t border-primary-100 pt-3">
                <button
                  type="button"
                  onClick={() => openCashReceipt(transaction.id, { campusId: transaction.campus_id })}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-50 px-3 py-2 text-xs font-bold text-primary-800 transition hover:bg-primary-100"
                >
                  <ReceiptText className="h-4 w-4" />
                  Boleta
                </button>
                {canManageCash &&
                transaction.status === 'COMPLETED' &&
                isSunatDocumentType(transaction.receipt_document_type) ? (
                  <button
                    type="button"
                    onClick={() => sendTransactionToSunat(transaction)}
                    disabled={
                      !sunatConfig?.configured ||
                      sendingSunatId === transaction.id ||
                      String(transaction.sunat_status || '').toUpperCase() === 'ACEPTADO'
                    }
                    title={
                      sunatConfig?.configured
                        ? 'Enviar comprobante a SUNAT'
                        : 'Completa la configuración SUNAT en el backend'
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-100 px-3 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Send className="h-4 w-4" />
                    {sendingSunatId === transaction.id
                      ? 'Enviando...'
                      : String(transaction.sunat_status || '').toUpperCase() === 'ACEPTADO'
                        ? 'SUNAT OK'
                        : 'SUNAT'}
                  </button>
                ) : null}
                {canManageCash && currentSession && transaction.status === 'COMPLETED' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setVoidingTransactionId(transaction.id);
                      setVoidNotes('');
                    }}
                    className="inline-flex items-center justify-center rounded-lg border border-red-100 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                    aria-label="Anular operación"
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {!loading && !transactions.length ? (
          <div className="mt-4 rounded-xl border border-primary-50 bg-primary-50/30 py-10 text-center text-sm text-primary-600">
            No hay movimientos con los filtros seleccionados.
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {hasMoreTransactions ? (
            <button
              type="button"
              onClick={() => setVisibleCount((current) => current + CASH_LOAD_STEP)}
              disabled={loading}
              className="btn-secondary"
            >
              {loading ? 'Cargando...' : `Ver ${CASH_LOAD_STEP} movimientos más`}
            </button>
          ) : null}
          {visibleCount > CASH_INITIAL_LIMIT ? (
            <button
              type="button"
              onClick={() => setVisibleCount(CASH_INITIAL_LIMIT)}
              disabled={loading}
              className="btn-secondary"
            >
              Ver solo los últimos {CASH_INITIAL_LIMIT}
            </button>
          ) : null}
        </div>
      </article>

      {voidingTransactionId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <Ban className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-red-700">Anular operación</h2>
                <p className="text-sm text-primary-700">La anulación quedará en auditoría y solo aplica con caja abierta.</p>
              </div>
            </div>
            <textarea
              className="app-input min-h-[100px] w-full resize-none"
              placeholder="Motivo de anulación"
              value={voidNotes}
              onChange={(event) => setVoidNotes(event.target.value)}
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidingTransactionId(null)}
                disabled={savingVoid}
                className="btn-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmVoidTransaction}
                disabled={savingVoid || voidNotes.trim().length < 3}
                className="btn-danger"
              >
                {savingVoid ? 'Anulando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
