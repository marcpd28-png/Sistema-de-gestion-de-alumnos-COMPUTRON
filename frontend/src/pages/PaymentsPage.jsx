import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../constants/permissions';
import { downloadCsv } from '../utils/csv';
import { fetchAllPages } from '../utils/paginatedFetch';
import { openSecureFile } from '../utils/secureFiles';
import StudentPaymentsPage from './StudentPaymentsPage';

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
};

const RECEIPT_DOCUMENT_TYPE_LABELS = {
  BOLETA: 'Boleta',
  FACTURA: 'Factura',
  RECIBO_INTERNO: 'Recibo interno',
};

const ALL_PENDING_INSTALLMENTS = 'ALL';
const PAYMENT_INITIAL_LIMIT = 10;
const PAYMENT_LOAD_STEP = 10;

const paymentDefaults = {
  student_id: '',
  selected_installment_id: ALL_PENDING_INSTALLMENTS,
  amount_received: '',
  method: 'YAPE',
  reference_code: '',
  notes: '',
  no_evidence: false,
  receipt_document_type: 'BOLETA',
  billing_name: '',
  billing_document: '',
  billing_address: '',
};

const toPaymentStatusLabel = (status) => {
  const key = String(status || '').toUpperCase();
  return PAYMENT_STATUS_LABELS[key] || status || '-';
};

const toPaymentMethodLabel = (method) => {
  const key = String(method || '').toUpperCase();
  return PAYMENT_METHOD_LABELS[key] || method || '-';
};

const toReceiptDocumentTypeLabel = (documentType) => {
  const key = String(documentType || '').toUpperCase();
  return RECEIPT_DOCUMENT_TYPE_LABELS[key] || documentType || 'Comprobante';
};

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const yieldToBrowser = () =>
  new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    window.requestAnimationFrame(() => resolve());
  });

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

