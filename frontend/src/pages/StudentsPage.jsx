import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, GraduationCap, UsersRound } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../constants/permissions';
import { calculateAgeFromBirthDate, formatAgeLabel, normalizeDateOnly } from '../utils/age';
import { buildDocumentValue, DOCUMENT_TYPE_OPTIONS, parseDocumentValue } from '../utils/document';
import TransfersManager from './transfers/TransfersManager';

const getTodayIsoDate = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const getEmptyStudent = () => ({
  first_name: '',
  last_name: '',
  document_type: 'DNI',
  document_number: '',
  birth_date: '',
  email: '',
  phone: '',
  address: '',
  notes: '',
  no_guardian: false,
  guardian_id: '',
  guardian_first_name: '',
  guardian_last_name: '',
  guardian_email: '',
  guardian_phone: '',
  guardian_document_number: '',
  link_enrollment: false,
  course_campus_id: '',
  period_id: '',
  enrollment_date: getTodayIsoDate(),
  enrollment_notes: '',
});

const emptyGuardian = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  document_number: '',
};

const STUDENT_RECENT_LIMIT = 10;

export default function StudentsPage() {
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [students, setStudents] = useState([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentLoading, setStudentLoading] = useState(false);

  const [guardians, setGuardians] = useState([]);
  const [courses, setCourses] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [guardianSearch, setGuardianSearch] = useState('');
  const [guardianLinkFilter, setGuardianLinkFilter] = useState('all');

  const [studentForm, setStudentForm] = useState(getEmptyStudent);
  const [guardianForm, setGuardianForm] = useState(emptyGuardian);
  const [editingStudentId, setEditingStudentId] = useState(null);

  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState('students');
  const [, startTabTransition] = useTransition();
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showGuardianForm, setShowGuardianForm] = useState(false);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const canViewStudents = hasPermission(PERMISSIONS.STUDENTS_VIEW);
  const canManageStudents = hasPermission(PERMISSIONS.STUDENTS_MANAGE);
  const canViewGuardians = hasPermission(PERMISSIONS.GUARDIANS_VIEW);
  const canManageGuardians = hasPermission(PERMISSIONS.GUARDIANS_MANAGE);
  const canViewCourses = hasPermission(PERMISSIONS.COURSES_VIEW);
  const canViewPeriods = hasPermission(PERMISSIONS.PERIODS_VIEW);
  const canManageEnrollments = hasPermission(PERMISSIONS.ENROLLMENTS_MANAGE);
  const canUseInlineEnrollment = canManageStudents && canManageEnrollments && canViewCourses && canViewPeriods;
  const canViewTransfers = canViewStudents;
  const canManageTransfers = canViewStudents && canManageEnrollments;
  const showStudentActions = canManageStudents || canManageTransfers;
  const resolveTabKey = useCallback(
    (candidateTab) => {
      const normalized = String(candidateTab || '').trim().toLowerCase();

      if (normalized === 'transfers' && canViewTransfers) return 'transfers';
      if (normalized === 'guardians' && canViewGuardians) return 'guardians';
      if (normalized === 'students' && canViewStudents) return 'students';
      if (canViewStudents) return 'students';
      if (canViewGuardians) return 'guardians';
      return 'students';
    },
    [canViewGuardians, canViewStudents, canViewTransfers],
  );
  const changeTab = useCallback(
    (nextTab, { replace = false } = {}) => {
      const resolvedTab = resolveTabKey(nextTab);
      startTabTransition(() => setActiveTab(resolvedTab));

      const nextParams = new URLSearchParams(searchParams);
      if (resolvedTab && resolvedTab !== 'students') {
        nextParams.set('tab', resolvedTab);
      } else {
        nextParams.delete('tab');
      }

      setSearchParams(nextParams, { replace });
    },
    [resolveTabKey, searchParams, setSearchParams, startTabTransition],
  );

  const openTransferRequest = () => {
    setActiveTab('transfers');
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', 'transfers');
    setSearchParams(nextParams);
    // Note: To automatically pre-select the student, TransfersManager would need a prop for it.
  };

  const fetchStudents = useCallback(
    async (search = '') => {
      if (!canViewStudents) {
        setStudents([]);
        return;
      }

      setStudentLoading(true);
      try {
        const response = await api.get('/students', {
          params: {
            q: search || undefined,
            page: 1,
            page_size: STUDENT_RECENT_LIMIT,
          },
        });

        setStudents(response.data.items || []);
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'No se pudieron cargar los alumnos.');
      } finally {
        setStudentLoading(false);
      }
    },
    [canViewStudents],
  );

  const loadGuardians = useCallback(async () => {
    if (!canViewGuardians) {
      setGuardians([]);
      return;
    }

    try {
      const guardiansRes = await api.get('/guardians', {
        params: {
          has_students: 'all',
          page: 1,
          page_size: 100,
        },
      });
      setGuardians(guardiansRes.data.items || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudieron cargar los apoderados.');
    }
  }, [canViewGuardians]);

  const loadEnrollmentCatalogs = useCallback(async () => {
    if (!canViewCourses) {
      setCourses([]);
    }

    if (!canViewPeriods) {
      setPeriods([]);
    }

    if (!canViewCourses && !canViewPeriods) {
      return;
    }

    try {
      const requests = [];
      if (canViewCourses) requests.push(api.get('/courses'));
      if (canViewPeriods) requests.push(api.get('/catalogs/periods'));

      const responses = await Promise.all(requests);

      if (canViewCourses) {
        const courseResponse = responses.shift();
        setCourses(courseResponse?.data?.items || []);
      }

      if (canViewPeriods) {
        const periodResponse = responses.shift();
        setPeriods(periodResponse?.data?.items || []);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudieron cargar cursos y periodos.');
    }
  }, [canViewCourses, canViewPeriods]);



  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchStudents(studentSearch);
    }, 250);

    return () => clearTimeout(debounce);
  }, [fetchStudents, studentSearch]);

  useEffect(() => {
    loadGuardians();
  }, [loadGuardians]);

  useEffect(() => {
    loadEnrollmentCatalogs();
  }, [loadEnrollmentCatalogs]);



  useEffect(() => {
    const resolvedTab = resolveTabKey(requestedTab);
    const canonicalTab = resolvedTab && resolvedTab !== 'students' ? resolvedTab : '';
    const currentRequestedTab = String(requestedTab || '').trim().toLowerCase();

    if (resolvedTab !== activeTab) {
      startTabTransition(() => setActiveTab(resolvedTab));
      return;
    }

    if (currentRequestedTab !== canonicalTab) {
      const nextParams = new URLSearchParams(searchParams);
      if (canonicalTab) {
        nextParams.set('tab', canonicalTab);
      } else {
        nextParams.delete('tab');
      }
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeTab, requestedTab, resolveTabKey, searchParams, setSearchParams, startTabTransition]);

  useEffect(() => {
    if (!canUseInlineEnrollment && studentForm.link_enrollment) {
      setStudentForm((prev) => ({
        ...prev,
        link_enrollment: false,
        course_campus_id: '',
        period_id: '',
        enrollment_date: getTodayIsoDate(),
      }));
    }
  }, [canUseInlineEnrollment, studentForm.link_enrollment]);



  const filteredGuardians = useMemo(() => {
    const term = guardianSearch.trim().toLowerCase();

    return guardians.filter((guardian) => {
      const studentCount = Number(guardian.student_count || 0);
      const fullText = `${guardian.first_name} ${guardian.last_name} ${guardian.email || ''} ${guardian.phone || ''} ${guardian.document_number || ''}`.toLowerCase();

      const matchesText = !term || fullText.includes(term);
      const matchesLinkFilter =
        guardianLinkFilter === 'all' ||
        (guardianLinkFilter === 'yes' && studentCount > 0) ||
        (guardianLinkFilter === 'no' && studentCount === 0);

      return matchesText && matchesLinkFilter;
    });
  }, [guardians, guardianSearch, guardianLinkFilter]);

  const offeringOptions = useMemo(() => {
    const options = [];

    for (const course of courses) {
      for (const offering of course.offerings || []) {
        const modality = offering.modality || 'PRESENCIAL';
        const modalityLabel =
          modality === 'VIRTUAL' ? 'Virtual' : modality === 'HIBRIDO' ? 'Hibrido' : 'Presencial';
        const campusName = offering.campus_name || 'Sin sede';

        options.push({
          id: offering.offering_id,
          label: `${course.name} - ${campusName} (${modalityLabel})`,
        });
      }
    }

    return options;
  }, [courses]);



  const studentAgeLabel = useMemo(
    () => formatAgeLabel(calculateAgeFromBirthDate(studentForm.birth_date)),
    [studentForm.birth_date],
  );

  const submitStudent = async (event) => {
    event.preventDefault();
    if (!canManageStudents) return;

    setError('');
    setMessage('');

    try {
      const payload = {
        first_name: studentForm.first_name,
        last_name: studentForm.last_name,
        document_number: buildDocumentValue(studentForm.document_type, studentForm.document_number),
        birth_date: studentForm.birth_date,
        email: studentForm.email || null,
        phone: studentForm.phone || null,
        address: studentForm.address || null,
        notes: studentForm.notes.trim() || null,
      };

      const isEditing = Boolean(editingStudentId);

      if (!isEditing) {
        payload.no_guardian = Boolean(studentForm.no_guardian);

        if (!payload.no_guardian) {
          const guardianFirstName = studentForm.guardian_first_name.trim();
          const guardianLastName = studentForm.guardian_last_name.trim();
          const guardianEmail = studentForm.guardian_email.trim();
          const guardianPhone = studentForm.guardian_phone.trim();
          const guardianDocumentNumber = studentForm.guardian_document_number.trim();

          if (studentForm.guardian_id) {
            payload.guardian_links = [{ guardian_id: Number(studentForm.guardian_id), relationship: 'APODERADO' }];
          }

          const hasQuickGuardianData = Boolean(
            guardianFirstName ||
              guardianLastName ||
              guardianEmail ||
              guardianPhone ||
              guardianDocumentNumber,
          );

          if (hasQuickGuardianData) {
            if (!guardianFirstName || !guardianLastName) {
              setError('Para registrar un apoderado nuevo, ingresa al menos nombres y apellidos.');
              return;
            }

            payload.guardian_payload = {
              first_name: guardianFirstName,
              last_name: guardianLastName,
              email: guardianEmail || null,
              phone: guardianPhone || null,
              document_number: guardianDocumentNumber || null,
              relationship: 'APODERADO',
            };
          }

          if (!payload.guardian_links && !payload.guardian_payload) {
            setError('Debes seleccionar o registrar un apoderado, o marcar la opción "Sin apoderado".');
            return;
          }
        }

        if (studentForm.link_enrollment) {
          if (!studentForm.course_campus_id || !studentForm.period_id) {
            setError('Selecciona curso/sede y periodo para registrar la matricula.');
            return;
          }

          payload.enrollment = {
            course_campus_id: Number(studentForm.course_campus_id),
            period_id: Number(studentForm.period_id),
            enrollment_date: studentForm.enrollment_date || undefined,
            notes: studentForm.enrollment_notes.trim() || null,
          };
        }

        const createResponse = await api.post('/students', payload);
        const accessUser = createResponse.data?.item?.access_user || null;
        const hasGuardian = (createResponse.data?.item?.guardians || []).length > 0;
        if (accessUser?.email && accessUser?.initial_password) {
          setMessage(
            `Alumno creado${hasGuardian ? '' : ' sin apoderado'}. Usuario: ${accessUser.email} | Clave inicial: ${accessUser.initial_password}`,
          );
        } else {
          setMessage(`Alumno creado correctamente${hasGuardian ? '.' : ' sin apoderado.'}`);
        }
      } else {
        await api.put(`/students/${editingStudentId}`, payload);
        setMessage('Alumno actualizado correctamente.');
      }

      setStudentForm(getEmptyStudent());
      setShowStudentForm(false);
      setEditingStudentId(null);
      setStudentSearch('');
      await fetchStudents('');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo crear el alumno.');
    }
  };

  const startStudentCreate = () => {
    setStudentForm(getEmptyStudent());
    setEditingStudentId(null);
    setShowStudentForm((prev) => !prev);
  };

  const startStudentEdit = (student) => {
    setError('');
    setMessage('');
    const parsedDocument = parseDocumentValue(student.document_number);
    setEditingStudentId(student.id);
    setShowStudentForm(true);
    setStudentForm({
      first_name: student.first_name || '',
      last_name: student.last_name || '',
      document_type: parsedDocument.document_type,
      document_number: parsedDocument.document_number,
      birth_date: normalizeDateOnly(student.birth_date),
      email: student.email || '',
      phone: student.phone || '',
      address: student.address || '',
      notes: student.notes || '',
      no_guardian: false,
      guardian_id: '',
      guardian_first_name: '',
      guardian_last_name: '',
      guardian_email: '',
      guardian_phone: '',
      guardian_document_number: '',
      link_enrollment: false,
      course_campus_id: '',
      period_id: '',
      enrollment_date: getTodayIsoDate(),
      enrollment_notes: '',
    });
  };

  const deleteStudent = async (student) => {
    if (!canManageStudents) return;

    const confirmed = window.confirm(
      `Se eliminara al alumno ${student.first_name} ${student.last_name}. Esta accion no se puede deshacer.`,
    );
    if (!confirmed) return;

    setError('');
    setMessage('');

    try {
      await api.delete(`/students/${student.id}`);
      if (editingStudentId === student.id) {
        setEditingStudentId(null);
        setStudentForm(getEmptyStudent());
        setShowStudentForm(false);
      }
      setMessage('Alumno eliminado correctamente.');
      await fetchStudents(studentSearch);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo eliminar el alumno.');
    }
  };



  const submitGuardian = async (event) => {
    event.preventDefault();
    if (!canManageGuardians) return;

    setError('');
    setMessage('');

    try {
      await api.post('/guardians', {
        ...guardianForm,
        email: guardianForm.email || null,
        phone: guardianForm.phone || null,
        document_number: guardianForm.document_number || null,
      });

      setGuardianForm(emptyGuardian);
      setShowGuardianForm(false);
      setMessage('Apoderado creado correctamente.');
      await loadGuardians();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo crear el apoderado.');
    }
  };

  if (!canViewStudents && !canViewGuardians) {
    return (
      <section className="card">
        <h1 className="text-xl font-semibold">Alumnos y apoderados</h1>
        <p className="mt-2 text-sm text-primary-700">No tienes permisos para acceder a este modulo.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary-900">Alumnos y apoderados</h1>
          <p className="text-sm text-primary-700">Registro academico con vistas separadas por tarea.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-800">
            {students.length} alumnos
          </span>
          <span className="rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-800">
            {guardians.length} apoderados
          </span>
        </div>
      </div>

      <div className="page-tabs">
        {canViewStudents ? (
          <button
            type="button"
            onClick={() => changeTab('students')}
            className={`page-tab ${activeTab === 'students' ? 'page-tab-active' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                  activeTab === 'students' ? 'bg-white/20 text-white' : 'bg-primary-50 text-primary-600'
                }`}
              >
                <GraduationCap className="h-4 w-4" />
              </span>
              <span>Alumnos</span>
            </span>
          </button>
        ) : null}
        {canViewGuardians ? (
          <button
            type="button"
            onClick={() => changeTab('guardians')}
            className={`page-tab ${activeTab === 'guardians' ? 'page-tab-active' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                  activeTab === 'guardians' ? 'bg-white/20 text-white' : 'bg-primary-50 text-primary-600'
                }`}
              >
                <UsersRound className="h-4 w-4" />
              </span>
              <span>Apoderados</span>
            </span>
          </button>
        ) : null}
        {hasPermission(PERMISSIONS.STUDENTS_VIEW) && hasPermission(PERMISSIONS.ENROLLMENTS_MANAGE) ? (
          <button
            type="button"
            onClick={() => changeTab('transfers')}
            className={`page-tab ${activeTab === 'transfers' ? 'page-tab-active' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                  activeTab === 'transfers' ? 'bg-white/20 text-white' : 'bg-primary-50 text-primary-600'
                }`}
              >
                <ArrowLeftRight className="h-4 w-4" />
              </span>
              <span>Traslados</span>
            </span>
          </button>
        ) : null}
      </div>

      {activeTab !== 'transfers' && message ? (
        <p className="rounded-xl bg-primary-50 p-3 text-sm text-primary-800">{message}</p>
      ) : null}
      {activeTab !== 'transfers' && error ? (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : null}


      {activeTab === 'students' && canViewStudents ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-primary-700">Gestiona alumnos y sus vinculos con apoderados.</p>
              <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-800">
                {students.length} ultimos registros
              </span>
            </div>
            {canManageStudents ? (
              <button
                type="button"
                onClick={startStudentCreate}
                className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
              >
                {showStudentForm ? 'Cerrar formulario' : 'CREAR alumno'}
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="app-input w-full max-w-xl"
              placeholder="Buscar alumno por nombre, apellido, documento, correo, telefono o apoderado"
              value={studentSearch}
              onChange={(event) => {
                setStudentSearch(event.target.value);
              }}
            />
          </div>

          <p className="text-xs text-primary-600">
            Se muestran solo los 10 alumnos mas recientes.
          </p>

          {showStudentForm && canManageStudents ? (
            <form onSubmit={submitStudent} className="panel-soft space-y-3">
              <h2 className="text-lg font-semibold text-primary-900">
                {editingStudentId ? 'EDITAR alumno' : 'CREAR alumno'}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <input
                  className="app-input"
                  placeholder="Nombres"
                  value={studentForm.first_name}
                  onChange={(event) => setStudentForm((prev) => ({ ...prev, first_name: event.target.value }))}
                  required
                />
                <input
                  className="app-input"
                  placeholder="Apellidos"
                  value={studentForm.last_name}
                  onChange={(event) => setStudentForm((prev) => ({ ...prev, last_name: event.target.value }))}
                  required
                />
                <select
                  className="app-input"
                  value={studentForm.document_type}
                  onChange={(event) => setStudentForm((prev) => ({ ...prev, document_type: event.target.value }))}
                >
                  {DOCUMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  className="app-input"
                  placeholder="Numero de documento"
                  value={studentForm.document_number}
                  onChange={(event) => setStudentForm((prev) => ({ ...prev, document_number: event.target.value }))}
                  required
                />
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-primary-700">Fecha de nacimiento</span>
                  <input
                    type="date"
                    className="app-input"
                    value={studentForm.birth_date}
                    onChange={(event) => setStudentForm((prev) => ({ ...prev, birth_date: event.target.value }))}
                    required
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-primary-700">Edad</span>
                  <input
                    className="app-input"
                    value={studentAgeLabel}
                    placeholder="Se calcula automáticamente"
                    readOnly
                  />
                </label>
                <input
                  type="email"
                  className="app-input"
                  placeholder="Correo"
                  value={studentForm.email}
                  onChange={(event) => setStudentForm((prev) => ({ ...prev, email: event.target.value }))}
                />
                <input
                  className="app-input"
                  placeholder="Telefono"
                  value={studentForm.phone}
                  onChange={(event) => setStudentForm((prev) => ({ ...prev, phone: event.target.value }))}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  className="app-input"
                  placeholder="Direccion"
                  value={studentForm.address}
                  onChange={(event) => setStudentForm((prev) => ({ ...prev, address: event.target.value }))}
                />
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-primary-700">Nota del alumno (opcional)</span>
                  <textarea
                    className="app-input min-h-20 resize-y"
                    maxLength={500}
                    placeholder="Observaciones generales sobre el alumno"
                    value={studentForm.notes}
                    onChange={(event) => setStudentForm((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                </label>
              </div>

              {!editingStudentId ? (
                <div className="space-y-3 rounded-xl border border-primary-200 bg-white p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-primary-900">
                    <input
                      type="checkbox"
                      checked={studentForm.no_guardian}
                      onChange={(event) =>
                        setStudentForm((prev) => ({
                          ...prev,
                          no_guardian: event.target.checked,
                          guardian_id: event.target.checked ? '' : prev.guardian_id,
                          guardian_first_name: event.target.checked ? '' : prev.guardian_first_name,
                          guardian_last_name: event.target.checked ? '' : prev.guardian_last_name,
                          guardian_email: event.target.checked ? '' : prev.guardian_email,
                          guardian_phone: event.target.checked ? '' : prev.guardian_phone,
                          guardian_document_number: event.target.checked ? '' : prev.guardian_document_number,
                        }))
                      }
                    />
                    Registrar SIN apoderado
                  </label>

                  {!studentForm.no_guardian ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <select
                        className="app-input lg:col-span-3"
                        value={studentForm.guardian_id}
                        onChange={(event) => setStudentForm((prev) => ({ ...prev, guardian_id: event.target.value }))}
                      >
                        <option value="">Selecciona apoderado existente (opcional)</option>
                        {guardians.map((guardian) => (
                          <option key={guardian.id} value={guardian.id}>
                            {guardian.first_name} {guardian.last_name}
                          </option>
                        ))}
                      </select>

                      <input
                        className="app-input"
                        placeholder="Apoderado: nombres"
                        value={studentForm.guardian_first_name}
                        onChange={(event) =>
                          setStudentForm((prev) => ({ ...prev, guardian_first_name: event.target.value }))
                        }
                      />
                      <input
                        className="app-input"
                        placeholder="Apoderado: apellidos"
                        value={studentForm.guardian_last_name}
                        onChange={(event) =>
                          setStudentForm((prev) => ({ ...prev, guardian_last_name: event.target.value }))
                        }
                      />
                      <input
                        type="email"
                        className="app-input"
                        placeholder="Apoderado: correo (opcional)"
                        value={studentForm.guardian_email}
                        onChange={(event) => setStudentForm((prev) => ({ ...prev, guardian_email: event.target.value }))}
                      />
                      <input
                        className="app-input"
                        placeholder="Apoderado: telefono (opcional)"
                        value={studentForm.guardian_phone}
                        onChange={(event) => setStudentForm((prev) => ({ ...prev, guardian_phone: event.target.value }))}
                      />
                      <input
                        className="app-input"
                        placeholder="Apoderado: documento (opcional)"
                        value={studentForm.guardian_document_number}
                        onChange={(event) =>
                          setStudentForm((prev) => ({ ...prev, guardian_document_number: event.target.value }))
                        }
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-primary-700">El alumno se guardará como "Sin apoderado".</p>
                  )}
                </div>
              ) : null}

              {!editingStudentId ? (
                <div className="space-y-3 rounded-xl border border-primary-200 bg-white p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-primary-900">
                    <input
                      type="checkbox"
                      checked={studentForm.link_enrollment}
                      disabled={!canUseInlineEnrollment}
                      onChange={(event) =>
                        setStudentForm((prev) => ({
                          ...prev,
                          link_enrollment: event.target.checked,
                          course_campus_id: event.target.checked ? prev.course_campus_id : '',
                          period_id: event.target.checked ? prev.period_id : '',
                          enrollment_date: event.target.checked
                            ? prev.enrollment_date || getTodayIsoDate()
                            : getTodayIsoDate(),
                        }))
                      }
                    />
                    Vincular matricula al registrar alumno
                  </label>

                  {studentForm.link_enrollment ? (
                    canUseInlineEnrollment ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <select
                            className="app-input lg:col-span-2"
                            value={studentForm.course_campus_id}
                            onChange={(event) =>
                              setStudentForm((prev) => ({ ...prev, course_campus_id: event.target.value }))
                            }
                            required
                          >
                            <option value="">Seleccione curso/carrera y sede</option>
                            {offeringOptions.map((offering) => (
                              <option key={offering.id} value={offering.id}>
                                {offering.label}
                              </option>
                            ))}
                          </select>

                          <select
                            className="app-input"
                            value={studentForm.period_id}
                            onChange={(event) =>
                              setStudentForm((prev) => ({ ...prev, period_id: event.target.value }))
                            }
                            required
                          >
                            <option value="">Seleccione periodo</option>
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
                              value={studentForm.enrollment_date}
                              onChange={(event) =>
                                setStudentForm((prev) => ({ ...prev, enrollment_date: event.target.value }))
                              }
                            />
                          </label>
                        </div>
                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-primary-700">
                            Nota de matrícula (opcional)
                          </span>
                          <textarea
                            className="app-input min-h-20 resize-y"
                            maxLength={500}
                            placeholder="Observaciones administrativas de esta matrícula"
                            value={studentForm.enrollment_notes}
                            onChange={(event) =>
                              setStudentForm((prev) => ({ ...prev, enrollment_notes: event.target.value }))
                            }
                          />
                        </label>
                        <p className="text-xs text-primary-600">
                          La fecha de matrícula es el día en que se registra la inscripción del alumno.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-primary-700">
                        Tu usuario no tiene permisos suficientes para crear matriculas desde este formulario.
                      </p>
                    )
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
                >
                  {editingStudentId ? 'Guardar cambios' : 'Guardar alumno'}
                </button>
                {editingStudentId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingStudentId(null);
                      setStudentForm(getEmptyStudent());
                      setShowStudentForm(false);
                    }}
                    className="rounded-xl border border-primary-300 bg-white px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
                  >
                    Cancelar edicion
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}

          <article className="card overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-primary-600">
                  <th className="pb-2 pr-3">Alumno</th>
                  <th className="pb-2 pr-3">Tipo doc.</th>
                  <th className="pb-2 pr-3">Nro. doc.</th>
                  <th className="pb-2 pr-3">Contacto</th>
                  <th className="pb-2 pr-3">Sede asignada</th>
                  <th className="pb-2 pr-3">Registrado por</th>
                  <th className="pb-2 pr-3">Apoderados</th>
                  <th className="pb-2 pr-3">Nota</th>
                  {showStudentActions ? <th className="pb-2">Acciones</th> : null}
                </tr>
              </thead>
              <tbody>
                {students.map((student) => {
                  const parsedDocument = parseDocumentValue(student.document_number);
                  return (
                  <tr key={student.id} className="border-t border-primary-100">
                    <td className="py-2 pr-3 font-medium">
                      {student.first_name} {student.last_name}
                    </td>
                    <td className="py-2 pr-3">{parsedDocument.document_type}</td>
                    <td className="py-2 pr-3">{parsedDocument.document_number || '-'}</td>
                    <td className="py-2 pr-3">{student.email || student.phone || '-'}</td>
                    <td className="py-2 pr-3">
                      <div>{student.assigned_campus_name || '-'}</div>
                      {student.assigned_enrollment_status &&
                      student.assigned_enrollment_status !== 'ACTIVE' ? (
                        <div className="text-xs text-primary-500">
                          Matricula {String(student.assigned_enrollment_status).toLowerCase()}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{student.created_by_name || '-'}</td>
                    <td className="py-2 pr-3">
                      {student.guardians?.length
                        ? student.guardians.map((guardian) => guardian.name).join(', ')
                        : 'Sin apoderado'}
                    </td>
                    <td className="max-w-56 py-2 pr-3 text-primary-700">
                      <span className="block truncate" title={student.notes || ''}>
                        {student.notes || '-'}
                      </span>
                    </td>
                    {showStudentActions ? (
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          {canManageStudents ? (
                            <button
                              type="button"
                              onClick={() => startStudentEdit(student)}
                              className="rounded-lg border border-primary-300 bg-white px-2 py-1 text-xs font-semibold text-primary-800 hover:bg-primary-50"
                            >
                              EDITAR
                            </button>
                          ) : null}
                          {canManageStudents ? (
                            <button
                              type="button"
                              onClick={() => deleteStudent(student)}
                              className="rounded-lg border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                            >
                              ELIMINAR
                            </button>
                          ) : null}
                          {canManageTransfers ? (
                            <button
                              type="button"
                              onClick={() => openTransferRequest(student)}
                              className="rounded-lg border border-accent-300 bg-white px-2 py-1 text-xs font-semibold text-accent-800 hover:bg-accent-50"
                            >
                              TRASLADO
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                  );
                })}
                {!studentLoading && students.length === 0 ? (
                  <tr>
                    <td colSpan={showStudentActions ? 9 : 8} className="py-4 text-center text-sm text-primary-600">
                      No se encontraron alumnos con ese criterio.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </article>
        </div>
      ) : null}

      {activeTab === 'transfers' ? <TransfersManager title="Gestión de Traslados" /> : null}

      {activeTab === 'guardians' && canViewGuardians ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <input
                className="app-input w-72"
                placeholder="Buscar por nombre, correo, telefono o documento"
                value={guardianSearch}
                onChange={(event) => setGuardianSearch(event.target.value)}
              />
              <select
                className="app-input w-56"
                value={guardianLinkFilter}
                onChange={(event) => setGuardianLinkFilter(event.target.value)}
              >
                <option value="all">Todos</option>
                <option value="yes">Con alumnos vinculados</option>
                <option value="no">Sin alumnos vinculados</option>
              </select>
            </div>

            {canManageGuardians ? (
              <button
                type="button"
                onClick={() => setShowGuardianForm((value) => !value)}
                className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
              >
                {showGuardianForm ? 'Cerrar formulario' : 'Nuevo apoderado'}
              </button>
            ) : null}
          </div>

          {showGuardianForm && canManageGuardians ? (
            <form onSubmit={submitGuardian} className="panel-soft space-y-3">
              <h2 className="text-lg font-semibold text-primary-900">Registrar apoderado</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <input
                  className="app-input"
                  placeholder="Nombres"
                  value={guardianForm.first_name}
                  onChange={(event) => setGuardianForm((prev) => ({ ...prev, first_name: event.target.value }))}
                  required
                />
                <input
                  className="app-input"
                  placeholder="Apellidos"
                  value={guardianForm.last_name}
                  onChange={(event) => setGuardianForm((prev) => ({ ...prev, last_name: event.target.value }))}
                  required
                />
                <input
                  className="app-input"
                  placeholder="Documento"
                  value={guardianForm.document_number}
                  onChange={(event) => setGuardianForm((prev) => ({ ...prev, document_number: event.target.value }))}
                />
                <input
                  type="email"
                  className="app-input"
                  placeholder="Correo"
                  value={guardianForm.email}
                  onChange={(event) => setGuardianForm((prev) => ({ ...prev, email: event.target.value }))}
                />
                <input
                  className="app-input"
                  placeholder="Telefono"
                  value={guardianForm.phone}
                  onChange={(event) => setGuardianForm((prev) => ({ ...prev, phone: event.target.value }))}
                />
              </div>

              <button
                type="submit"
                className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
              >
                Guardar apoderado
              </button>
            </form>
          ) : null}

          <article className="card overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-primary-600">
                  <th className="pb-2 pr-3">Apoderado</th>
                  <th className="pb-2 pr-3">Contacto</th>
                  <th className="pb-2 pr-3">Documento</th>
                  <th className="pb-2">Alumnos vinculados</th>
                </tr>
              </thead>
              <tbody>
                {filteredGuardians.map((guardian) => (
                  <tr key={guardian.id} className="border-t border-primary-100">
                    <td className="py-2 pr-3 font-medium">
                      {guardian.first_name} {guardian.last_name}
                    </td>
                    <td className="py-2 pr-3">{guardian.email || guardian.phone || '-'}</td>
                    <td className="py-2 pr-3">{guardian.document_number || '-'}</td>
                    <td className="py-2">{Number(guardian.student_count || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </div>
      ) : null}
    </section>
  );
}
