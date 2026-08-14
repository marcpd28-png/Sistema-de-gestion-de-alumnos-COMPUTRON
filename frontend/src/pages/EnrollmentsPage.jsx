import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { CalendarRange, NotebookPen, Wallet } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../constants/permissions';
import { calculateAgeFromBirthDate, formatAgeLabel } from '../utils/age';

const getTodayIsoDate = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const createEnrollmentDefaults = () => ({
  student_id: '',
  course_campus_id: '',
  schedule_info: '',
  period_id: '',
  enrollment_date: getTodayIsoDate(),
});

const createQuickEnrollmentDefaults = () => ({
  student_first_name: '',
  student_last_name: '',
  student_document_number: '',
  student_birth_date: '',
  student_email: '',
  student_phone: '',
  student_address: '',
  guardian_first_name: '',
  guardian_last_name: '',
  guardian_email: '',
  guardian_phone: '',
  guardian_document_number: '',
  guardian_relationship: 'APODERADO',
  course_campus_id: '',
  schedule_info: '',
  period_id: '',
  enrollment_date: getTodayIsoDate(),
});

const createInstallmentDefaults = () => ({
  enrollment_id: '',
  concept_id: '',
  due_date: getTodayIsoDate(),
  total_amount: '',
  description: '',
});

const createPeriodDefaults = () => ({
  name: '',
  start_date: getTodayIsoDate(),
  end_date: getTodayIsoDate(),
});