const uploadPaymentEvidence = async (file) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post('/payments/evidence', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return {
    evidenceUrl: response.data?.item?.evidence_url || null,
    evidenceName: response.data?.item?.evidence_name || file?.name || 'evidencia',
  };
};

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function StaffPaymentsPage() {
  const { hasPermission } = useAuth();

  const [payments, setPayments] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [pendingSummary, setPendingSummary] = useState({ student: null, summary: null, items: [] });

  const [form, setForm] = useState(paymentDefaults);
  const [evidenceFile, setEvidenceFile] = useState(null);

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [studentFilter, setStudentFilter] = useState('');
  const [campusFilter, setCampusFilter] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');

  const [paymentVisibleCount, setPaymentVisibleCount] = useState(PAYMENT_INITIAL_LIMIT);
  const [hasMorePayments, setHasMorePayments] = useState(false);

  const [loadingPayments, setLoadingPayments] = useState(false);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [loadingCampuses, setLoadingCampuses] = useState(false);
  const [loadingPendingSummary, setLoadingPendingSummary] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [exportingPayments, setExportingPayments] = useState(false);
  const [openingEvidenceId, setOpeningEvidenceId] = useState(null);

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [receiptFormat, setReceiptFormat] = useState('F2');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [rejectingPaymentId, setRejectingPaymentId] = useState(null);
  const [rejectionNotes, setRejectionNotes] = useState('');
  const [savingRejection, setSavingRejection] = useState(false);
  const submitModeRef = useRef('save');

  const canViewPayments = hasPermission(PERMISSIONS.PAYMENTS_VIEW);
  const canManagePayments = hasPermission(PERMISSIONS.PAYMENTS_MANAGE);
  const canViewEnrollments = hasPermission(PERMISSIONS.ENROLLMENTS_VIEW);
  const canViewCampuses = hasPermission(PERMISSIONS.CAMPUSES_VIEW);
  const canAccessPaymentsData = canViewPayments || canManagePayments;

  const paymentFilterParams = useMemo(
    () => ({
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      student_id: studentFilter ? Number(studentFilter) : undefined,
      campus_id: campusFilter ? Number(campusFilter) : undefined,
      date_from: dateFromFilter || undefined,
      date_to: dateToFilter || undefined,
    }),
    [campusFilter, dateFromFilter, dateToFilter, statusFilter, studentFilter],
  );

  const studentOptions = useMemo(() => {
    const map = new Map();
    for (const enrollment of enrollments) {
      if (!enrollment.student_id) continue;
      const key = String(enrollment.student_id);
      if (!map.has(key)) {
        map.set(key, {
          id: enrollment.student_id,
          label: enrollment.student_name || `Alumno #${enrollment.student_id}`,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [enrollments]);

  const selectedPendingItems = useMemo(() => {
    const items = pendingSummary.items || [];
    if (!form.selected_installment_id || form.selected_installment_id === ALL_PENDING_INSTALLMENTS) {
      return items;
    }
    return items.filter((item) => String(item.installment_id) === String(form.selected_installment_id));
  }, [form.selected_installment_id, pendingSummary.items]);

  const pendingInstallmentOptions = useMemo(() => {
    return (pendingSummary.items || []).map((item) => {
      const dueDate = item.due_date ? ` | Vence: ${item.due_date}` : '';
      const concept = item.concept_name ? ` (${item.concept_name})` : '';
      return {
        id: String(item.installment_id),
        label: `Cuota #${item.installment_id}${concept} - S/ ${round2(item.pending_amount).toFixed(2)}${dueDate}`,
        amount: round2(item.pending_amount),
      };
    });
  }, [pendingSummary.items]);

  const pendingTotals = useMemo(() => {
    const totalPending = round2(
      selectedPendingItems.reduce((sum, item) => sum + Number(item.pending_amount || 0), 0),
    );
    const amountReceived = round2(form.amount_received || 0);
    const amountApplied = round2(Math.min(amountReceived, totalPending));
    const remainingDebt = round2(Math.max(totalPending - amountReceived, 0));
    const overpayment = round2(Math.max(amountReceived - totalPending, 0));

    return {
      amountReceived,
      totalPending,
      amountApplied,
      remainingDebt,
      overpayment,
    };
  }, [form.amount_received, selectedPendingItems]);

  const allocationDetails = useMemo(() => {
    const details = [];
    let remainingToApply = pendingTotals.amountApplied;

    for (const item of selectedPendingItems) {
      if (remainingToApply <= 0) break;
      const pendingAmount = round2(item.pending_amount || 0);
      if (pendingAmount <= 0) continue;
      const amount = round2(Math.min(pendingAmount, remainingToApply));
      if (amount <= 0) continue;

      details.push({
        enrollment_id: Number(item.enrollment_id),
        installment_id: Number(item.installment_id),
        amount,
      });
      remainingToApply = round2(remainingToApply - amount);
    }

    return details;
  }, [pendingTotals.amountApplied, selectedPendingItems]);

  const allocationByEnrollment = useMemo(() => {
    const grouped = new Map();

    for (const detail of allocationDetails) {
      const key = String(detail.enrollment_id);
      if (!grouped.has(key)) {
        grouped.set(key, {
          enrollment_id: detail.enrollment_id,
          details: [],
          applied_amount: 0,
        });
      }
      const current = grouped.get(key);
      current.details.push({
        installment_id: detail.installment_id,
        amount: detail.amount,
      });
      current.applied_amount = round2(current.applied_amount + detail.amount);
    }

    return Array.from(grouped.values()).sort((a, b) => a.enrollment_id - b.enrollment_id);
  }, [allocationDetails]);

  const allocationByInstallment = useMemo(() => {
    const allocation = new Map();
    for (const detail of allocationDetails) {
      allocation.set(String(detail.installment_id), detail.amount);
    }
    return allocation;
  }, [allocationDetails]);

  const loadPayments = useCallback(
    async ({ limit = paymentVisibleCount } = {}) => {
      if (!canViewPayments) {
        setPayments([]);
        setHasMorePayments(false);
        return;
      }

      setLoadingPayments(true);
      try {
        const response = await api.get('/payments', {
          params: {
            ...paymentFilterParams,
            page: 1,
            page_size: limit,
            include_total: false,
          },
        });

        const items = response.data?.items || [];
        const meta = response.data?.meta || {};

        setPayments(items);
        setHasMorePayments(Boolean(meta.has_more));
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'No se pudieron cargar los pagos.');
      } finally {
        setLoadingPayments(false);
      }
    },
    [canViewPayments, paymentFilterParams, paymentVisibleCount],
  );

  const loadEnrollments = useCallback(async () => {
    if (!canViewEnrollments) {
      setEnrollments([]);
      return;
    }

    setLoadingEnrollments(true);
    try {
      const response = await api.get('/enrollments');
      setEnrollments(response.data?.items || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudieron cargar las matrículas.');
    } finally {
      setLoadingEnrollments(false);
    }
  }, [canViewEnrollments]);

  const ensureEnrollmentsLoaded = useCallback(async () => {
    if (!canViewEnrollments || loadingEnrollments || enrollments.length > 0) return;
    await loadEnrollments();
  }, [canViewEnrollments, enrollments.length, loadEnrollments, loadingEnrollments]);

  const loadCampuses = useCallback(async () => {
    if (!canViewCampuses) {
      setCampuses([]);
      return;
    }

    setLoadingCampuses(true);
    try {
      const response = await api.get('/campuses', { _skipCampusScope: true });
      setCampuses(response.data?.items || []);
    } catch {
      setCampuses([]);
    } finally {
      setLoadingCampuses(false);
    }
  }, [canViewCampuses]);

  const loadPendingSummary = useCallback(
    async (studentId) => {
      if (!studentId || !canAccessPaymentsData) {
        setPendingSummary({ student: null, summary: null, items: [] });
        return;
      }

      setLoadingPendingSummary(true);
      try {
        const response = await api.get('/payments/pending-summary', {
          params: { student_id: Number(studentId) },
        });
        setPendingSummary({
          student: response.data?.student || null,
          summary: response.data?.summary || null,
          items: response.data?.items || [],
        });
      } catch (requestError) {
        setPendingSummary({ student: null, summary: null, items: [] });
        setError(requestError.response?.data?.message || 'No se pudo cargar el resumen de cuotas pendientes.');
      } finally {
        setLoadingPendingSummary(false);
      }
    },
    [canAccessPaymentsData],
  );

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    if (showPaymentForm) {
      ensureEnrollmentsLoaded();
    }
  }, [ensureEnrollmentsLoaded, showPaymentForm]);

  useEffect(() => {
    loadCampuses();
  }, [loadCampuses]);

  useEffect(() => {
    loadPendingSummary(form.student_id);
  }, [form.student_id, loadPendingSummary]);

  useEffect(() => {
    if (!pendingSummary.items.length) {
      if (form.selected_installment_id !== ALL_PENDING_INSTALLMENTS) {
        setForm((prev) => ({ ...prev, selected_installment_id: ALL_PENDING_INSTALLMENTS }));
      }
      return;
    }

    if (form.selected_installment_id === ALL_PENDING_INSTALLMENTS) return;

    const exists = pendingSummary.items.some(
      (item) => String(item.installment_id) === String(form.selected_installment_id),
    );
    if (!exists) {
      setForm((prev) => ({
        ...prev,
        selected_installment_id: ALL_PENDING_INSTALLMENTS,
        amount_received: '',
      }));
    }
  }, [form.selected_installment_id, pendingSummary.items]);

  useEffect(() => {
    if (form.method === 'EFECTIVO') {
      setForm((prev) => ({ ...prev, no_evidence: false }));
      setEvidenceFile(null);
    }
  }, [form.method]);

  const clearPaymentFilters = () => {
    setStatusFilter('ALL');
    setStudentFilter('');
    setCampusFilter('');
    setDateFromFilter('');
    setDateToFilter('');
    setPaymentVisibleCount(PAYMENT_INITIAL_LIMIT);
  };

  const resetPaymentForm = () => {
    setForm(paymentDefaults);
    setEvidenceFile(null);
    setPendingSummary({ student: null, summary: null, items: [] });
  };

  const handleInstallmentSelection = (value) => {
    if (value === ALL_PENDING_INSTALLMENTS) {
      const totalPending = round2(
        (pendingSummary.items || []).reduce((sum, item) => sum + Number(item.pending_amount || 0), 0),
      );
      setForm((prev) => ({
        ...prev,
        selected_installment_id: ALL_PENDING_INSTALLMENTS,
        amount_received: totalPending > 0 ? totalPending.toFixed(2) : '',
      }));
      return;
    }

    const selected = (pendingSummary.items || []).find((item) => String(item.installment_id) === String(value));
    setForm((prev) => ({
      ...prev,
      selected_installment_id: value,
      amount_received: selected ? round2(selected.pending_amount).toFixed(2) : prev.amount_received,
    }));
  };

  const exportPaymentsCsv = async () => {
    if (!canViewPayments) return;

    setExportingPayments(true);
    setMessage('');
    setError('');

    try {
      await yieldToBrowser();

      const allPayments = await fetchAllPages({
        path: '/payments',
        params: paymentFilterParams,
      });

      const rows = allPayments.map((item) => ({
        id: item.id,
        fecha_hora: formatDateTime(item.payment_date),
        usuario_registro: item.processed_by_name || '-',
        alumno: item.student_name || '',
        enrollment_id: item.enrollment_id || '',
        monto_aplicado: round2(item.total_amount).toFixed(2),
        monto_recibido: round2(item.amount_received).toFixed(2),
        saldo_favor: round2(item.overpayment_amount).toFixed(2),
        metodo: toPaymentMethodLabel(item.method),
        tipo_comprobante: toReceiptDocumentTypeLabel(item.receipt_document_type),
        estado: toPaymentStatusLabel(item.status),
        numero_operacion: item.reference_code || '',
        evidencia: item.no_evidence ? 'Sin evidencia (marcado)' : item.evidence_name || '',
      }));

      await downloadCsv({
        filename: `reporte_pagos_${new Date().toISOString().slice(0, 10)}.csv`,
        headers: [
          { key: 'id', label: 'ID' },
          { key: 'fecha_hora', label: 'Fecha/Hora' },
          { key: 'usuario_registro', label: 'Usuario registro' },
          { key: 'alumno', label: 'Alumno' },
          { key: 'enrollment_id', label: 'Matrícula ID' },
          { key: 'monto_aplicado', label: 'Monto aplicado' },
          { key: 'monto_recibido', label: 'Monto recibido' },
          { key: 'saldo_favor', label: 'Saldo a favor' },
          { key: 'metodo', label: 'Método' },
          { key: 'tipo_comprobante', label: 'Tipo de comprobante' },
          { key: 'estado', label: 'Estado' },
          { key: 'numero_operacion', label: 'Número de operación' },
          { key: 'evidencia', label: 'Evidencia' },
        ],
        rows,
      });

      setMessage(`Reporte generado: ${rows.length} pagos exportados.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo exportar el reporte de pagos en Excel.');
    } finally {
      setExportingPayments(false);
    }
  };

  const openPaymentReceipt = useCallback(
    async (paymentId, { silent = false, format = receiptFormat, autoPrint = false } = {}) => {
      if (!paymentId) return;

      const receiptWindow = openReceiptWindow('Comprobante de pago');
      if (!receiptWindow) {
        if (!silent) {
          setError('El navegador bloqueó la apertura del comprobante. Habilita ventanas emergentes e intenta de nuevo.');
        }
        return;
      }

      try {
        const response = await api.get(`/payments/${paymentId}/receipt`, {
          params: { format },
        });
        renderReceiptWindow(receiptWindow, response.data || '');

        if (autoPrint) {
          receiptWindow.focus();
          window.setTimeout(() => {
            if (!receiptWindow.closed) {
              receiptWindow.print();
            }
          }, 250);
        }
      } catch (requestError) {
        if (!receiptWindow.closed) {
          receiptWindow.close();
        }
        if (!silent) {
          setError(getApiErrorMessage(requestError, 'No se pudo emitir el comprobante del pago.'));
        }
      }
    },
    [receiptFormat],
  );

  const openPaymentEvidence = useCallback(
    async (payment) => {
      if (!payment?.id || payment.no_evidence || !(payment.has_evidence || payment.evidence_url)) return;

      setOpeningEvidenceId(payment.id);
      setError('');
      try {
        await openSecureFile({
          url: `/payments/${payment.id}/evidence`,
          params: campusFilter ? { campus_id: campusFilter } : {},
          filename: payment.evidence_name || `evidencia_pago_${payment.id}`,
        });
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, 'No se pudo abrir la evidencia.'));
      } finally {
        setOpeningEvidenceId(null);
      }
    },
    [campusFilter],
  );

  const previewPaymentReceipt = async ({ autoPrint = false } = {}) => {
    if (!form.student_id) {
      setError('Selecciona un alumno para la vista previa del comprobante.');
      return;
    }

    if (form.receipt_document_type === 'FACTURA') {
      if (!/^\d{11}$/.test(form.billing_document.trim())) {
        setError('El RUC debe tener exactamente 11 dígitos.');
        return;
      }
      if (form.billing_name.trim().length < 2) {
        setError('Ingresa la razón social para la factura.');
        return;
      }
      if (form.billing_address.trim().length < 3) {
        setError('Ingresa la dirección fiscal para la factura.');
        return;
      }
    }

    const pendingByInstallment = new Map(
      (selectedPendingItems || []).map((item) => [Number(item.installment_id), item]),
    );

    const previewDetails = allocationDetails
      .map((detail) => {
        const pendingItem = pendingByInstallment.get(Number(detail.installment_id));
        const description = pendingItem?.concept_name
          ? `${pendingItem.concept_name} (Cuota ${detail.installment_id})`
          : `Cuota ${detail.installment_id}`;
        return {
          description,
          amount: round2(detail.amount),
          quantity: 1,
        };
      })
      .filter((item) => Number(item.amount) > 0);

    const previewAmount = round2(pendingTotals.amountReceived || 0);
    if (previewDetails.length === 0 || previewAmount <= 0) {
      setError('Ingresa un monto válido para generar la vista previa del comprobante.');
      return;
    }

    const firstEnrollmentId =
      allocationByEnrollment[0]?.enrollment_id || selectedPendingItems[0]?.enrollment_id || null;

    const previewWindow = openReceiptWindow(
      `Vista previa: ${toReceiptDocumentTypeLabel(form.receipt_document_type)}`,
    );
    if (!previewWindow) {
      setError('El navegador bloqueó la vista previa. Habilita ventanas emergentes e intenta de nuevo.');
      return;
    }

    try {
      setError('');
      const response = await api.post(
        '/payments/receipt-preview',
        {
          format: receiptFormat,
          receipt_document_type: form.receipt_document_type,
          billing_name: form.billing_name.trim() || null,
          billing_document: form.billing_document.trim() || null,
          billing_address: form.billing_address.trim() || null,
          student_id: Number(form.student_id),
          enrollment_id: firstEnrollmentId ? Number(firstEnrollmentId) : undefined,
          amount_received: previewAmount,
          details: previewDetails,
        },
      );
      renderReceiptWindow(previewWindow, response.data || '');

      if (autoPrint) {
        previewWindow.focus();
        window.setTimeout(() => {
          if (!previewWindow.closed) {
            previewWindow.print();
          }
        }, 250);
      }
    } catch (requestError) {
      if (!previewWindow.closed) {
        previewWindow.close();
      }
      if (requestError.response?.status === 404) {
        setError('La vista previa del comprobante no está disponible en el backend actual. Reinicia el backend.');
        return;
      }

      setError(getApiErrorMessage(requestError, 'No se pudo generar la vista previa del comprobante.'));
    }
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    if (!canManagePayments) return;
    const shouldPrintReceipt = submitModeRef.current === 'print';

    setSavingPayment(true);
    setMessage('');
    setError('');

    try {
      await yieldToBrowser();

      if (!form.student_id) {
        throw new Error('Selecciona un alumno.');
      }

      if (!selectedPendingItems.length) {
        throw new Error('El alumno no tiene cuotas pendientes.');
      }

      if (pendingTotals.amountReceived <= 0) {
        throw new Error('Ingresa un monto válido para el pago.');
      }

      if (form.method !== 'EFECTIVO' && !form.reference_code.trim()) {
        throw new Error('Ingresa el número de operación.');
      }

      if (form.receipt_document_type === 'FACTURA') {
        if (!/^\d{11}$/.test(form.billing_document.trim())) {
          throw new Error('El RUC debe tener exactamente 11 dígitos.');
        }
        if (form.billing_name.trim().length < 2) {
          throw new Error('Ingresa la razón social para la factura.');
        }
        if (form.billing_address.trim().length < 3) {
          throw new Error('Ingresa la dirección fiscal para la factura.');
        }
      }

      if (allocationByEnrollment.length === 0) {
        throw new Error('El monto ingresado no se puede aplicar a cuotas pendientes.');
      }

      const needsEvidence = form.method !== 'EFECTIVO';
      if (needsEvidence && !form.no_evidence && !evidenceFile) {
        throw new Error('Adjunta una evidencia o marca "No se tiene evidencias".');
      }

      let evidenceUrl = null;
      let evidenceName = null;
      if (needsEvidence && !form.no_evidence && evidenceFile) {
        const uploadedEvidence = await uploadPaymentEvidence(evidenceFile);
        evidenceUrl = uploadedEvidence.evidenceUrl;
        evidenceName = uploadedEvidence.evidenceName;

        if (!evidenceUrl) {
          throw new Error('No se pudo obtener una URL válida para la evidencia subida.');
        }
      }

      let createdPayments = 0;
      let firstCreatedPaymentId = null;
      for (let index = 0; index < allocationByEnrollment.length; index += 1) {
        const group = allocationByEnrollment[index];
        const groupReceived = round2(group.applied_amount + (index === 0 ? pendingTotals.overpayment : 0));

        const extraNotes = [];
        if (pendingTotals.remainingDebt > 0 && index === 0) {
          extraNotes.push(`Saldo pendiente tras pago: S/ ${pendingTotals.remainingDebt.toFixed(2)}`);
        }
        if (pendingTotals.overpayment > 0 && index === 0) {
          extraNotes.push(`Saldo a favor generado: S/ ${pendingTotals.overpayment.toFixed(2)}`);
        }

        const mergedNotes = [form.notes.trim(), ...extraNotes].filter(Boolean).join(' | ') || null;

        const response = await api.post('/payments', {
          student_id: Number(form.student_id),
          enrollment_id: Number(group.enrollment_id),
          method: form.method,
          status: 'COMPLETED',
          reference_code: form.reference_code.trim() || null,
          notes: mergedNotes,
          amount_received: groupReceived,
          receipt_document_type: form.receipt_document_type,
          billing_name: form.billing_name.trim() || null,
          billing_document: form.billing_document.trim() || null,
          billing_address: form.billing_address.trim() || null,
          evidence_name: evidenceName,
          evidence_url: evidenceUrl,
          no_evidence: needsEvidence ? Boolean(form.no_evidence) : false,
          details: group.details,
        });

        if (!firstCreatedPaymentId && response.data?.item?.id) {
          firstCreatedPaymentId = Number(response.data.item.id);
        }

        createdPayments += 1;
      }

      const resultParts = [`Pago registrado (${createdPayments} registro(s)).`];
      if (pendingTotals.remainingDebt > 0) {
        resultParts.push(`Saldo pendiente: S/ ${pendingTotals.remainingDebt.toFixed(2)}.`);
      }
      if (pendingTotals.overpayment > 0) {
        resultParts.push(`Saldo a favor: S/ ${pendingTotals.overpayment.toFixed(2)}.`);
      }

      setMessage(resultParts.join(' '));
      setShowPaymentForm(false);
      resetPaymentForm();
      setPaymentVisibleCount(PAYMENT_INITIAL_LIMIT);
      await loadPayments({ limit: PAYMENT_INITIAL_LIMIT });

      if (firstCreatedPaymentId) {
        await openPaymentReceipt(firstCreatedPaymentId, {
          silent: true,
          format: receiptFormat,
          autoPrint: shouldPrintReceipt,
        });
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'No se pudo registrar el pago.');
    } finally {
      submitModeRef.current = 'save';
      setSavingPayment(false);
    }
  };

  const updateStatus = useCallback(
    async (paymentId, status) => {
      if (!canManagePayments) return;
      if (status === 'REJECTED') {
        setRejectingPaymentId(paymentId);
        setRejectionNotes('');
        return;
      }

      setMessage('');
      setError('');

      try {
        await yieldToBrowser();
        await api.patch(`/payments/${paymentId}/status`, { status });
        setMessage('Estado de pago actualizado.');
        await loadPayments();
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'No se pudo actualizar el estado del pago.');
      }
    },
    [canManagePayments, loadPayments],
  );

  const confirmRejection = async () => {
    if (!rejectingPaymentId) return;

    if (!rejectionNotes.trim()) {
      setError('Debes ingresar el motivo del rechazo.');
      return;
    }

    setSavingRejection(true);
    setMessage('');
    setError('');

    try {
      await yieldToBrowser();
      await api.patch(`/payments/${rejectingPaymentId}/status`, {
        status: 'REJECTED',
        notes: rejectionNotes.trim(),
      });
      setMessage('Pago rechazado correctamente.');
      setRejectingPaymentId(null);
      setRejectionNotes('');
      await loadPayments();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo rechazar el pago.');
    } finally {
      setSavingRejection(false);
    }
  };

  const paymentTableRows = useMemo(
    () =>
      payments.map((payment) => (
        <div key={payment.id} className="flex flex-col rounded-2xl border border-primary-100 bg-white p-4 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md hover:border-primary-300">
          <div className="flex justify-between items-start mb-3 gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-primary-900 text-[15px] leading-tight truncate" title={payment.student_name}>
                {payment.student_name}
              </h3>
              <p className="text-xs text-primary-600 mt-0.5 truncate border-b border-primary-50 pb-2">
                ID: #{payment.id} • {formatDateTime(payment.payment_date)}
              </p>
            </div>
          </div>

          <div className="bg-primary-50/50 rounded-xl p-3 border border-primary-50 mb-4 space-y-2 mt-auto">
            <div className="flex justify-between items-center text-xs gap-2">
              <span className="text-gray-500 font-medium whitespace-nowrap">Estado</span>
              <span className="font-bold text-primary-800 text-right">{toPaymentStatusLabel(payment.status)}</span>
            </div>
            <div className="flex justify-between items-center text-xs gap-2">
              <span className="text-gray-500 font-medium whitespace-nowrap">Método</span>
              <span className="text-gray-900 font-semibold truncate text-right">{toPaymentMethodLabel(payment.method)}</span>
            </div>
            <div className="flex justify-between items-center text-xs gap-2">
              <span className="text-gray-500 font-medium whitespace-nowrap">Comprobante</span>
              <span className="text-gray-900 font-semibold truncate text-right">
                {toReceiptDocumentTypeLabel(payment.receipt_document_type)}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs gap-2">
              <span className="text-gray-500 font-medium whitespace-nowrap">Recibido</span>
              <span className="text-emerald-700 font-bold text-right">S/ {round2(payment.amount_received).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-xs gap-2">
              <span className="text-gray-500 font-medium whitespace-nowrap">N° Operación</span>
              <span className="text-gray-900 font-semibold truncate flex-1 min-w-0 text-right">{payment.reference_code || '-'}</span>
            </div>
            <div className="flex justify-between items-center text-[11px] gap-2 pt-1 border-t border-primary-100/60 mt-2">
              <span className="text-gray-500 font-medium whitespace-nowrap">Evidencia</span>
              <div className="flex-1 min-w-0 text-right">
                {payment.no_evidence ? (
                  <span className="font-semibold text-amber-700">Sin evidencia</span>
                ) : payment.has_evidence || payment.evidence_url ? (
                  <button
                    type="button"
                    onClick={() => openPaymentEvidence(payment)}
                    disabled={openingEvidenceId === payment.id}
                    className="block w-full truncate text-right font-semibold text-primary-700 underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {openingEvidenceId === payment.id ? 'Abriendo...' : payment.evidence_name || 'Ver evidencia'}
                  </button>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </div>
            </div>
            {payment.notes && payment.status === 'REJECTED' ? (
              <div className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-800 border border-red-100/50">
                <span className="font-bold">Motivo de rechazo:</span> {payment.notes}
              </div>
            ) : null}
            {payment.notes && payment.status !== 'REJECTED' ? (
              <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 border border-amber-100/50">
                <span className="font-bold">Nota:</span> {payment.notes}
              </div>
            ) : null}
          </div>

          <div className="mt-auto pt-2 border-t border-primary-100 flex flex-wrap gap-2">
            <button
              type="button"
              className="flex-1 rounded-lg bg-primary-50 py-1.5 text-[11px] font-bold text-primary-700 hover:bg-primary-100 transition-colors disabled:opacity-50"
              onClick={() => openPaymentReceipt(payment.id)}
            >
              {toReceiptDocumentTypeLabel(payment.receipt_document_type).toUpperCase()}
            </button>
            {canManagePayments ? (
              <button
                type="button"
                className="flex-[0.5] rounded-lg bg-emerald-50 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                onClick={() => updateStatus(payment.id, 'COMPLETED')}
                title="Marcar completado"
              >
                ✓
              </button>
            ) : null}
            {canManagePayments ? (
              <button
                type="button"
                className="flex-[0.5] rounded-lg bg-red-50 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
                onClick={() => updateStatus(payment.id, 'REJECTED')}
                title="Rechazar pago"
              >
                ✗
              </button>
            ) : null}
          </div>
        </div>
      )),
    [canManagePayments, openPaymentEvidence, openPaymentReceipt, openingEvidenceId, payments, updateStatus],
  );

  if (!canViewPayments && !canManagePayments) {
    return (
      <section className="card">
        <h1 className="text-xl font-semibold">Pagos</h1>
        <p className="mt-2 text-sm text-primary-700">No tienes permisos para acceder a este módulo.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary-900">Pagos simplificados</h1>
          <p className="text-sm text-primary-700">
            Selecciona alumno, valida sus cuotas pendientes y registra pago con cálculo automático.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-800">
            {payments.length} pagos cargados
          </span>
          {canManagePayments ? (
            <button
              type="button"
              onClick={() => {
                if (showPaymentForm) {
                  setShowPaymentForm(false);
                  resetPaymentForm();
                } else {
                  setShowPaymentForm(true);
                }
              }}
              className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
            >
              {showPaymentForm ? 'Cerrar formulario' : 'Registrar pago'}
            </button>
          ) : null}
        </div>
      </div>

      {message ? <p className="rounded-xl bg-primary-50 p-3 text-sm text-primary-800">{message}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {canManagePayments && canViewEnrollments && showPaymentForm ? (
        <form onSubmit={submitPayment} className="panel-soft space-y-4">
          <div className="grid gap-3 lg:grid-cols-4">
            <select
              className="app-input lg:col-span-2"
              value={form.student_id}
              onFocus={ensureEnrollmentsLoaded}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  student_id: event.target.value,
                  selected_installment_id: ALL_PENDING_INSTALLMENTS,
                  amount_received: '',
                }))
              }
              required
            >
              <option value="">Seleccione alumno</option>
              {studentOptions.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.label}
                </option>
              ))}
            </select>

            <select
              className="app-input lg:col-span-2"
              value={form.selected_installment_id}
              onChange={(event) => handleInstallmentSelection(event.target.value)}
              disabled={!form.student_id || loadingPendingSummary}
            >
              <option value={ALL_PENDING_INSTALLMENTS}>Todas las cuotas pendientes</option>
              {pendingInstallmentOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>

            <input
              type="number"
              min="0.01"
              step="0.01"
              className="app-input"
              placeholder="Monto que cancela"
              value={form.amount_received}
              onChange={(event) => setForm((prev) => ({ ...prev, amount_received: event.target.value }))}
              required
            />

            <select
              className="app-input"
              value={form.method}
              onChange={(event) => setForm((prev) => ({ ...prev, method: event.target.value }))}
              aria-label="Método de pago"
              required
            >
              <option value="EFECTIVO">Efectivo</option>
              <option value="YAPE">Yape</option>
              <option value="PLIN">Plin</option>
              <option value="TRANSFERENCIA">Transferencia</option>
              <option value="QR">QR</option>
              <option value="TARJETA">Tarjeta</option>
              <option value="CANJE">Canje</option>
              <option value="OTRO">Otro</option>
            </select>

            <input
              className="app-input lg:col-span-2"
              placeholder={form.method === 'EFECTIVO' ? 'Número de operación (opcional)' : 'Número de operación'}
              value={form.reference_code}
              onChange={(event) => setForm((prev) => ({ ...prev, reference_code: event.target.value }))}
              required={form.method !== 'EFECTIVO'}
            />

            <input
              className="app-input lg:col-span-2"
              placeholder="Observaciones (opcional)"
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />

            <select
              className="app-input"
              value={form.receipt_document_type}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  receipt_document_type: event.target.value,
                }))
              }
              aria-label="Tipo de comprobante"
            >
              <option value="BOLETA">Boleta</option>
              <option value="FACTURA">Factura</option>
              <option value="RECIBO_INTERNO">Recibo interno</option>
            </select>

            <select
              className="app-input"
              value={receiptFormat}
              onChange={(event) => setReceiptFormat(event.target.value)}
              aria-label="Diseño del comprobante"
            >
              <option value="F1">Diseño ticket</option>
              <option value="F2">Diseño A4</option>
            </select>
          </div>

          {form.receipt_document_type === 'FACTURA' ? (
            <fieldset className="rounded-2xl border border-primary-200 bg-primary-50/40 p-4">
              <legend className="px-2 text-sm font-semibold text-primary-900">Datos de facturación</legend>
              <div className="grid gap-3 lg:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary-700">RUC</span>
                  <input
                    className="app-input"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="11 dígitos"
                    value={form.billing_document}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        billing_document: event.target.value.replace(/\D/g, '').slice(0, 11),
                      }))
                    }
                    required
                  />
                </label>

                <label className="space-y-1 lg:col-span-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary-700">
                    Razón social
                  </span>
                  <input
                    className="app-input"
                    maxLength={180}
                    placeholder="Nombre o razón social"
                    value={form.billing_name}
                    onChange={(event) => setForm((prev) => ({ ...prev, billing_name: event.target.value }))}
                    required
                  />
                </label>

                <label className="space-y-1 lg:col-span-4">
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary-700">
                    Dirección fiscal
                  </span>
                  <input
                    className="app-input"
                    maxLength={240}
                    placeholder="Dirección fiscal completa"
                    value={form.billing_address}
                    onChange={(event) => setForm((prev) => ({ ...prev, billing_address: event.target.value }))}
                    required
                  />
                </label>
              </div>
              <p className="mt-3 text-xs text-primary-700">
                Este formato se genera dentro del sistema. La validez tributaria requiere emisión electrónica
                mediante SUNAT.
              </p>
            </fieldset>
          ) : null}

          {form.method !== 'EFECTIVO' ? (
            <div className="grid gap-3 lg:grid-cols-4">
              <label className="app-input flex items-center gap-2 lg:col-span-2">
                <input
                  type="checkbox"
                  checked={form.no_evidence}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      no_evidence: event.target.checked,
                    }))
                  }
                />
                No se tiene evidencias
              </label>

              <input
                type="file"
                accept="image/*,.pdf"
                className="app-input lg:col-span-2"
                onChange={(event) => setEvidenceFile(event.target.files?.[0] || null)}
                disabled={form.no_evidence}
                required={!form.no_evidence}
              />
            </div>
          ) : null}

          {evidenceFile ? <p className="text-xs text-primary-700">Evidencia seleccionada: {evidenceFile.name}</p> : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border border-primary-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Total pendiente</p>
              <p className="mt-1 text-xl font-semibold text-primary-900">S/ {pendingTotals.totalPending.toFixed(2)}</p>
            </article>
            <article className="rounded-xl border border-primary-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Monto aplicado</p>
              <p className="mt-1 text-xl font-semibold text-primary-900">S/ {pendingTotals.amountApplied.toFixed(2)}</p>
            </article>
            <article className="rounded-xl border border-primary-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Saldo pendiente</p>
              <p className="mt-1 text-xl font-semibold text-primary-900">S/ {pendingTotals.remainingDebt.toFixed(2)}</p>
            </article>
            <article className="rounded-xl border border-primary-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Saldo a favor</p>
              <p className="mt-1 text-xl font-semibold text-primary-900">S/ {pendingTotals.overpayment.toFixed(2)}</p>
            </article>
          </div>

          {loadingPendingSummary ? <p className="text-sm text-primary-700">Cargando cuotas pendientes...</p> : null}

          {selectedPendingItems.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-primary-600">
                    <th className="pb-2 pr-3">Matrícula</th>
                    <th className="pb-2 pr-3">Curso</th>
                    <th className="pb-2 pr-3">Cuota</th>
                    <th className="pb-2 pr-3">Vence</th>
                    <th className="pb-2 pr-3">Pendiente</th>
                    <th className="pb-2">Aplicar</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPendingItems.map((item) => {
                    const allocatedAmount = round2(
                      allocationByInstallment.get(String(item.installment_id)) || 0,
                    );

                    return (
                      <tr key={item.installment_id} className="border-t border-primary-100">
                        <td className="py-2 pr-3">#{item.enrollment_id}</td>
                        <td className="py-2 pr-3">
                          {item.course_name} - {item.campus_name}
                        </td>
                        <td className="py-2 pr-3">
                          #{item.installment_id} {item.concept_name ? `(${item.concept_name})` : ''}
                        </td>
                        <td className="py-2 pr-3">{item.due_date}</td>
                        <td className="py-2 pr-3">S/ {round2(item.pending_amount).toFixed(2)}</td>
                        <td className="py-2 font-semibold">S/ {allocatedAmount.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {!loadingPendingSummary && form.student_id && selectedPendingItems.length === 0 ? (
            <p className="text-sm text-primary-700">El alumno seleccionado no tiene cuotas pendientes.</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={previewPaymentReceipt}
              disabled={loadingPendingSummary || loadingEnrollments}
              className="rounded-xl border border-primary-300 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Vista previa comprobante
            </button>

            <button
              type="submit"
              onClick={() => {
                submitModeRef.current = 'save';
              }}
              disabled={savingPayment || loadingPendingSummary || loadingEnrollments}
              className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingPayment ? 'Registrando...' : 'Guardar pago'}
            </button>

            <button
              type="submit"
              onClick={() => {
                submitModeRef.current = 'print';
              }}
              disabled={savingPayment || loadingPendingSummary || loadingEnrollments}
              className="rounded-xl border border-accent-300 px-4 py-2 text-sm font-semibold text-accent-800 hover:bg-accent-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingPayment ? 'Procesando...' : 'Guardar e imprimir'}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowPaymentForm(false);
                resetPaymentForm();
              }}
              className="rounded-xl border border-primary-300 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {canViewPayments ? (
        <article className="card overflow-x-auto">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Historial y reporte de pagos</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={clearPaymentFilters}
                disabled={
                  loadingPayments ||
                  (statusFilter === 'ALL' && !studentFilter && !campusFilter && !dateFromFilter && !dateToFilter)
                }
                className="rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Limpiar filtros
              </button>
              <button
                type="button"
                onClick={exportPaymentsCsv}
                disabled={loadingPayments || exportingPayments}
                className="rounded-lg border border-primary-300 bg-white px-3 py-2 text-sm font-semibold text-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportingPayments ? 'Exportando...' : 'Exportar Excel'}
              </button>
            </div>
          </div>

          <div className={`mb-3 grid gap-2 ${canViewCampuses ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
            <select
              className="app-input"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPaymentVisibleCount(PAYMENT_INITIAL_LIMIT);
              }}
            >
              <option value="ALL">Todos los estados</option>
              <option value="COMPLETED">Completados</option>
              <option value="PENDING">Pendientes</option>
              <option value="REJECTED">Rechazados</option>
            </select>

            <select
              className="app-input"
              value={studentFilter}
              onFocus={ensureEnrollmentsLoaded}
              onChange={(event) => {
                setStudentFilter(event.target.value);
                setPaymentVisibleCount(PAYMENT_INITIAL_LIMIT);
              }}
            >
              <option value="">Todos los alumnos</option>
              {studentOptions.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.label}
                </option>
              ))}
            </select>

            {canViewCampuses ? (
              <select
                className="app-input"
                value={campusFilter}
                onChange={(event) => {
                  setCampusFilter(event.target.value);
                  setPaymentVisibleCount(PAYMENT_INITIAL_LIMIT);
                }}
                disabled={loadingCampuses}
              >
                <option value="">Todas las sedes</option>
                {campuses.map((campus) => (
                  <option key={campus.id} value={campus.id}>
                    {campus.name}
                  </option>
                ))}
              </select>
            ) : null}

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-primary-700">Desde</span>
              <input
                type="date"
                className="app-input"
                value={dateFromFilter}
                onChange={(event) => {
                  setDateFromFilter(event.target.value);
                  setPaymentVisibleCount(PAYMENT_INITIAL_LIMIT);
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-primary-700">Hasta</span>
              <input
                type="date"
                className="app-input"
                value={dateToFilter}
                onChange={(event) => {
                  setDateToFilter(event.target.value);
                  setPaymentVisibleCount(PAYMENT_INITIAL_LIMIT);
                }}
              />
            </label>
          </div>

          <div className="grid gap-4 mt-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {paymentTableRows}
          </div>
          
          {!loadingPayments && payments.length === 0 ? (
            <div className="py-10 text-center text-sm text-primary-600 bg-primary-50/30 rounded-xl border border-primary-50 mt-4">
              No se encontraron pagos con los filtros seleccionados.
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {hasMorePayments ? (
              <button
                type="button"
                onClick={() => setPaymentVisibleCount((current) => current + PAYMENT_LOAD_STEP)}
                disabled={loadingPayments}
                className="rounded-lg border border-primary-300 px-3 py-2 text-sm font-semibold text-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingPayments ? 'Cargando...' : `Ver ${PAYMENT_LOAD_STEP} pagos más`}
              </button>
            ) : null}
            {paymentVisibleCount > PAYMENT_INITIAL_LIMIT ? (
              <button
                type="button"
                onClick={() => setPaymentVisibleCount(PAYMENT_INITIAL_LIMIT)}
                disabled={loadingPayments}
                className="rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Ver solo los últimos {PAYMENT_INITIAL_LIMIT}
              </button>
            ) : null}
          </div>
        </article>
      ) : null}

      {rejectingPaymentId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-2 text-xl font-bold text-red-700">Rechazar pago</h2>
            <p className="mb-4 text-sm font-medium text-primary-700">
              Ingresa el motivo exacto del rechazo para que quede registrado.
            </p>
            <textarea
              className="app-input min-h-[100px] w-full resize-none text-sm font-medium"
              value={rejectionNotes}
              onChange={(e) => setRejectionNotes(e.target.value)}
              placeholder="Ej: El voucher está desenfocado, el monto es incorrecto..."
              autoFocus
            />
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setRejectingPaymentId(null)}
                disabled={savingRejection}
                className="rounded-xl border border-primary-200 bg-white px-4 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmRejection}
                disabled={savingRejection || !rejectionNotes.trim()}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {savingRejection ? 'Rechazando...' : 'Confirmar rechazo'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const isAlumnoProfile = (user?.roles || []).length === 1 && (user?.roles || []).includes('ALUMNO');

  if (isAlumnoProfile) {
    return <StudentPaymentsPage />;
  }

  return <StaffPaymentsPage />;
}
