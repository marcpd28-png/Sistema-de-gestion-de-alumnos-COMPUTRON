import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Navigate } from 'react-router-dom';
import { BriefcaseBusiness, ClipboardCheck } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../constants/permissions';
import { buildDocumentValue, DOCUMENT_TYPE_OPTIONS, parseDocumentValue } from '../utils/document';

const teacherDefaults = {
  first_name: '',
  last_name: '',
  document_type: 'DNI',
  document_number: '',
  phone: '',
  address: '',
  email: '',
  password: '',
  base_campus_id: '',
  use_email_as_password: false,
  create_initial_assignment: false,
  assignment_campus_id: '',
  assignment_course_campus_id: '',
  assignment_period_id: '',
  assignment_schedule_info: '',
  assignment_campus_override_reason: '',
};

const assignmentDefaults = {
  teacher_user_id: '',
  course_campus_id: '',
  period_id: '',
  schedule_info: '',
  campus_override_reason: '',
};

const baseCampusDefaults = {
  teacher_user_id: '',
  base_campus_id: '',
  reason: '',
};

const normalizeOptional = (value) => {
  const trimmed = String(value || '').trim();
  return trimmed || null;
};

const getScheduleBlocks = (scheduleInfo) =>
  String(scheduleInfo || '')
    .split('|')
    .map((block) => block.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

const getDefaultScheduleInfoFromBlocks = (scheduleBlocks = []) =>
  scheduleBlocks.length === 1 ? scheduleBlocks[0] : '';

export default function TeachersPage() {
  const { user, hasPermission } = useAuth();
  const userRoles = user?.roles || [];
  const assignedCampusIds = user?.campus_ids || (user?.base_campus_id ? [user.base_campus_id] : []);
  const isRootAdminProfile = userRoles.includes('ADMIN') && assignedCampusIds.length === 0;
  const canViewTeachers = hasPermission(PERMISSIONS.TEACHERS_VIEW);
  const canViewAssignments = hasPermission(PERMISSIONS.TEACHERS_ASSIGNMENTS_VIEW);
  const canManageAssignments = hasPermission(PERMISSIONS.TEACHERS_ASSIGNMENTS_MANAGE);
  const canCreateUsers = hasPermission(PERMISSIONS.USERS_CREATE);
  const canManageTeacherProfile = hasPermission(PERMISSIONS.USERS_STATUS_MANAGE);
  const canViewCampuses = hasPermission(PERMISSIONS.CAMPUSES_VIEW);
  const defaultTeacherCampusId = !isRootAdminProfile && user?.base_campus_id ? String(user.base_campus_id) : '';
  const canSelectTeacherCampus = Boolean(isRootAdminProfile && canViewCampuses);
  const isDocenteProfile =
    (user?.roles || []).length === 1 && (user?.roles || []).includes('DOCENTE');
  const createTeacherFormDefaults = () => ({
    ...teacherDefaults,
    base_campus_id: defaultTeacherCampusId,
    create_initial_assignment: Boolean(canManageAssignments),
    assignment_campus_id: defaultTeacherCampusId,
  });
  const [teachers, setTeachers] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [courses, setCourses] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [teacherForm, setTeacherForm] = useState(createTeacherFormDefaults);
  const [editingTeacherId, setEditingTeacherId] = useState(null);
  const [assignmentForm, setAssignmentForm] = useState(assignmentDefaults);
  const [baseCampusForm, setBaseCampusForm] = useState(baseCampusDefaults);
  const [activeTab, setActiveTab] = useState('assignments');
  const [, startTabTransition] = useTransition();
  const [showTeacherForm, setShowTeacherForm] = useState(false);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [showBaseCampusForm, setShowBaseCampusForm] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const changeTab = (nextTab) => {
    startTabTransition(() => setActiveTab(nextTab));
  };

  const loadData = useCallback(async () => {
    try {
      const scopeConfig = canSelectTeacherCampus ? { _skipCampusScope: true } : {};
      const [teachersRes, campusesRes, coursesRes, periodsRes, assignmentsRes] = await Promise.all([
        canViewTeachers ? api.get('/teachers', scopeConfig) : Promise.resolve(null),
        canViewCampuses ? api.get('/campuses', scopeConfig) : Promise.resolve(null),
        canManageAssignments ? api.get('/courses', scopeConfig) : Promise.resolve(null),
        canManageAssignments ? api.get('/catalogs/periods') : Promise.resolve(null),
        canViewAssignments ? api.get('/teachers/assignments', scopeConfig) : Promise.resolve(null),
      ]);

      setTeachers(teachersRes?.data?.items || []);
      setCampuses(campusesRes?.data?.items || []);
      setCourses(coursesRes?.data?.items || []);
      setPeriods(periodsRes?.data?.items || []);
      setAssignments(assignmentsRes?.data?.items || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo cargar el modulo de docentes.');
    }
  }, [canManageAssignments, canSelectTeacherCampus, canViewAssignments, canViewCampuses, canViewTeachers]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (activeTab === 'assignments' && !canViewAssignments && (canViewTeachers || canCreateUsers || canManageTeacherProfile)) {
      setActiveTab('teachers');
    }

    if (activeTab === 'teachers' && !canViewTeachers && !canCreateUsers && !canManageTeacherProfile && canViewAssignments) {
      setActiveTab('assignments');
    }
  }, [activeTab, canCreateUsers, canManageTeacherProfile, canViewAssignments, canViewTeachers]);

  const offerings = useMemo(() => {
    const rows = [];
    for (const course of courses) {
      for (const offering of course.offerings || []) {
        rows.push({
          id: offering.offering_id,
          campus_id: offering.campus_id,
          campus_name: offering.campus_name || 'Sin sede',
          course_name: course.name || '',
          modality: offering.modality || 'PRESENCIAL',
          schedule_info: offering.schedule_info || '',
          schedule_blocks: getScheduleBlocks(offering.schedule_info),
          label: `${course.name} - ${offering.campus_name} (${offering.modality || 'PRESENCIAL'})`,
        });
      }
    }
    return rows;
  }, [courses]);

  const defaultPeriodId = useMemo(() => {
    const activePeriod = periods.find((period) => period.is_active) || periods[0];
    return activePeriod ? String(activePeriod.id) : '';
  }, [periods]);

  const teacherAssignmentCampusOptions = useMemo(() => {
    const campusMap = new Map();

    for (const campus of campuses) {
      const campusId = Number(campus.id || 0);
      if (!campusId || campusMap.has(campusId)) continue;
      campusMap.set(campusId, campus.name || `Sede #${campusId}`);
    }

    for (const offering of offerings) {
      const campusId = Number(offering.campus_id || 0);
      if (!campusId || campusMap.has(campusId)) continue;
      campusMap.set(campusId, offering.campus_name || `Sede #${campusId}`);
    }

    return Array.from(campusMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => String(left.name).localeCompare(String(right.name), 'es', { sensitivity: 'base' }));
  }, [campuses, offerings]);

  const selectedAssignmentTeacher = useMemo(() => {
    return teachers.find((teacher) => String(teacher.id) === String(assignmentForm.teacher_user_id)) || null;
  }, [assignmentForm.teacher_user_id, teachers]);

  const selectedAssignmentOffering = useMemo(() => {
    return offerings.find((offering) => String(offering.id) === String(assignmentForm.course_campus_id)) || null;
  }, [assignmentForm.course_campus_id, offerings]);

  const selectedAssignmentScheduleBlocks = selectedAssignmentOffering?.schedule_blocks || [];

  const assignmentRequiresCampusOverrideReason =
    Boolean(selectedAssignmentTeacher?.base_campus_id) &&
    Boolean(selectedAssignmentOffering?.campus_id) &&
    Number(selectedAssignmentTeacher.base_campus_id) !== Number(selectedAssignmentOffering.campus_id);

  const shouldShowTeacherCampusField = canSelectTeacherCampus || Boolean(teacherForm.base_campus_id);
  const teacherCampusDisplayName = useMemo(() => {
    const currentCampusId = String(teacherForm.base_campus_id || '');
    if (!currentCampusId) return 'Sin sede base asignada';

    const matchedCampus = campuses.find((campus) => String(campus.id) === currentCampusId);
    if (matchedCampus?.name) return matchedCampus.name;
    if (currentCampusId === String(defaultTeacherCampusId || '')) return 'Sede del usuario actual';
    return `Sede #${currentCampusId}`;
  }, [campuses, defaultTeacherCampusId, teacherForm.base_campus_id]);

  const effectiveTeacherAssignmentCampusId = canSelectTeacherCampus
    ? String(teacherForm.assignment_campus_id || '')
    : String(teacherForm.assignment_campus_id || teacherForm.base_campus_id || defaultTeacherCampusId || '');

  const filteredTeacherAssignmentOfferings = useMemo(() => {
    if (!effectiveTeacherAssignmentCampusId) {
      return canSelectTeacherCampus ? [] : offerings;
    }

    return offerings.filter((offering) => String(offering.campus_id) === String(effectiveTeacherAssignmentCampusId));
  }, [canSelectTeacherCampus, effectiveTeacherAssignmentCampusId, offerings]);

  const selectedTeacherInitialOffering = useMemo(
    () =>
      filteredTeacherAssignmentOfferings.find(
        (offering) => String(offering.id) === String(teacherForm.assignment_course_campus_id),
      ) || null,
    [filteredTeacherAssignmentOfferings, teacherForm.assignment_course_campus_id],
  );

  const selectedTeacherInitialScheduleBlocks = selectedTeacherInitialOffering?.schedule_blocks || [];

  const teacherInitialAssignmentRequiresCampusOverrideReason =
    Boolean(teacherForm.base_campus_id) &&
    Boolean(selectedTeacherInitialOffering?.campus_id) &&
    Number(teacherForm.base_campus_id) !== Number(selectedTeacherInitialOffering.campus_id);

  useEffect(() => {
    if (!showTeacherForm || editingTeacherId || !canManageAssignments) return;

    const nextCampusId = teacherForm.base_campus_id || defaultTeacherCampusId;
    const nextPeriodId = defaultPeriodId;

    if (!nextCampusId && !nextPeriodId) return;

    setTeacherForm((prev) => {
      let changed = false;
      const next = { ...prev };

      if (!next.assignment_campus_id && nextCampusId) {
        next.assignment_campus_id = nextCampusId;
        changed = true;
      }

      if (!next.assignment_period_id && nextPeriodId) {
        next.assignment_period_id = nextPeriodId;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [canManageAssignments, defaultPeriodId, defaultTeacherCampusId, editingTeacherId, showTeacherForm, teacherForm.base_campus_id]);

  useEffect(() => {
    if (!teacherForm.assignment_course_campus_id) return;
    if (
      filteredTeacherAssignmentOfferings.some(
        (offering) => String(offering.id) === String(teacherForm.assignment_course_campus_id),
      )
    ) {
      return;
    }

    setTeacherForm((prev) => ({
      ...prev,
      assignment_course_campus_id: '',
      assignment_schedule_info: '',
      assignment_campus_override_reason: '',
    }));
  }, [filteredTeacherAssignmentOfferings, teacherForm.assignment_course_campus_id]);

  useEffect(() => {
    if (!showTeacherForm || editingTeacherId || !canManageAssignments || !teacherForm.create_initial_assignment) return;

    setTeacherForm((prev) => {
      if (!prev.assignment_course_campus_id) {
        return prev.assignment_schedule_info ? { ...prev, assignment_schedule_info: '' } : prev;
      }

      const selectedOffering = filteredTeacherAssignmentOfferings.find(
        (offering) => String(offering.id) === String(prev.assignment_course_campus_id),
      );
      const scheduleBlocks = selectedOffering?.schedule_blocks || [];

      if (scheduleBlocks.length === 0) {
        return prev.assignment_schedule_info ? { ...prev, assignment_schedule_info: '' } : prev;
      }

      if (prev.assignment_schedule_info && scheduleBlocks.includes(prev.assignment_schedule_info)) {
        return prev;
      }

      const defaultScheduleInfo = getDefaultScheduleInfoFromBlocks(scheduleBlocks);
      return prev.assignment_schedule_info === defaultScheduleInfo
        ? prev
        : { ...prev, assignment_schedule_info: defaultScheduleInfo };
    });
  }, [
    canManageAssignments,
    editingTeacherId,
    filteredTeacherAssignmentOfferings,
    showTeacherForm,
    teacherForm.assignment_course_campus_id,
    teacherForm.create_initial_assignment,
  ]);

  useEffect(() => {
    setAssignmentForm((prev) => {
      if (!prev.course_campus_id) {
        return prev.schedule_info ? { ...prev, schedule_info: '' } : prev;
      }

      const selectedOffering = offerings.find((offering) => String(offering.id) === String(prev.course_campus_id));
      const scheduleBlocks = selectedOffering?.schedule_blocks || [];

      if (scheduleBlocks.length === 0) {
        return prev.schedule_info ? { ...prev, schedule_info: '' } : prev;
      }

      if (prev.schedule_info && scheduleBlocks.includes(prev.schedule_info)) {
        return prev;
      }

      const defaultScheduleInfo = getDefaultScheduleInfoFromBlocks(scheduleBlocks);
      return prev.schedule_info === defaultScheduleInfo ? prev : { ...prev, schedule_info: defaultScheduleInfo };
    });
  }, [assignmentForm.course_campus_id, offerings]);

  useEffect(() => {
    if (teacherInitialAssignmentRequiresCampusOverrideReason || !teacherForm.assignment_campus_override_reason) return;
    setTeacherForm((prev) => ({ ...prev, assignment_campus_override_reason: '' }));
  }, [teacherForm.assignment_campus_override_reason, teacherInitialAssignmentRequiresCampusOverrideReason]);

  const submitTeacher = async (event) => {
    event.preventDefault();
    if (!canCreateUsers && !canManageTeacherProfile) return;

    setMessage('');
    setError('');

    const normalizedEmail = teacherForm.email.trim().toLowerCase();
    const useEmailAsPassword = !editingTeacherId && Boolean(teacherForm.use_email_as_password);
    const resolvedPassword = useEmailAsPassword ? normalizedEmail : teacherForm.password;
    const shouldCreateInitialAssignment =
      !editingTeacherId && canManageAssignments && Boolean(teacherForm.create_initial_assignment);

    if (useEmailAsPassword && normalizedEmail.length < 8) {
      setError('El correo debe tener al menos 8 caracteres para usarlo como contraseña temporal.');
      return;
    }

    if (!editingTeacherId && !useEmailAsPassword && teacherForm.password.trim().length < 8) {
      setError('La contraseña del docente debe tener al menos 8 caracteres.');
      return;
    }

    if (shouldCreateInitialAssignment) {
      if (!effectiveTeacherAssignmentCampusId) {
        setError('Selecciona la sede donde el docente dictará su curso inicial.');
        return;
      }

      if (!teacherForm.assignment_course_campus_id) {
        setError('Selecciona el curso que dictará el docente.');
        return;
      }

      if (!teacherForm.assignment_period_id) {
        setError('Selecciona el periodo académico de la asignación inicial.');
        return;
      }

      if (selectedTeacherInitialScheduleBlocks.length > 1 && !teacherForm.assignment_schedule_info) {
        setError('Selecciona el bloque horario que dictará el docente.');
        return;
      }

      if (
        teacherInitialAssignmentRequiresCampusOverrideReason &&
        !teacherForm.assignment_campus_override_reason.trim()
      ) {
        setError('Indica el motivo si el curso inicial se dictará en una sede distinta a la sede base del docente.');
        return;
      }
    }

    try {
      const nextBaseCampusId = teacherForm.base_campus_id ? Number(teacherForm.base_campus_id) : null;

      if (editingTeacherId) {
        const payload = {
          first_name: teacherForm.first_name.trim(),
          last_name: teacherForm.last_name.trim(),
          document_number: buildDocumentValue(teacherForm.document_type, teacherForm.document_number),
          phone: normalizeOptional(teacherForm.phone),
          address: normalizeOptional(teacherForm.address),
          email: teacherForm.email.trim().toLowerCase(),
        };

        if (teacherForm.password.trim()) {
          payload.password = teacherForm.password;
        }

        await api.patch(`/teachers/${editingTeacherId}`, payload);

        const currentTeacher = teachers.find((teacher) => String(teacher.id) === String(editingTeacherId));
        const currentBaseCampusId = currentTeacher?.base_campus_id || null;
        if (canManageAssignments && String(currentBaseCampusId || '') !== String(nextBaseCampusId || '')) {
          await api.patch(`/teachers/${editingTeacherId}/base-campus`, {
            base_campus_id: nextBaseCampusId,
            reason: null,
          });
        }
      } else {
        await api.post('/auth/register', {
          first_name: teacherForm.first_name.trim(),
          last_name: teacherForm.last_name.trim(),
          document_number: buildDocumentValue(teacherForm.document_type, teacherForm.document_number),
          phone: normalizeOptional(teacherForm.phone),
          address: normalizeOptional(teacherForm.address),
          email: normalizedEmail,
          password: resolvedPassword,
          roles: ['DOCENTE'],
          base_campus_id: nextBaseCampusId,
          must_change_password: useEmailAsPassword,
          ...(shouldCreateInitialAssignment
            ? {
                teacher_assignment: {
                  course_campus_id: Number(teacherForm.assignment_course_campus_id),
                  period_id: Number(teacherForm.assignment_period_id),
                  schedule_info: normalizeOptional(teacherForm.assignment_schedule_info),
                  campus_override_reason: teacherInitialAssignmentRequiresCampusOverrideReason
                    ? teacherForm.assignment_campus_override_reason.trim()
                    : null,
                },
              }
            : {}),
        });
      }

      setTeacherForm(createTeacherFormDefaults());
      setEditingTeacherId(null);
      setShowTeacherForm(false);
      setMessage(
        editingTeacherId
          ? 'Docente actualizado correctamente.'
          : shouldCreateInitialAssignment
            ? 'Docente y asignación inicial guardados correctamente.'
            : 'Docente creado correctamente.',
      );
      await loadData();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          (editingTeacherId ? 'No se pudo actualizar el docente.' : 'No se pudo crear el docente.'),
      );
    }
  };

  const beginEditTeacher = (teacher) => {
    if (!canManageTeacherProfile) return;
    const parsedDocument = parseDocumentValue(teacher.document_number);
    setTeacherForm({
      first_name: teacher.first_name || '',
      last_name: teacher.last_name || '',
      document_type: parsedDocument.document_type,
      document_number: parsedDocument.document_number,
      phone: teacher.phone || '',
      address: teacher.address || '',
      email: teacher.email || '',
      password: '',
      base_campus_id: teacher.base_campus_id ? String(teacher.base_campus_id) : '',
      use_email_as_password: false,
      create_initial_assignment: false,
      assignment_campus_id: teacher.base_campus_id ? String(teacher.base_campus_id) : '',
      assignment_course_campus_id: '',
      assignment_period_id: defaultPeriodId,
      assignment_schedule_info: '',
      assignment_campus_override_reason: '',
    });
    setEditingTeacherId(teacher.id);
    setShowTeacherForm(true);
  };

  const resetTeacherEditor = () => {
    setTeacherForm(createTeacherFormDefaults());
    setEditingTeacherId(null);
    setShowTeacherForm(false);
  };

  const submitAssignment = async (event) => {
    event.preventDefault();
    if (!canManageAssignments) return;

    setMessage('');
    setError('');

    if (assignmentRequiresCampusOverrideReason && !assignmentForm.campus_override_reason.trim()) {
      setError('Indica el motivo del cambio manual de sede para este docente.');
      return;
    }

    if (selectedAssignmentScheduleBlocks.length > 1 && !assignmentForm.schedule_info) {
      setError('Selecciona el bloque horario para esta asignación.');
      return;
    }

    try {
      await api.post('/teachers/assignments', {
        teacher_user_id: Number(assignmentForm.teacher_user_id),
        course_campus_id: Number(assignmentForm.course_campus_id),
        period_id: Number(assignmentForm.period_id),
        schedule_info: assignmentForm.schedule_info || null,
        campus_override_reason: assignmentRequiresCampusOverrideReason
          ? assignmentForm.campus_override_reason.trim()
          : undefined,
        status: 'ACTIVE',
      });

      setAssignmentForm(assignmentDefaults);
      setShowAssignmentForm(false);
      setMessage('Asignacion docente guardada.');
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo asignar el docente al curso.');
    }
  };

  const submitBaseCampus = async (event) => {
    event.preventDefault();
    if (!canManageAssignments) return;

    setMessage('');
    setError('');

    if (!baseCampusForm.teacher_user_id) {
      setError('Selecciona un docente para configurar la sede base.');
      return;
    }

    try {
      await api.patch(`/teachers/${baseCampusForm.teacher_user_id}/base-campus`, {
        base_campus_id: baseCampusForm.base_campus_id ? Number(baseCampusForm.base_campus_id) : null,
        reason: baseCampusForm.reason || null,
      });

      setBaseCampusForm(baseCampusDefaults);
      setShowBaseCampusForm(false);
      setMessage('Sede base del docente actualizada.');
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo actualizar la sede base del docente.');
    }
  };

  const toggleAssignmentStatus = async (assignment) => {
    if (!canManageAssignments) return;

    setMessage('');
    setError('');

    try {
      await api.patch(`/teachers/assignments/${assignment.id}`, {
        status: assignment.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      });
      setMessage('Estado de asignacion actualizado.');
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo actualizar la asignacion.');
    }
  };

  if (isDocenteProfile) {
    return <Navigate to="/courses" replace />;
  }

  if (!canViewTeachers && !canViewAssignments && !canCreateUsers && !canManageTeacherProfile) {
    return (
      <section className="card">
        <h1 className="text-xl font-semibold">Docentes</h1>
        <p className="mt-2 text-sm text-primary-700">No tienes permisos para acceder a este modulo.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary-900">Docentes y carga academica</h1>
          <p className="text-sm text-primary-700">
            Registra docentes y, si quieres, deja lista su primera asignación académica en el mismo formulario.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-800">
            {teachers.length} docentes
          </span>
          <span className="rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-800">
            {assignments.length} asignaciones
          </span>
        </div>
      </div>

      <div className="page-tabs">
        {canViewAssignments || canManageAssignments ? (
          <button
            type="button"
            onClick={() => changeTab('assignments')}
            className={`page-tab ${activeTab === 'assignments' ? 'page-tab-active' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                  activeTab === 'assignments' ? 'bg-white/20 text-white' : 'bg-primary-50 text-primary-600'
                }`}
              >
                <ClipboardCheck className="h-4 w-4" />
              </span>
              <span>Asignaciones</span>
            </span>
          </button>
        ) : null}
        {canViewTeachers || canCreateUsers || canManageTeacherProfile ? (
          <button
            type="button"
            onClick={() => changeTab('teachers')}
            className={`page-tab ${activeTab === 'teachers' ? 'page-tab-active' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                  activeTab === 'teachers' ? 'bg-white/20 text-white' : 'bg-primary-50 text-primary-600'
                }`}
              >
                <BriefcaseBusiness className="h-4 w-4" />
              </span>
              <span>Docentes</span>
            </span>
          </button>
        ) : null}
      </div>

      {message ? <p className="rounded-xl bg-primary-50 p-3 text-sm text-primary-800">{message}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {activeTab === 'assignments' && (canViewAssignments || canManageAssignments) ? (
        <div className="space-y-4">
          {canManageAssignments ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowAssignmentForm((value) => !value)}
                className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
              >
                {showAssignmentForm ? 'Cerrar formulario' : 'Nueva asignacion'}
              </button>
            </div>
          ) : null}

          {showAssignmentForm && canManageAssignments ? (
            <form onSubmit={submitAssignment} className="panel-soft space-y-3">
              <h2 className="text-lg font-semibold text-primary-900">Asignar docente a curso</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <select
                  className="app-input"
                  value={assignmentForm.teacher_user_id}
                  onChange={(event) =>
                    setAssignmentForm((prev) => ({
                      ...prev,
                      teacher_user_id: event.target.value,
                      campus_override_reason: '',
                    }))
                  }
                  required
                >
                  <option value="">Docente</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.first_name} {teacher.last_name}
                    </option>
                  ))}
                </select>

                <select
                  className="app-input"
                  value={assignmentForm.course_campus_id}
                  onChange={(event) =>
                    setAssignmentForm((prev) => ({
                      ...prev,
                      course_campus_id: event.target.value,
                      schedule_info: getDefaultScheduleInfoFromBlocks(
                        offerings.find((offering) => String(offering.id) === String(event.target.value))
                          ?.schedule_blocks || [],
                      ),
                      campus_override_reason: '',
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
                  value={assignmentForm.period_id}
                  onChange={(event) => setAssignmentForm((prev) => ({ ...prev, period_id: event.target.value }))}
                  required
                >
                  <option value="">Periodo academico</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.name}
                    </option>
                  ))}
                </select>

                {selectedAssignmentTeacher?.base_campus_name ? (
                  <p className="rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-700 sm:col-span-2 lg:col-span-4">
                    Sede base del docente: <strong>{selectedAssignmentTeacher.base_campus_name}</strong>.
                  </p>
                ) : selectedAssignmentTeacher ? (
                  <p className="rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-700 sm:col-span-2 lg:col-span-4">
                    Este docente no tiene sede base configurada.
                  </p>
                ) : null}

                {assignmentRequiresCampusOverrideReason ? (
                  <input
                    className="app-input sm:col-span-2 lg:col-span-4"
                    placeholder="Motivo del cambio manual de sede (obligatorio)"
                    value={assignmentForm.campus_override_reason}
                    onChange={(event) =>
                      setAssignmentForm((prev) => ({ ...prev, campus_override_reason: event.target.value }))
                    }
                    required
                  />
                ) : null}

                <select
                  className="app-input"
                  value={assignmentForm.schedule_info}
                  onChange={(event) => setAssignmentForm((prev) => ({ ...prev, schedule_info: event.target.value }))}
                  disabled={!assignmentForm.course_campus_id || selectedAssignmentScheduleBlocks.length === 0}
                  required={selectedAssignmentScheduleBlocks.length > 1}
                >
                  <option value="">
                    {!assignmentForm.course_campus_id
                      ? 'Elige curso primero'
                      : selectedAssignmentScheduleBlocks.length === 0
                        ? 'Sin bloques registrados'
                        : 'Bloque horario'}
                  </option>
                  {selectedAssignmentScheduleBlocks.map((block, index) => (
                    <option key={`${block}-${index}`} value={block}>
                      Bloque #{index + 1}: {block}
                    </option>
                  ))}
                </select>
              </div>

              <button className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700">
                Guardar asignacion
              </button>
            </form>
          ) : null}

          {canViewAssignments ? (
            <article className="card overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-primary-600">
                    <th className="pb-2 pr-3">Docente</th>
                    <th className="pb-2 pr-3">Curso</th>
                    <th className="pb-2 pr-3">Sede</th>
                    <th className="pb-2 pr-3">Periodo</th>
                    <th className="pb-2 pr-3">Horario</th>
                    <th className="pb-2 pr-3">Override sede</th>
                    <th className="pb-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((assignment) => (
                    <tr key={assignment.id} className="border-t border-primary-100">
                      <td className="py-2 pr-3 font-medium">{assignment.teacher_name}</td>
                      <td className="py-2 pr-3">{assignment.course_name}</td>
                      <td className="py-2 pr-3">{assignment.campus_name}</td>
                      <td className="py-2 pr-3">{assignment.period_name}</td>
                      <td className="py-2 pr-3">{assignment.schedule_info || '-'}</td>
                      <td className="py-2 pr-3">{assignment.campus_override_reason || '-'}</td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => toggleAssignmentStatus(assignment)}
                          disabled={!canManageAssignments}
                          className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                            assignment.status === 'ACTIVE'
                              ? 'bg-primary-100 text-primary-800'
                              : 'bg-red-100 text-red-700'
                          } ${!canManageAssignments ? 'cursor-not-allowed opacity-60' : ''}`}
                        >
                          {assignment.status}
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

      {activeTab === 'teachers' && (canViewTeachers || canCreateUsers || canManageTeacherProfile) ? (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-end gap-2">
            {canManageAssignments ? (
              <button
                type="button"
                onClick={() => setShowBaseCampusForm((value) => !value)}
                className="rounded-xl border border-primary-300 bg-white px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
              >
                {showBaseCampusForm ? 'Cerrar sede base' : 'Configurar sede base'}
              </button>
            ) : null}
            {canCreateUsers ? (
              <button
                type="button"
                onClick={() => {
                  if (!showTeacherForm || editingTeacherId) {
                    setTeacherForm(createTeacherFormDefaults());
                    setEditingTeacherId(null);
                  }
                  setShowTeacherForm((value) => !value);
                }}
                className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
              >
                {showTeacherForm ? 'Cerrar formulario' : 'Nuevo docente'}
              </button>
            ) : null}
          </div>

          {showBaseCampusForm && canManageAssignments ? (
            <form onSubmit={submitBaseCampus} className="panel-soft space-y-3">
              <h2 className="text-lg font-semibold text-primary-900">Configurar sede base del docente</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <select
                  className="app-input"
                  value={baseCampusForm.teacher_user_id}
                  onChange={(event) => setBaseCampusForm((prev) => ({ ...prev, teacher_user_id: event.target.value }))}
                  required
                >
                  <option value="">Docente</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.first_name} {teacher.last_name}
                    </option>
                  ))}
                </select>

                <select
                  className="app-input"
                  value={baseCampusForm.base_campus_id}
                  onChange={(event) => setBaseCampusForm((prev) => ({ ...prev, base_campus_id: event.target.value }))}
                >
                  <option value="">Sin sede base</option>
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}
                    </option>
                  ))}
                </select>

                <input
                  className="app-input lg:col-span-1"
                  placeholder="Motivo del cambio (opcional)"
                  value={baseCampusForm.reason}
                  onChange={(event) => setBaseCampusForm((prev) => ({ ...prev, reason: event.target.value }))}
                />
              </div>

              <button className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700">
                Guardar sede base
              </button>
            </form>
          ) : null}

          {showTeacherForm && (canCreateUsers || canManageTeacherProfile) ? (
            <form onSubmit={submitTeacher} className="panel-soft space-y-3">
              <h2 className="text-lg font-semibold text-primary-900">
                {editingTeacherId ? 'Editar docente' : 'Registrar docente'}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <input
                  className="app-input"
                  placeholder="Nombres"
                  value={teacherForm.first_name}
                  onChange={(event) => setTeacherForm((prev) => ({ ...prev, first_name: event.target.value }))}
                  required
                />
                <input
                  className="app-input"
                  placeholder="Apellidos"
                  value={teacherForm.last_name}
                  onChange={(event) => setTeacherForm((prev) => ({ ...prev, last_name: event.target.value }))}
                  required
                />
                <select
                  className="app-input"
                  value={teacherForm.document_type}
                  onChange={(event) => setTeacherForm((prev) => ({ ...prev, document_type: event.target.value }))}
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
                  value={teacherForm.document_number}
                  onChange={(event) => setTeacherForm((prev) => ({ ...prev, document_number: event.target.value }))}
                  required
                />
                <input
                  className="app-input"
                  placeholder="Telefono"
                  value={teacherForm.phone}
                  onChange={(event) => setTeacherForm((prev) => ({ ...prev, phone: event.target.value }))}
                  required
                />
                {shouldShowTeacherCampusField ? (
                  canSelectTeacherCampus ? (
                    <select
                      className="app-input"
                      value={teacherForm.base_campus_id}
                      onChange={(event) =>
                        setTeacherForm((prev) => ({
                          ...prev,
                          base_campus_id: event.target.value,
                          assignment_campus_id:
                            !editingTeacherId &&
                            (!prev.assignment_course_campus_id || prev.assignment_campus_id === prev.base_campus_id)
                              ? event.target.value
                              : prev.assignment_campus_id,
                          assignment_campus_override_reason:
                            !editingTeacherId && prev.assignment_campus_id === prev.base_campus_id
                              ? ''
                              : prev.assignment_campus_override_reason,
                        }))
                      }
                      required={!editingTeacherId}
                      disabled={Boolean(editingTeacherId && !canManageAssignments)}
                    >
                      <option value="">{editingTeacherId ? 'Sin sede base' : 'Selecciona una sede base'}</option>
                      {campuses.map((campus) => (
                        <option key={campus.id} value={campus.id}>
                          {campus.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="app-input" value={teacherCampusDisplayName} readOnly disabled />
                  )
                ) : null}
                <input
                  type="email"
                  className="app-input"
                  placeholder="Correo"
                  value={teacherForm.email}
                  onChange={(event) => setTeacherForm((prev) => ({ ...prev, email: event.target.value }))}
                  required
                />
                {!editingTeacherId ? (
                  <label className="flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-sm text-primary-800 sm:col-span-2 lg:col-span-2">
                    <input
                      type="checkbox"
                      checked={Boolean(teacherForm.use_email_as_password)}
                      onChange={(event) =>
                        setTeacherForm((prev) => ({ ...prev, use_email_as_password: event.target.checked }))
                      }
                    />
                    <span>Usar el correo como contraseña temporal y pedir cambio en el primer ingreso.</span>
                  </label>
                ) : null}
                <input
                  type="password"
                  className="app-input"
                  placeholder={
                    editingTeacherId
                      ? 'Nueva contrasena (opcional)'
                      : teacherForm.use_email_as_password
                        ? 'Se usará el correo como contraseña temporal'
                        : 'Contrasena inicial'
                  }
                  value={teacherForm.password}
                  onChange={(event) => setTeacherForm((prev) => ({ ...prev, password: event.target.value }))}
                  required={!editingTeacherId}
                  minLength={8}
                  disabled={!editingTeacherId && Boolean(teacherForm.use_email_as_password)}
                />
                <input
                  className="app-input sm:col-span-2 lg:col-span-4"
                  placeholder="Direccion"
                  value={teacherForm.address}
                  onChange={(event) => setTeacherForm((prev) => ({ ...prev, address: event.target.value }))}
                  required
                />
              </div>

              {!editingTeacherId && canManageAssignments ? (
                <div className="space-y-3 rounded-xl border border-primary-200 bg-white p-4">
                  <label className="flex items-start gap-3 text-sm text-primary-800">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={Boolean(teacherForm.create_initial_assignment)}
                      onChange={(event) =>
                        setTeacherForm((prev) => ({
                          ...prev,
                          create_initial_assignment: event.target.checked,
                          assignment_campus_id: prev.assignment_campus_id || prev.base_campus_id || defaultTeacherCampusId,
                          assignment_period_id: prev.assignment_period_id || defaultPeriodId,
                        }))
                      }
                    />
                    <span>
                      <span className="block font-semibold text-primary-900">Configurar carga académica inicial</span>
                      <span className="block text-xs text-primary-700">
                        Asigna desde ahora la sede, el curso y el periodo en que este docente empezará a dictar.
                      </span>
                    </span>
                  </label>

                  {teacherForm.create_initial_assignment ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-primary-700">Sede donde dictará</span>
                        {canSelectTeacherCampus ? (
                          <select
                            className="app-input"
                            value={effectiveTeacherAssignmentCampusId}
                            onChange={(event) =>
                              setTeacherForm((prev) => ({
                                ...prev,
                                assignment_campus_id: event.target.value,
                                assignment_course_campus_id: '',
                                assignment_schedule_info: '',
                                assignment_campus_override_reason: '',
                              }))
                            }
                            required
                          >
                            <option value="">Selecciona una sede</option>
                            {teacherAssignmentCampusOptions.map((campus) => (
                              <option key={campus.id} value={campus.id}>
                                {campus.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input className="app-input" value={teacherCampusDisplayName} readOnly disabled />
                        )}
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-primary-700">Curso a dictar</span>
                        <select
                          className="app-input"
                          value={teacherForm.assignment_course_campus_id}
                          onChange={(event) =>
                            setTeacherForm((prev) => ({
                              ...prev,
                              assignment_course_campus_id: event.target.value,
                              assignment_schedule_info: getDefaultScheduleInfoFromBlocks(
                                filteredTeacherAssignmentOfferings.find(
                                  (offering) => String(offering.id) === String(event.target.value),
                                )?.schedule_blocks || [],
                              ),
                              assignment_campus_override_reason: '',
                            }))
                          }
                          required
                          disabled={
                            (canSelectTeacherCampus && !effectiveTeacherAssignmentCampusId) ||
                            filteredTeacherAssignmentOfferings.length === 0
                          }
                        >
                          <option value="">
                            {filteredTeacherAssignmentOfferings.length ? 'Selecciona un curso' : 'No hay cursos disponibles'}
                          </option>
                          {filteredTeacherAssignmentOfferings.map((offering) => (
                            <option key={offering.id} value={offering.id}>
                              {offering.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-primary-700">Periodo académico</span>
                        <select
                          className="app-input"
                          value={teacherForm.assignment_period_id}
                          onChange={(event) =>
                            setTeacherForm((prev) => ({ ...prev, assignment_period_id: event.target.value }))
                          }
                          required
                          disabled={periods.length === 0}
                        >
                          <option value="">{periods.length ? 'Selecciona un periodo' : 'No hay periodos'}</option>
                          {periods.map((period) => (
                            <option key={period.id} value={period.id}>
                              {period.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-primary-700">Horario / turno</span>
                        <select
                          className="app-input"
                          value={teacherForm.assignment_schedule_info}
                          onChange={(event) =>
                            setTeacherForm((prev) => ({ ...prev, assignment_schedule_info: event.target.value }))
                          }
                          disabled={
                            !teacherForm.assignment_course_campus_id ||
                            selectedTeacherInitialScheduleBlocks.length === 0
                          }
                          required={selectedTeacherInitialScheduleBlocks.length > 1}
                        >
                          <option value="">
                            {!teacherForm.assignment_course_campus_id
                              ? 'Elige curso primero'
                              : selectedTeacherInitialScheduleBlocks.length === 0
                                ? 'Sin bloques registrados'
                                : 'Bloque horario'}
                          </option>
                          {selectedTeacherInitialScheduleBlocks.map((block, index) => (
                            <option key={`${block}-${index}`} value={block}>
                              Bloque #{index + 1}: {block}
                            </option>
                          ))}
                        </select>
                      </label>

                      {selectedTeacherInitialOffering ? (
                        <div className="rounded-xl border border-primary-100 bg-primary-50 px-3 py-3 text-xs text-primary-800 sm:col-span-2 lg:col-span-4">
                          Se asignará el curso <span className="font-semibold">{selectedTeacherInitialOffering.course_name}</span> en{' '}
                          <span className="font-semibold">{selectedTeacherInitialOffering.campus_name}</span>
                          {' '}({selectedTeacherInitialOffering.modality}).
                          {selectedTeacherInitialOffering.schedule_info ? (
                            <span className="mt-1 block">
                              Horarios configurados: <span className="font-semibold">{selectedTeacherInitialOffering.schedule_info}</span>
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {teacherInitialAssignmentRequiresCampusOverrideReason ? (
                        <label className="space-y-1 sm:col-span-2 lg:col-span-4">
                          <span className="text-xs font-semibold text-red-700">
                            Motivo de asignación en sede distinta
                          </span>
                          <textarea
                            className="app-input min-h-[96px]"
                            placeholder="Explica por qué este docente dictará en una sede diferente a su sede base."
                            value={teacherForm.assignment_campus_override_reason}
                            onChange={(event) =>
                              setTeacherForm((prev) => ({
                                ...prev,
                                assignment_campus_override_reason: event.target.value,
                              }))
                            }
                            required
                          />
                        </label>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-xs text-primary-700">
                      Puedes dejarlo sin asignación inicial y completar su carga académica después desde la pestaña de asignaciones.
                    </p>
                  )}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700">
                  {editingTeacherId ? 'Guardar cambios' : 'Guardar docente'}
                </button>
                {editingTeacherId ? (
                  <button
                    type="button"
                    onClick={resetTeacherEditor}
                    className="rounded-xl border border-primary-300 bg-white px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
                  >
                    Cancelar edicion
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}

          {canViewTeachers ? (
            <article className="card overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-primary-600">
                    <th className="pb-2 pr-3">Docente</th>
                    <th className="pb-2 pr-3">Tipo doc.</th>
                    <th className="pb-2 pr-3">Nro. doc.</th>
                    <th className="pb-2 pr-3">Telefono</th>
                    <th className="pb-2 pr-3">Correo</th>
                    <th className="pb-2 pr-3">Sede base</th>
                    <th className="pb-2 pr-3">Activo</th>
                    <th className="pb-2">Asignaciones activas</th>
                    {canManageTeacherProfile ? <th className="pb-2">Acciones</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((teacher) => {
                    const parsedDocument = parseDocumentValue(teacher.document_number);
                    return (
                    <tr key={teacher.id} className="border-t border-primary-100">
                      <td className="py-2 pr-3 font-medium">
                        {teacher.first_name} {teacher.last_name}
                      </td>
                      <td className="py-2 pr-3">{parsedDocument.document_type}</td>
                      <td className="py-2 pr-3">{parsedDocument.document_number || '-'}</td>
                      <td className="py-2 pr-3">{teacher.phone || '-'}</td>
                      <td className="py-2 pr-3">{teacher.email}</td>
                      <td className="py-2 pr-3">{teacher.base_campus_name || '-'}</td>
                      <td className="py-2 pr-3">{teacher.is_active ? 'SI' : 'NO'}</td>
                      <td className="py-2">{teacher.active_assignments}</td>
                      {canManageTeacherProfile ? (
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() => beginEditTeacher(teacher)}
                            className="rounded-lg border border-primary-300 px-2 py-1 text-xs font-semibold text-primary-800 hover:bg-primary-50"
                          >
                            EDITAR
                          </button>
                        </td>
                      ) : null}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