const getScheduleBlocks = (scheduleInfo) =>
  String(scheduleInfo || '')
    .split('|')
    .map((block) => block.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

const DEFAULT_RECEIPT_FORMAT = 'F3';
const RECEIPT_FORMAT_LABELS = {
  F3: 'Boleta Computron',
  F2: 'Boleta A4 simple',
  F1: 'Boleta ticketera',
};
const DEFAULT_RECEIPT_PAPER_SIZE = 'A5';
const RECEIPT_PAPER_SIZE_LABELS = {
  A5: 'A5 doble',
  A4_DUPLICATE: 'A4 doble',
};

export default function EnrollmentsPage() {
  const { hasPermission } = useAuth();
  const [enrollments, setEnrollments] = useState([]);
  const [students, setStudents] = useState([]);
  const [courses, setCourses] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [concepts, setConcepts] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [enrollmentForm, setEnrollmentForm] = useState(createEnrollmentDefaults);
  const [quickEnrollmentForm, setQuickEnrollmentForm] = useState(createQuickEnrollmentDefaults);
  const [installmentForm, setInstallmentForm] = useState(createInstallmentDefaults);
  const [periodForm, setPeriodForm] = useState(createPeriodDefaults);
  const [activeTab, setActiveTab] = useState('enrollments');
  const [, startTabTransition] = useTransition();
  const [showEnrollmentForm, setShowEnrollmentForm] = useState(false);
  const [showQuickEnrollmentForm, setShowQuickEnrollmentForm] = useState(false);
  const [showInstallmentForm, setShowInstallmentForm] = useState(false);
  const [showPeriodForm, setShowPeriodForm] = useState(false);
  const [receiptFormat, setReceiptFormat] = useState(DEFAULT_RECEIPT_FORMAT);
  const [receiptPaperSize, setReceiptPaperSize] = useState(DEFAULT_RECEIPT_PAPER_SIZE);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const changeTab = (nextTab) => {
    startTabTransition(() => setActiveTab(nextTab));
  };

  const canViewEnrollments = hasPermission(PERMISSIONS.ENROLLMENTS_VIEW);
  const canManageEnrollments = hasPermission(PERMISSIONS.ENROLLMENTS_MANAGE);
  const canViewInstallments = hasPermission(PERMISSIONS.INSTALLMENTS_VIEW);
  const canManageInstallments = hasPermission(PERMISSIONS.INSTALLMENTS_MANAGE);
  const canViewStudents = hasPermission(PERMISSIONS.STUDENTS_VIEW);
  const canManageStudents = hasPermission(PERMISSIONS.STUDENTS_MANAGE);
  const canViewCourses = hasPermission(PERMISSIONS.COURSES_VIEW);
  const canViewPeriods = hasPermission(PERMISSIONS.PERIODS_VIEW);
  const canManagePeriods = hasPermission(PERMISSIONS.PERIODS_MANAGE);
  const canViewConcepts = hasPermission(PERMISSIONS.PAYMENT_CONCEPTS_VIEW);
  const canManageGuardians = hasPermission(PERMISSIONS.GUARDIANS_MANAGE);
  const canCreateEnrollmentFromScratch =
    canManageEnrollments && canManageStudents && canManageGuardians;

  const loadData = useCallback(async () => {
    try {
      if (canViewEnrollments) {
        const enrollmentsRes = await api.get('/enrollments');
        setEnrollments(enrollmentsRes.data.items || []);
      } else {
        setEnrollments([]);
      }

      if (canViewStudents) {
        const studentsRes = await api.get('/students');
        setStudents(studentsRes.data.items || []);
      } else {
        setStudents([]);
      }

      if (canViewCourses) {
        const coursesRes = await api.get('/courses');
        setCourses(coursesRes.data.items || []);
      } else {
        setCourses([]);
      }

      if (canViewPeriods) {
        const periodsRes = await api.get('/catalogs/periods');
        setPeriods(periodsRes.data.items || []);
      } else {
        setPeriods([]);
      }

      if (canViewConcepts) {
        const conceptsRes = await api.get('/catalogs/payment-concepts');
        setConcepts(conceptsRes.data.items || []);
      } else {
        setConcepts([]);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudieron cargar las matriculas.');
    }
  }, [
    canViewEnrollments,
    canViewStudents,
    canViewCourses,
    canViewPeriods,
    canViewConcepts,
  ]);

  const loadInstallments = useCallback(async () => {
    if (!canViewInstallments || !installmentForm.enrollment_id) {
      setInstallments([]);
      return;
    }

    try {
      const response = await api.get(`/enrollments/${installmentForm.enrollment_id}/installments`);
      setInstallments(response.data.items || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudieron cargar las cuotas.');
    }
  }, [canViewInstallments, installmentForm.enrollment_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadInstallments();
  }, [loadInstallments]);

  const offerings = useMemo(() => {
    const all = [];
    for (const course of courses) {
      for (const offering of course.offerings || []) {
        all.push({
          id: offering.offering_id,
          label: `${course.name} - ${offering.campus_name} (${offering.modality || 'PRESENCIAL'})`,
          schedule_info: offering.schedule_info || '',
          schedule_blocks: getScheduleBlocks(offering.schedule_info),
        });
      }
    }
    return all;
  }, [courses]);

  const findOffering = useCallback(
    (offeringId) => offerings.find((offering) => String(offering.id) === String(offeringId)) || null,
    [offerings],
  );

  const getDefaultScheduleInfo = useCallback(
    (offeringId) => {
      const scheduleBlocks = findOffering(offeringId)?.schedule_blocks || [];
      return scheduleBlocks.length === 1 ? scheduleBlocks[0] : '';
    },
    [findOffering],
  );

  const selectedEnrollmentScheduleBlocks = findOffering(enrollmentForm.course_campus_id)?.schedule_blocks || [];
  const selectedQuickEnrollmentScheduleBlocks =
    findOffering(quickEnrollmentForm.course_campus_id)?.schedule_blocks || [];

  const quickEnrollmentAgeLabel = useMemo(
    () => formatAgeLabel(calculateAgeFromBirthDate(quickEnrollmentForm.student_birth_date)),
    [quickEnrollmentForm.student_birth_date],
  );

  const submitPeriod = async (event) => {
    event.preventDefault();
    if (!canManagePeriods) return;

    setMessage('');
    setError('');

    try {
      await api.post('/catalogs/periods', {
        ...periodForm,
        is_active: true,
      });

      setPeriodForm(createPeriodDefaults());
      setShowPeriodForm(false);
      setMessage('Periodo creado correctamente.');
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo crear el periodo.');
    }
  };

  const openEnrollmentReceipt = async (
    enrollmentId,
    { silent = false, format = receiptFormat, paperSize = receiptPaperSize } = {},
  ) => {
    if (!enrollmentId) return;

    try {
      const response = await api.get(`/enrollments/${enrollmentId}/receipt`, {
        params: { format, paper_size: paperSize },
        responseType: 'text',
      });

      const receiptWindow = window.open('', '_blank', 'noopener,noreferrer');
      if (!receiptWindow) {
        if (!silent) {
          setError('El navegador bloqueó la boleta. Habilita ventanas emergentes e intenta nuevamente.');
        }
        return;
      }

      receiptWindow.document.open();
      receiptWindow.document.write(response.data || '');
      receiptWindow.document.close();
    } catch (requestError) {
      if (!silent) {
        setError(requestError.response?.data?.message || 'No se pudo emitir la boleta de matrícula.');
      }
    }
  };

  const submitEnrollment = async (event) => {
    event.preventDefault();
    if (!canManageEnrollments) return;

    setMessage('');
    setError('');

    try {
      if (selectedEnrollmentScheduleBlocks.length > 1 && !enrollmentForm.schedule_info) {
        throw new Error('Selecciona el bloque horario para esta matrícula.');
      }

      const response = await api.post('/enrollments', {
        student_id: Number(enrollmentForm.student_id),
        course_campus_id: Number(enrollmentForm.course_campus_id),
        period_id: Number(enrollmentForm.period_id),
        enrollment_date: enrollmentForm.enrollment_date || undefined,
        schedule_info: enrollmentForm.schedule_info || null,
      });
      const createdEnrollmentId = Number(response.data?.item?.id || 0);

      setEnrollmentForm(createEnrollmentDefaults());
      setShowEnrollmentForm(false);
      setMessage('Matricula registrada.');
      await loadData();

      if (createdEnrollmentId) {
        await openEnrollmentReceipt(createdEnrollmentId, {
          silent: true,
          format: receiptFormat,
          paperSize: receiptPaperSize,
        });
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'No se pudo crear la matricula.');
    }
  };

  const submitQuickEnrollment = async (event) => {
    event.preventDefault();
    if (!canCreateEnrollmentFromScratch) return;

    setMessage('');
    setError('');

    try {
      if (selectedQuickEnrollmentScheduleBlocks.length > 1 && !quickEnrollmentForm.schedule_info) {
        throw new Error('Selecciona el bloque horario para esta matrícula.');
      }

      const guardianResponse = await api.post('/guardians', {
        first_name: quickEnrollmentForm.guardian_first_name.trim(),
        last_name: quickEnrollmentForm.guardian_last_name.trim(),
        email: quickEnrollmentForm.guardian_email.trim() || null,
        phone: quickEnrollmentForm.guardian_phone.trim() || null,
        document_number: quickEnrollmentForm.guardian_document_number.trim() || null,
      });

      const guardianId = Number(guardianResponse.data?.item?.id);
      if (!guardianId) {
        throw new Error('No se pudo crear el apoderado para esta matrícula.');
      }

      const studentResponse = await api.post('/students', {
        first_name: quickEnrollmentForm.student_first_name.trim(),
        last_name: quickEnrollmentForm.student_last_name.trim(),
        document_number: quickEnrollmentForm.student_document_number.trim(),
        birth_date: quickEnrollmentForm.student_birth_date,
        email: quickEnrollmentForm.student_email.trim() || null,
        phone: quickEnrollmentForm.student_phone.trim() || null,
        address: quickEnrollmentForm.student_address.trim() || null,
        guardian_links: [
          {
            guardian_id: guardianId,
            relationship: quickEnrollmentForm.guardian_relationship.trim() || 'APODERADO',
          },
        ],
        enrollment: {
          course_campus_id: Number(quickEnrollmentForm.course_campus_id),
          period_id: Number(quickEnrollmentForm.period_id),
          enrollment_date: quickEnrollmentForm.enrollment_date || undefined,
          schedule_info: quickEnrollmentForm.schedule_info || null,
          status: 'ACTIVE',
        },
      });

      const account = studentResponse.data?.item?.student_account || null;
      const createdEnrollmentId = Number(studentResponse.data?.item?.enrollment?.id || 0);
      const accountHint = account
        ? ` Cuenta creada: ${account.email} | clave inicial: ${account.initial_password}`
        : '';

      setQuickEnrollmentForm(createQuickEnrollmentDefaults());
      setShowQuickEnrollmentForm(false);
      setMessage(`Matrícula registrada con alumno y apoderado.${accountHint}`);
      await loadData();

      if (createdEnrollmentId) {
        await openEnrollmentReceipt(createdEnrollmentId, {
          silent: true,
          format: receiptFormat,
          paperSize: receiptPaperSize,
        });
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'No se pudo registrar la matrícula completa.');
    }
  };

  const submitInstallment = async (event) => {
    event.preventDefault();
    if (!canManageInstallments) return;

    setMessage('');
    setError('');

    try {
      await api.post(`/enrollments/${installmentForm.enrollment_id}/installments`, {
        concept_id: Number(installmentForm.concept_id),
        due_date: installmentForm.due_date,
        total_amount: Number(installmentForm.total_amount),
        description: installmentForm.description || null,
      });

      setInstallmentForm((prev) => ({
        ...createInstallmentDefaults(),
        enrollment_id: prev.enrollment_id,
      }));
      setShowInstallmentForm(false);
      setMessage('Cuota creada correctamente.');
      await loadInstallments();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo crear la cuota.');
    }
  };

  if (!canViewEnrollments && !canManageEnrollments && !canManageInstallments && !canManagePeriods) {
    return (
      <section className="card">
        <h1 className="text-xl font-semibold">Matriculas y cuotas</h1>
        <p className="mt-2 text-sm text-primary-700">No tienes permisos para acceder a este modulo.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary-900">Matriculas y cuotas</h1>
          <p className="text-sm text-primary-700">Vista operacional separada por tipo de gestion.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-800">
            {enrollments.length} matriculas
          </span>
          <span className="rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-800">
            {periods.length} periodos
          </span>
        </div>
      </div>

      <div className="page-tabs">
        {canViewEnrollments || canManageEnrollments ? (
          <button
            type="button"
            onClick={() => changeTab('enrollments')}
            className={`page-tab ${activeTab === 'enrollments' ? 'page-tab-active' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                  activeTab === 'enrollments' ? 'bg-white/20 text-white' : 'bg-primary-50 text-primary-600'
                }`}
              >
                <NotebookPen className="h-4 w-4" />
              </span>
              <span>Matriculas</span>
            </span>
          </button>
        ) : null}
        {canViewInstallments || canManageInstallments ? (
          <button
            type="button"
            onClick={() => changeTab('installments')}
            className={`page-tab ${activeTab === 'installments' ? 'page-tab-active' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                  activeTab === 'installments' ? 'bg-white/20 text-white' : 'bg-primary-50 text-primary-600'
                }`}
              >
                <Wallet className="h-4 w-4" />
              </span>
              <span>Cuotas</span>
            </span>
          </button>
        ) : null}
        {canViewPeriods || canManagePeriods ? (
          <button
            type="button"
            onClick={() => changeTab('periods')}
            className={`page-tab ${activeTab === 'periods' ? 'page-tab-active' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                  activeTab === 'periods' ? 'bg-white/20 text-white' : 'bg-primary-50 text-primary-600'
                }`}
              >
                <CalendarRange className="h-4 w-4" />
              </span>
              <span>Periodos</span>
            </span>
          </button>
        ) : null}
      </div>

      {message ? <p className="rounded-xl bg-primary-50 p-3 text-sm text-primary-800">{message}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {activeTab === 'enrollments' && (canViewEnrollments || canManageEnrollments) ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              className="app-input w-full sm:min-w-[170px]"
              value={receiptFormat}
              onChange={(event) => setReceiptFormat(event.target.value)}
            >
              {Object.entries(RECEIPT_FORMAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>

            <select
              className="app-input w-full sm:min-w-[120px]"
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

            {canManageEnrollments ? (
              <>
                {canCreateEnrollmentFromScratch ? (
                  <button
                    type="button"
                    onClick={() => setShowQuickEnrollmentForm((value) => !value)}
                    className="rounded-xl border border-primary-300 bg-white px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
                  >
                    {showQuickEnrollmentForm ? 'Cerrar matrícula completa' : 'Matricular alumno nuevo'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setShowEnrollmentForm((value) => !value)}
                  className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
                >
                  {showEnrollmentForm ? 'Cerrar formulario' : 'Nueva matricula'}
                </button>
              </>
            ) : null}
          </div>

          {showQuickEnrollmentForm && canCreateEnrollmentFromScratch ? (
            <form onSubmit={submitQuickEnrollment} className="panel-soft space-y-4">
              <h2 className="text-lg font-semibold text-primary-900">Registrar matrícula completa</h2>
              <p className="text-sm text-primary-700">
                Crea alumno y apoderado, y genera la matrícula en una sola operación.
              </p>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <h3 className="text-sm font-semibold text-primary-900 sm:col-span-2 lg:col-span-4">Datos del alumno</h3>
                <input
                  className="app-input"
                  placeholder="Nombres del alumno"
                  value={quickEnrollmentForm.student_first_name}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, student_first_name: event.target.value }))
                  }
                  required
                />
                <input
                  className="app-input"
                  placeholder="Apellidos del alumno"
                  value={quickEnrollmentForm.student_last_name}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, student_last_name: event.target.value }))
                  }
                  required
                />
                <input
                  className="app-input"
                  placeholder="Documento del alumno"
                  value={quickEnrollmentForm.student_document_number}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, student_document_number: event.target.value }))
                  }
                  required
                />
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-primary-700">Fecha de nacimiento</span>
                  <input
                    type="date"
                    className="app-input"
                    value={quickEnrollmentForm.student_birth_date}
                    onChange={(event) =>
                      setQuickEnrollmentForm((prev) => ({ ...prev, student_birth_date: event.target.value }))
                    }
                    required
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-primary-700">Edad</span>
                  <input
                    className="app-input"
                    value={quickEnrollmentAgeLabel}
                    placeholder="Se calcula automáticamente"
                    readOnly
                  />
                </label>
                <input
                  type="email"
                  className="app-input"
                  placeholder="Correo del alumno (opcional)"
                  value={quickEnrollmentForm.student_email}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, student_email: event.target.value }))
                  }
                />
                <input
                  className="app-input"
                  placeholder="Teléfono del alumno (opcional)"
                  value={quickEnrollmentForm.student_phone}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, student_phone: event.target.value }))
                  }
                />
                <input
                  className="app-input sm:col-span-2"
                  placeholder="Dirección del alumno (opcional)"
                  value={quickEnrollmentForm.student_address}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, student_address: event.target.value }))
                  }
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <h3 className="text-sm font-semibold text-primary-900 sm:col-span-2 lg:col-span-4">Datos del apoderado</h3>
                <input
                  className="app-input"
                  placeholder="Nombres del apoderado"
                  value={quickEnrollmentForm.guardian_first_name}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, guardian_first_name: event.target.value }))
                  }
                  required
                />
                <input
                  className="app-input"
                  placeholder="Apellidos del apoderado"
                  value={quickEnrollmentForm.guardian_last_name}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, guardian_last_name: event.target.value }))
                  }
                  required
                />
                <input
                  type="email"
                  className="app-input"
                  placeholder="Correo del apoderado (opcional)"
                  value={quickEnrollmentForm.guardian_email}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, guardian_email: event.target.value }))
                  }
                />
                <input
                  className="app-input"
                  placeholder="Teléfono del apoderado (opcional)"
                  value={quickEnrollmentForm.guardian_phone}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, guardian_phone: event.target.value }))
                  }
                />
                <input
                  className="app-input"
                  placeholder="Documento del apoderado (opcional)"
                  value={quickEnrollmentForm.guardian_document_number}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, guardian_document_number: event.target.value }))
                  }
                />
                <input
                  className="app-input"
                  placeholder="Parentesco (ej. MADRE)"
                  value={quickEnrollmentForm.guardian_relationship}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, guardian_relationship: event.target.value }))
                  }
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <h3 className="text-sm font-semibold text-primary-900 sm:col-span-2 lg:col-span-4">Datos de matrícula</h3>
                <select
                  className="app-input"
                  value={quickEnrollmentForm.course_campus_id}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({
                      ...prev,
                      course_campus_id: event.target.value,
                      schedule_info: getDefaultScheduleInfo(event.target.value),
                    }))
                  }
                  required
                >
                  <option value="">Curso / sede</option>
                  {offerings.map((offering) => (
                    <option key={offering.id} value={offering.id}>
                      {offering.label}
                    </option>
                  ))}
                </select>

                <select
                  className="app-input"
                  value={quickEnrollmentForm.schedule_info}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, schedule_info: event.target.value }))
                  }
                  disabled={!quickEnrollmentForm.course_campus_id || selectedQuickEnrollmentScheduleBlocks.length === 0}
                  required={selectedQuickEnrollmentScheduleBlocks.length > 1}
                >
                  <option value="">
                    {!quickEnrollmentForm.course_campus_id
                      ? 'Elige curso primero'
                      : selectedQuickEnrollmentScheduleBlocks.length === 0
                        ? 'Sin bloques registrados'
                        : 'Bloque horario'}
                  </option>
                  {selectedQuickEnrollmentScheduleBlocks.map((block, index) => (
                    <option key={`${block}-${index}`} value={block}>
                      Bloque #{index + 1}: {block}
                    </option>
                  ))}
                </select>

                <select
                  className="app-input"
                  value={quickEnrollmentForm.period_id}
                  onChange={(event) =>
                    setQuickEnrollmentForm((prev) => ({ ...prev, period_id: event.target.value }))
                  }
                  required
                >
                  <option value="">Periodo</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.name}
                    </option>
                  ))}
                </select>

                <label className="space-y-1">
                  <span className="text-xs font-semibold text-primary-700">Fecha de matrícula</span>
                  <input
                    type="date"
                    className="app-input"
                    value={quickEnrollmentForm.enrollment_date}
                    onChange={(event) =>
                      setQuickEnrollmentForm((prev) => ({ ...prev, enrollment_date: event.target.value }))
                    }
                  />
                </label>
              </div>
              <p className="text-xs text-primary-600">
                La fecha de matrícula es el día en que se registra la inscripción del alumno.
              </p>

              <div className="flex flex-wrap gap-2">
                <button className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700">
                  Guardar matrícula completa
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuickEnrollmentForm(createQuickEnrollmentDefaults());
                    setShowQuickEnrollmentForm(false);
                  }}
                  className="rounded-xl border border-primary-300 bg-white px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : null}

          {showEnrollmentForm && canManageEnrollments ? (
            <form onSubmit={submitEnrollment} className="panel-soft space-y-3">
              <h2 className="text-lg font-semibold text-primary-900">Registrar matricula</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <select
                  className="app-input"
                  value={enrollmentForm.student_id}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, student_id: event.target.value }))}
                  required
                >
                  <option value="">Alumno</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.first_name} {student.last_name}
                    </option>
                  ))}
                </select>

                <select
                  className="app-input"
                  value={enrollmentForm.course_campus_id}
                  onChange={(event) =>
                    setEnrollmentForm((prev) => ({
                      ...prev,
                      course_campus_id: event.target.value,
                      schedule_info: getDefaultScheduleInfo(event.target.value),
                    }))
                  }
                  required
                >
                  <option value="">Curso / sede</option>
                  {offerings.map((offering) => (
                    <option key={offering.id} value={offering.id}>
                      {offering.label}
                    </option>
                  ))}
                </select>

                <select
                  className="app-input"
                  value={enrollmentForm.schedule_info}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, schedule_info: event.target.value }))}
                  disabled={!enrollmentForm.course_campus_id || selectedEnrollmentScheduleBlocks.length === 0}
                  required={selectedEnrollmentScheduleBlocks.length > 1}
                >
                  <option value="">
                    {!enrollmentForm.course_campus_id
                      ? 'Elige curso primero'
                      : selectedEnrollmentScheduleBlocks.length === 0
                        ? 'Sin bloques registrados'
                        : 'Bloque horario'}
                  </option>
                  {selectedEnrollmentScheduleBlocks.map((block, index) => (
                    <option key={`${block}-${index}`} value={block}>
                      Bloque #{index + 1}: {block}
                    </option>
                  ))}
                </select>

                <select
                  className="app-input"
                  value={enrollmentForm.period_id}
                  onChange={(event) => setEnrollmentForm((prev) => ({ ...prev, period_id: event.target.value }))}
                  required
                >
                  <option value="">Periodo</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.name}
                    </option>
                  ))}
                </select>

                <label className="space-y-1">
                  <span className="text-xs font-semibold text-primary-700">Fecha de matrícula</span>
                  <input
                    type="date"
                    className="app-input"
                    value={enrollmentForm.enrollment_date}
                    onChange={(event) =>
                      setEnrollmentForm((prev) => ({ ...prev, enrollment_date: event.target.value }))
                    }
                  />
                </label>
              </div>

              <p className="text-xs text-primary-600">
                Esta fecha corresponde a la inscripción, no a la fecha de nacimiento del alumno.
              </p>

              <button className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700">
                Guardar matricula
              </button>
            </form>
          ) : null}

          {canViewEnrollments ? (
            <article className="card overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-primary-600">
                    <th className="pb-2 pr-3">Alumno</th>
                    <th className="pb-2 pr-3">Curso</th>
                    <th className="pb-2 pr-3">Sede</th>
                    <th className="pb-2 pr-3">Horario</th>
                    <th className="pb-2 pr-3">Periodo</th>
                    <th className="pb-2 pr-3">Estado</th>
                    <th className="pb-2">Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((enrollment) => (
                    <tr key={enrollment.id} className="border-t border-primary-100">
                      <td className="py-2 pr-3 font-medium">{enrollment.student_name}</td>
                      <td className="py-2 pr-3">{enrollment.course_name}</td>
                      <td className="py-2 pr-3">{enrollment.campus_name}</td>
                      <td className="py-2 pr-3">{enrollment.schedule_info || '-'}</td>
                      <td className="py-2 pr-3">{enrollment.period_name}</td>
                      <td className="py-2 pr-3">{enrollment.status}</td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => openEnrollmentReceipt(enrollment.id)}
                          className="rounded-lg border border-primary-200 px-2 py-1 text-xs font-semibold text-primary-800 hover:bg-primary-50"
                        >
                          Boleta
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'installments' && (canViewInstallments || canManageInstallments) ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <select
              className="app-input"
              value={installmentForm.enrollment_id}
              onChange={(event) =>
                setInstallmentForm((prev) => ({ ...prev, enrollment_id: event.target.value }))
              }
              required
            >
              <option value="">Seleccione matricula</option>
              {enrollments.map((enrollment) => (
                <option key={enrollment.id} value={enrollment.id}>
                  #{enrollment.id} - {enrollment.student_name}
                </option>
              ))}
            </select>

            {canManageInstallments ? (
              <button
                type="button"
                onClick={() => setShowInstallmentForm((value) => !value)}
                disabled={!installmentForm.enrollment_id}
                className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {showInstallmentForm ? 'Cerrar formulario' : 'Nueva cuota'}
              </button>
            ) : null}
          </div>

          {showInstallmentForm && canManageInstallments ? (
            <form onSubmit={submitInstallment} className="panel-soft space-y-3">
              <h2 className="text-lg font-semibold text-primary-900">Registrar cuota</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <select
                  className="app-input"
                  value={installmentForm.concept_id}
                  onChange={(event) => setInstallmentForm((prev) => ({ ...prev, concept_id: event.target.value }))}
                  required
                >
                  <option value="">Concepto</option>
                  {concepts.map((concept) => (
                    <option key={concept.id} value={concept.id}>
                      {concept.name}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  className="app-input"
                  value={installmentForm.due_date}
                  onChange={(event) => setInstallmentForm((prev) => ({ ...prev, due_date: event.target.value }))}
                  required
                />

                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="app-input"
                  placeholder="Monto"
                  value={installmentForm.total_amount}
                  onChange={(event) => setInstallmentForm((prev) => ({ ...prev, total_amount: event.target.value }))}
                  required
                />

                <input
                  className="app-input"
                  placeholder="Descripcion"
                  value={installmentForm.description}
                  onChange={(event) => setInstallmentForm((prev) => ({ ...prev, description: event.target.value }))}
                />
              </div>

              <button className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700">
                Guardar cuota
              </button>
            </form>
          ) : null}

          {canViewInstallments ? (
            <article className="card overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-primary-600">
                    <th className="pb-2 pr-3">Concepto</th>
                    <th className="pb-2 pr-3">Vencimiento</th>
                    <th className="pb-2 pr-3">Total</th>
                    <th className="pb-2 pr-3">Pagado</th>
                    <th className="pb-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {installments.map((installment) => (
                    <tr key={installment.id} className="border-t border-primary-100">
                      <td className="py-2 pr-3 font-medium">{installment.concept}</td>
                      <td className="py-2 pr-3">{installment.due_date}</td>
                      <td className="py-2 pr-3">S/ {Number(installment.total_amount).toFixed(2)}</td>
                      <td className="py-2 pr-3">S/ {Number(installment.paid_amount).toFixed(2)}</td>
                      <td className="py-2">{installment.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'periods' && (canViewPeriods || canManagePeriods) ? (
        <div className="space-y-4">
          {canManagePeriods ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowPeriodForm((value) => !value)}
                className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
              >
                {showPeriodForm ? 'Cerrar formulario' : 'Nuevo periodo'}
              </button>
            </div>
          ) : null}

          {showPeriodForm && canManagePeriods ? (
            <form onSubmit={submitPeriod} className="panel-soft space-y-3">
              <h2 className="text-lg font-semibold text-primary-900">Registrar periodo</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  className="app-input"
                  placeholder="2026-I"
                  value={periodForm.name}
                  onChange={(event) => setPeriodForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
                <input
                  type="date"
                  className="app-input"
                  value={periodForm.start_date}
                  onChange={(event) => setPeriodForm((prev) => ({ ...prev, start_date: event.target.value }))}
                  required
                />
                <input
                  type="date"
                  className="app-input"
                  value={periodForm.end_date}
                  onChange={(event) => setPeriodForm((prev) => ({ ...prev, end_date: event.target.value }))}
                  required
                />
              </div>

              <button className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700">
                Guardar periodo
              </button>
            </form>
          ) : null}

          {canViewPeriods ? (
            <article className="card overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-primary-600">
                    <th className="pb-2 pr-3">Periodo</th>
                    <th className="pb-2 pr-3">Inicio</th>
                    <th className="pb-2 pr-3">Fin</th>
                    <th className="pb-2">Activo</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => (
                    <tr key={period.id} className="border-t border-primary-100">
                      <td className="py-2 pr-3 font-medium">{period.name}</td>
                      <td className="py-2 pr-3">{period.start_date}</td>
                      <td className="py-2 pr-3">{period.end_date}</td>
                      <td className="py-2">{period.is_active ? 'SI' : 'NO'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
