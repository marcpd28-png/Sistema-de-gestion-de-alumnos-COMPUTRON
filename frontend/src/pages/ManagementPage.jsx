import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useConfirmation } from '../context/ConfirmationContext';
import { toast } from 'sonner';
import { MANAGEMENT_SECTION_ITEMS } from '../constants/managementSections';
import { PERMISSIONS } from '../constants/permissions';
import { calculateAgeFromBirthDate, formatAgeLabel, normalizeDateOnly } from '../utils/age';
import { buildDocumentValue, DOCUMENT_TYPE_OPTIONS, parseDocumentValue } from '../utils/document';
import PaginationControls from '../components/PaginationControls';
import CertificateGeneratorLauncher from '../components/certificates/CertificateGeneratorLauncher';
import CertificateLibraryPage from './CertificateLibraryPage';
import PaymentsPage from './PaymentsPage';
import TransfersManager from './transfers/TransfersManager';

const createStudentDefaults = () => ({
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
  guardian_first_name: '',
  guardian_last_name: '',
  guardian_email: '',
  guardian_phone: '',
  guardian_document_number: '',
  enrollment_campus_id: '',
  course_campus_id: '',
  schedule_info: '',
  period_id: '',
  enrollment_date: getTodayIsoDate(),
  enrollment_notes: '',
  enrollment_fee_amount: '',
  installments_count: '4',
  installment_amount: '',
  first_installment_due_date: getTodayIsoDate(),
  use_variable_installments: false,
  installment_plan: [],
  access_user_id: '',
  access_is_active: true,
  access_original_is_active: true,
  access_password: '',
});

const createEnrollmentEditDefaults = () => ({
  student_name: '',
  campus_id: '',
  campus_name: '',
  course_campus_id: '',
  original_course_campus_id: '',
  course_name: '',
  modality: '',
  schedule_info: '',
  offering_schedule_info: '',
  period_id: '',
  original_period_id: '',
  enrollment_date: getTodayIsoDate(),
  status: 'ACTIVE',
  notes: '',
  course_change_locked: false,
  course_change_reason: '',
});

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

const campusDefaults = {
  name: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  registration_date: getTodayIsoDate(),
};

const createPeriodDefaults = () => ({
  name: '',
  start_date: getTodayIsoDate(),
  end_date: getTodayIsoDate(),
});

const createCourseDefaults = () => ({
  offering_id: '',
  name: '',
  description: '',
  duration_hours: '',
  passing_grade: '11',
  is_active: true,
  campus_id: '',
  period_id: '',
  teacher_user_id: '',
  allow_without_teacher: false,
  modality: 'PRESENCIAL',
  schedules: [{ id: Date.now(), days: ['LUN'], start: '18:00', end: '20:00' }],
  monthly_fee: '',
  capacity: '',
});

const COURSE_DAY_OPTIONS = [
  { value: 'LUN', label: 'LUN' },
  { value: 'MAR', label: 'MAR' },
  { value: 'MIE', label: 'MIE' },
  { value: 'JUE', label: 'JUE' },
  { value: 'VIE', label: 'VIE' },
  { value: 'SAB', label: 'SAB' },
  { value: 'DOM', label: 'DOM' },
];
const STUDENT_PAGE_SIZE = 10;
const ENROLLMENT_RECENT_LIMIT = 10;
const RECENT_COURSES_PREVIEW_LIMIT = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const TEACHER_ASSIGNMENT_FILTER_CHUNK_SIZE = 200;

const ENROLLMENT_STATUS_LABELS = {
  ACTIVE: 'Activa',
  SUSPENDED: 'Suspendida',
  COMPLETED: 'Completada',
  CANCELED: 'Cancelada',
  TRANSFERRED: 'Trasladada',
};

const normalizeOptional = (value) => {
  const trimmed = String(value || '').trim();
  return trimmed || null;
};

const toEnrollmentStatusLabel = (status) => {
  const key = String(status || '').toUpperCase();
  return ENROLLMENT_STATUS_LABELS[key] || status || '-';
};

function getTodayIsoDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function toInputDate(value) {
  if (!value) return getTodayIsoDate();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function toInputDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('es-PE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

const addMonthsToIsoDate = (isoDate, months) => {
  const base = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return getTodayIsoDate();
  base.setMonth(base.getMonth() + months);
  return toInputDate(base);
};

const normalizeInstallmentsCount = (value) => {
  const parsed = Number(value || 0);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 24);
};

const parseScheduleRange = (scheduleInfo) => {
  const match = String(scheduleInfo || '').match(/([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)/);
  if (!match) {
    return { start: '18:00', end: '20:00' };
  }
  return {
    start: `${match[1]}:${match[2]}`,
    end: `${match[3]}:${match[4]}`,
  };
};

const parseCourseSchedule = (scheduleInfo) => {
  const parts = String(scheduleInfo || '').split('|').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return [{ id: Date.now(), days: ['LUN'], start: '18:00', end: '20:00' }];
  }

  return parts.map((part, index) => {
    const days = parseScheduleDays(part);
    const range = parseScheduleRange(part);
    return {
      id: Date.now() + index,
      days: days.length ? days : ['LUN'],
      start: range.start,
      end: range.end,
    };
  });
};

const parseScheduleDays = (scheduleInfo) => {
  const tokenMap = {
    LUN: 'LUN',
    LUNES: 'LUN',
    MAR: 'MAR',
    MARTES: 'MAR',
    MIE: 'MIE',
    MIERCOLES: 'MIE',
    JUE: 'JUE',
    JUEVES: 'JUE',
    VIE: 'VIE',
    VIERNES: 'VIE',
    SAB: 'SAB',
    SABADO: 'SAB',
    DOM: 'DOM',
    DOMINGO: 'DOM',
  };

  const tokens = String(scheduleInfo || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Z]+/)
    .filter(Boolean);

  const found = new Set();
  for (const token of tokens) {
    const mapped = tokenMap[token];
    if (mapped) found.add(mapped);
  }

  return COURSE_DAY_OPTIONS.map((day) => day.value).filter((day) => found.has(day));
};

const getCourseScheduleInfo = (schedules) => {
  if (!Array.isArray(schedules) || schedules.length === 0) return '';
  
  return schedules
    .map((s) => {
      const orderedDays = COURSE_DAY_OPTIONS.map((day) => day.value).filter((day) => (s.days || []).includes(day));
      return `${orderedDays.join(', ')} ${s.start}-${s.end}`;
    })
    .join(' | ');
};

const getScheduleBlocks = (scheduleInfo) =>
  String(scheduleInfo || '')
    .split('|')
    .map((block) => block.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

const getDefaultScheduleInfoFromBlocks = (scheduleBlocks = []) =>
  scheduleBlocks.length === 1 ? scheduleBlocks[0] : '';

const timeToMinutes = (value) => {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

export default function ManagementPage() {
  const { user, hasPermission } = useAuth();
  const { confirm } = useConfirmation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const canViewStudents = hasPermission(PERMISSIONS.STUDENTS_VIEW);
  const canManageStudents = hasPermission(PERMISSIONS.STUDENTS_MANAGE);
  const canViewTeachers = hasPermission(PERMISSIONS.TEACHERS_VIEW);
  const canCreateTeachers = hasPermission(PERMISSIONS.USERS_CREATE);
  const canManageTeacherProfile = hasPermission(PERMISSIONS.USERS_STATUS_MANAGE);
  const canViewCourses = hasPermission(PERMISSIONS.COURSES_VIEW);
  const canManageCourses = hasPermission(PERMISSIONS.COURSES_MANAGE);
  const canViewCampuses = hasPermission(PERMISSIONS.CAMPUSES_VIEW);
  const canManageCampuses = hasPermission(PERMISSIONS.CAMPUSES_MANAGE);
  const canViewPeriods = hasPermission(PERMISSIONS.PERIODS_VIEW);
  const canManagePeriods = hasPermission(PERMISSIONS.PERIODS_MANAGE);
  const canViewPayments = hasPermission(PERMISSIONS.PAYMENTS_VIEW);
  const canManagePayments = hasPermission(PERMISSIONS.PAYMENTS_MANAGE);
  const canViewEnrollments = hasPermission(PERMISSIONS.ENROLLMENTS_VIEW);
  const canManageEnrollments = hasPermission(PERMISSIONS.ENROLLMENTS_MANAGE);
  const canManageInstallments = hasPermission(PERMISSIONS.INSTALLMENTS_MANAGE);
  const canViewPaymentConcepts = hasPermission(PERMISSIONS.PAYMENT_CONCEPTS_VIEW);
  const canViewAssignments = hasPermission(PERMISSIONS.TEACHERS_ASSIGNMENTS_VIEW);
  const canManageAssignments = hasPermission(PERMISSIONS.TEACHERS_ASSIGNMENTS_MANAGE);
  const canManageTransfers = canViewStudents && canManageEnrollments;
  const canManageStudentAccess = canManageTeacherProfile;
  const canReadStudents = canViewStudents || canManageStudents;
  const canReadTeachers = canViewTeachers || canCreateTeachers || canManageTeacherProfile;
  const canReadCourses = canViewCourses || canManageCourses;
  const canReadPeriods = canViewPeriods || canManagePeriods;
  const canReadCoursesModule = canReadCourses;
  const canReadCampuses = canViewCampuses || canManageCampuses;
  const canReadPayments = canViewPayments || canManagePayments;
  const canReadEnrollments = canViewEnrollments || canManageEnrollments;
  const userRoles = user?.roles || [];
  const assignedCampusIds = user?.campus_ids || (user?.base_campus_id ? [user.base_campus_id] : []);
  const isRootAdminProfile = userRoles.includes('ADMIN') && assignedCampusIds.length === 0;
  const canSelectEnrollmentCampus = Boolean(isRootAdminProfile && canManageEnrollments);
  const defaultTeacherCampusId = !isRootAdminProfile && user?.base_campus_id ? String(user.base_campus_id) : '';
  const canSelectTeacherCampus = Boolean(isRootAdminProfile && canReadCampuses);
  const createTeacherFormDefaults = () => ({
    ...teacherDefaults,
    base_campus_id: defaultTeacherCampusId,
    create_initial_assignment: Boolean(canManageAssignments),
    assignment_campus_id: defaultTeacherCampusId,
  });

  const sectionAccess = useMemo(
    () => ({
      students: canReadStudents,
      students_list: canReadStudents,
      transfers: canReadStudents,
      teachers: canReadTeachers,
      courses: canReadCoursesModule,
      campuses: canReadCampuses,
      periods: canReadPeriods,
      payments: canReadPayments,
      certificates: canReadPayments,
      certificate_history: canReadPayments,
    }),
    [canReadCampuses, canReadCoursesModule, canReadPayments, canReadPeriods, canReadStudents, canReadTeachers],
  );

  const tabs = useMemo(
    () =>
      MANAGEMENT_SECTION_ITEMS.map((item) => ({
        ...item,
        enabled: Boolean(sectionAccess[item.key]),
      })),
    [sectionAccess],
  );

  const firstEnabledTab = tabs.find((tab) => tab.enabled)?.key || null;
  const requestedSection = searchParams.get('section');
  const resolveTabKey = useCallback(
    (candidateKey) => {
      const normalizedCandidate = String(candidateKey || '').trim();
      if (normalizedCandidate && tabs.some((tab) => tab.key === normalizedCandidate && tab.enabled)) {
        return normalizedCandidate;
      }
      return firstEnabledTab;
    },
    [firstEnabledTab, tabs],
  );
  const [activeTab, setActiveTab] = useState(() => resolveTabKey(requestedSection));
  const [, startTabTransition] = useTransition();
  const [students, setStudents] = useState([]);
  const [studentTotal, setStudentTotal] = useState(0);
  const [studentPage, setStudentPage] = useState(1);
  const [teachers, setTeachers] = useState([]);
  const [courses, setCourses] = useState([]);
  const [teacherTotal, setTeacherTotal] = useState(0);
  const [teacherPage, setTeacherPage] = useState(1);
  const [teacherPageSize, setTeacherPageSize] = useState(20);
  const [courseTotal, setCourseTotal] = useState(0);
  const [hasFullTeachersLoaded, setHasFullTeachersLoaded] = useState(false);
  const [hasFullCoursesLoaded, setHasFullCoursesLoaded] = useState(false);
  const [coursesScopeKey, setCoursesScopeKey] = useState('');
  const [campuses, setCampuses] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [recentEnrollments, setRecentEnrollments] = useState([]);
  const [teacherAssignments, setTeacherAssignments] = useState([]);
  const [paymentConcepts, setPaymentConcepts] = useState([]);
  const paymentConceptsLoadAttemptedRef = useRef(false);

  const [studentForm, setStudentForm] = useState(createStudentDefaults);
  const [enrollmentEditForm, setEnrollmentEditForm] = useState(createEnrollmentEditDefaults);
  const [teacherForm, setTeacherForm] = useState(createTeacherFormDefaults);
  const [courseForm, setCourseForm] = useState(createCourseDefaults);
  const [campusForm, setCampusForm] = useState(campusDefaults);
  const [periodForm, setPeriodForm] = useState(createPeriodDefaults);

  const [editingStudentId, setEditingStudentId] = useState(null);
  const [editingEnrollmentId, setEditingEnrollmentId] = useState(null);
  const [editingTeacherId, setEditingTeacherId] = useState(null);
  const [editingCourseId, setEditingCourseId] = useState(null);
  const [editingCampusId, setEditingCampusId] = useState(null);

  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showTeacherForm, setShowTeacherForm] = useState(false);
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [showCampusForm, setShowCampusForm] = useState(false);
  const [showPeriodForm, setShowPeriodForm] = useState(false);

  const [studentSearch, setStudentSearch] = useState('');
  const [enrollmentSearch, setEnrollmentSearch] = useState('');
  const [teacherSearch, setTeacherSearch] = useState('');
  const [courseSearch, setCourseSearch] = useState('');
  const [courseCampusFilter, setCourseCampusFilter] = useState(
    !isRootAdminProfile && user?.base_campus_id ? String(user.base_campus_id) : '',
  );
  const [campusSearch, setCampusSearch] = useState('');

  const deferredTeacherSearch = useDeferredValue(teacherSearch);
  const deferredCourseSearch = useDeferredValue(courseSearch);
  const deferredCampusSearch = useDeferredValue(campusSearch);
  const courseSearchTerm = deferredCourseSearch.trim();

  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingTeacherAssignments, setLoadingTeacherAssignments] = useState(false);
  const [loadingCampuses, setLoadingCampuses] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasFullTeacherAssignmentsLoaded, setHasFullTeacherAssignmentsLoaded] = useState(false);
  const [teacherAssignmentsScopeKey, setTeacherAssignmentsScopeKey] = useState('');
  const studentTotalPages = Math.max(1, Math.ceil(studentTotal / STUDENT_PAGE_SIZE));
  const teacherTotalPages = Math.max(1, Math.ceil(teacherTotal / teacherPageSize));

  const changeTab = useCallback(
    (nextTab, { replace = false } = {}) => {
      const resolvedTab = resolveTabKey(nextTab);
      startTabTransition(() => setActiveTab(resolvedTab));

      const nextParams = new URLSearchParams(searchParams);
      if (resolvedTab) {
        nextParams.set('section', resolvedTab);
      } else {
        nextParams.delete('section');
      }

      setSearchParams(nextParams, { replace });
    },
    [resolveTabKey, searchParams, setSearchParams],
  );

  useEffect(() => {
    const resolvedTab = resolveTabKey(requestedSection);

    if (resolvedTab !== activeTab) {
      startTabTransition(() => setActiveTab(resolvedTab));
      return;
    }

    if (resolvedTab !== requestedSection) {
      const nextParams = new URLSearchParams(searchParams);
      if (resolvedTab) {
        nextParams.set('section', resolvedTab);
      } else {
        nextParams.delete('section');
      }
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeTab, navigate, requestedSection, resolveTabKey, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isRootAdminProfile && user?.base_campus_id) {
      setCourseCampusFilter((current) => current || String(user.base_campus_id));
    }
  }, [isRootAdminProfile, user?.base_campus_id]);

  const loadStudents = useCallback(
    async ({ search = '', page = studentPage, pageSize = STUDENT_PAGE_SIZE } = {}) => {
      if (!canReadStudents) {
        setStudents([]);
        setStudentTotal(0);
        return;
      }

      setLoadingStudents(true);
      try {
        const response = await api.get('/students', {
          params: {
            q: search || undefined,
            page,
            page_size: pageSize,
          },
        });
        const items = response.data?.items || [];
        const meta = response.data?.meta || {};
        const total = Number(meta.total ?? items.length);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        if (page > totalPages) {
          setStudentPage(totalPages);
          return;
        }

        setStudents(items);
        setStudentTotal(total);
      } catch (requestError) {
        toast.error(requestError.response?.data?.message || 'No se pudieron cargar los alumnos.');
      } finally {
        setLoadingStudents(false);
      }
    },
    [canReadStudents, studentPage],
  );

  const loadRecentEnrollments = useCallback(async () => {
    if (!canReadEnrollments) {
      setRecentEnrollments([]);
      return;
    }

    setLoadingEnrollments(true);
    try {
      const response = await api.get('/enrollments/recent');
      setRecentEnrollments(response.data?.items || []);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'No se pudieron cargar las matrículas recientes.');
    } finally {
      setLoadingEnrollments(false);
    }
  }, [canReadEnrollments]);

  const loadTeachers = useCallback(
    async ({
      search = '',
      page = teacherPage,
      pageSize = teacherPageSize,
      paginate = true,
    } = {}) => {
      if (!canReadTeachers) {
        setTeachers([]);
        setTeacherTotal(0);
        setHasFullTeachersLoaded(false);
        return;
      }

      setLoadingTeachers(true);
      try {
        const params = {
          q: search || undefined,
        };

        if (paginate) {
          params.page = page;
          params.page_size = pageSize;
        }

        const response = await api.get('/teachers', {
          params,
          ...(canSelectTeacherCampus ? { _skipCampusScope: true } : {}),
        });
        const items = response.data?.items || [];
        const meta = response.data?.meta || {};
        const total = Number(meta.total || items.length);
        const totalPages = paginate ? Math.max(1, Math.ceil(total / pageSize)) : 1;

        if (paginate && page > totalPages) {
          setTeacherPage(totalPages);
          return;
        }

        setTeachers(items);
        setTeacherTotal(total);
        setHasFullTeachersLoaded(!paginate);
      } catch (requestError) {
        toast.error(requestError.response?.data?.message || 'No se pudieron cargar los docentes.');
      } finally {
        setLoadingTeachers(false);
      }
    },
    [canReadTeachers, canSelectTeacherCampus, teacherPage, teacherPageSize],
  );

  const loadCourses = useCallback(
    async ({ search = '', campusId = null, sort = 'NAME_ASC', pageSize = null, recentOnly = false } = {}) => {
      if (!canReadCourses) {
        setCourses([]);
        setCourseTotal(0);
        setHasFullCoursesLoaded(false);
        setCoursesScopeKey('');
        return;
      }

      setLoadingCourses(true);
      try {
        const normalizedCampusId =
          campusId === null || campusId === undefined || campusId === ''
            ? null
            : Number(campusId);
        const normalizedPageSize =
          Number.isInteger(pageSize) && pageSize > 0 ? pageSize : null;
        const scopeKey = recentOnly
          ? 'preview:recent'
          : Number.isFinite(normalizedCampusId) && normalizedCampusId > 0
            ? `campus:${normalizedCampusId}`
            : 'all';
        const params = {
          q: search || undefined,
          campus_id: Number.isFinite(normalizedCampusId) && normalizedCampusId > 0 ? normalizedCampusId : undefined,
          sort: sort || undefined,
          page_size: normalizedPageSize || undefined,
        };

        const response = await api.get('/courses', {
          params,
          ...(canSelectEnrollmentCampus || canSelectTeacherCampus ? { _skipCampusScope: true } : {}),
        });
        const items = response.data?.items || [];
        const meta = response.data?.meta || {};
        const total = Number(meta.total || items.length);

        setCourses(items);
        setCourseTotal(total);
        setHasFullCoursesLoaded(!search && !normalizedCampusId && !recentOnly && !normalizedPageSize);
        setCoursesScopeKey(scopeKey);
      } catch (requestError) {
        toast.error(requestError.response?.data?.message || 'No se pudieron cargar los cursos.');
      } finally {
        setLoadingCourses(false);
      }
    },
    [canReadCourses, canSelectEnrollmentCampus, canSelectTeacherCampus],
  );

  const loadCampuses = useCallback(async () => {
    if (!canReadCampuses) {
      setCampuses([]);
      return;
    }

    setLoadingCampuses(true);
    try {
      const response = await api.get('/campuses', {
        ...(isRootAdminProfile ? { _skipCampusScope: true } : {}),
      });
      setCampuses(response.data?.items || []);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'No se pudieron cargar las sedes.');
    } finally {
      setLoadingCampuses(false);
    }
  }, [canReadCampuses, isRootAdminProfile]);

  const loadPeriods = useCallback(async () => {
    if (!canReadPeriods) {
      setPeriods([]);
      return;
    }

    setLoadingPeriods(true);
    try {
      const response = await api.get('/catalogs/periods');
      setPeriods(response.data?.items || []);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'No se pudieron cargar los periodos.');
    } finally {
      setLoadingPeriods(false);
    }
  }, [canReadPeriods]);

  const loadTeacherAssignments = useCallback(
    async ({ full = false, courseCampusIds = [] } = {}) => {
      if (!canViewAssignments) {
        setTeacherAssignments([]);
        setHasFullTeacherAssignmentsLoaded(false);
        setTeacherAssignmentsScopeKey('');
        return;
      }

      setLoadingTeacherAssignments(true);
      try {
        const normalizedCourseCampusIds = Array.isArray(courseCampusIds)
          ? Array.from(
              new Set(
                courseCampusIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0),
              ),
            )
          : [];
        const shouldLoadFull = full || normalizedCourseCampusIds.length === 0;
        const scopeKey = shouldLoadFull ? 'full' : normalizedCourseCampusIds.join(',');

        let items = [];
        if (shouldLoadFull) {
          const response = await api.get('/teachers/assignments', {
            ...(canSelectEnrollmentCampus ? { _skipCampusScope: true } : {}),
          });
          items = response.data?.items || [];
        } else {
          const requestChunks = [];
          for (let index = 0; index < normalizedCourseCampusIds.length; index += TEACHER_ASSIGNMENT_FILTER_CHUNK_SIZE) {
            requestChunks.push(
              normalizedCourseCampusIds.slice(index, index + TEACHER_ASSIGNMENT_FILTER_CHUNK_SIZE),
            );
          }

          const responses = await Promise.all(
            requestChunks.map((chunk) =>
              api.get('/teachers/assignments', {
                params: { course_campus_ids: chunk.join(',') },
                ...(canSelectEnrollmentCampus ? { _skipCampusScope: true } : {}),
              }),
            ),
          );

          const mergedItems = [];
          const seenIds = new Set();
          for (const response of responses) {
            for (const item of response.data?.items || []) {
              const itemId = Number(item.id || 0);
              if (itemId && seenIds.has(itemId)) continue;
              if (itemId) seenIds.add(itemId);
              mergedItems.push(item);
            }
          }
          items = mergedItems;
        }

        setTeacherAssignments(items);
        setHasFullTeacherAssignmentsLoaded(shouldLoadFull);
        setTeacherAssignmentsScopeKey(scopeKey);
      } catch (requestError) {
        setTeacherAssignmentsScopeKey('');
        toast.error(requestError.response?.data?.message || 'No se pudieron cargar las asignaciones docentes.');
      } finally {
        setLoadingTeacherAssignments(false);
      }
    },
    [canSelectEnrollmentCampus, canViewAssignments],
  );

  const loadPaymentConcepts = useCallback(async () => {
    if (!canViewPaymentConcepts) {
      setPaymentConcepts([]);
      return;
    }

    if (paymentConceptsLoadAttemptedRef.current) {
      return;
    }

    paymentConceptsLoadAttemptedRef.current = true;

    try {
      const response = await api.get('/catalogs/payment-concepts');
      setPaymentConcepts(response.data?.items || []);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'No se pudieron cargar los conceptos de pago.');
    }
  }, [canViewPaymentConcepts]);

  const isStudentsTabActive = activeTab === 'students' || activeTab === 'students_list';
  const isStudentsListTabActive = activeTab === 'students_list';
  const isTeachersTabActive = activeTab === 'teachers';
  const isCoursesTabActive = activeTab === 'courses';
  const isCampusesTabActive = activeTab === 'campuses';
  const isPeriodsTabActive = activeTab === 'periods';
  const shouldLoadRecentCoursesPreview = isRootAdminProfile && !courseCampusFilter && !courseSearchTerm;
  const desiredCoursesScopeKey = shouldLoadRecentCoursesPreview
    ? 'preview:recent'
    : courseCampusFilter
      ? `campus:${courseCampusFilter}`
      : 'all';
  const visibleCourseOfferingIds = useMemo(
    () =>
      courses
        .flatMap((course) => (course.offerings || []).map((offering) => Number(offering.offering_id)))
        .filter((offeringId) => Number.isFinite(offeringId)),
    [courses],
  );
  const visibleCourseOfferingKey = useMemo(
    () => visibleCourseOfferingIds.join(','),
    [visibleCourseOfferingIds],
  );

  useEffect(() => {
    if (!isStudentsListTabActive) return undefined;
    const debounce = setTimeout(() => {
      loadStudents({
        search: studentSearch.trim(),
        page: studentPage,
        pageSize: STUDENT_PAGE_SIZE,
      });
    }, 250);
    return () => clearTimeout(debounce);
  }, [isStudentsListTabActive, loadStudents, studentPage, studentSearch]);

  useEffect(() => {
    if (activeTab !== 'students') return;
    if (!canReadEnrollments || loadingEnrollments || recentEnrollments.length > 0) return;
    loadRecentEnrollments();
  }, [
    activeTab,
    canReadEnrollments,
    loadRecentEnrollments,
    loadingEnrollments,
    recentEnrollments.length,
  ]);

  useEffect(() => {
    if (!isTeachersTabActive) return;
    loadTeachers({
      search: deferredTeacherSearch.trim(),
      page: teacherPage,
      pageSize: teacherPageSize,
      paginate: true,
    });
  }, [deferredTeacherSearch, isTeachersTabActive, loadTeachers, teacherPage, teacherPageSize]);

  useEffect(() => {
    if (!isTeachersTabActive || !canReadCampuses) return;
    if (loadingCampuses || campuses.length > 0) return;
    loadCampuses();
  }, [campuses.length, canReadCampuses, isTeachersTabActive, loadCampuses, loadingCampuses]);

  useEffect(() => {
    if (!isTeachersTabActive || !showTeacherForm) return;

    if (canReadCampuses && !loadingCampuses && campuses.length === 0) {
      loadCampuses();
    }

    if (canManageAssignments && canReadCourses && !loadingCourses && !hasFullCoursesLoaded) {
      loadCourses();
    }

    if (canManageAssignments && canReadPeriods && !loadingPeriods && periods.length === 0) {
      loadPeriods();
    }
  }, [
    campuses.length,
    canManageAssignments,
    canReadCampuses,
    canReadCourses,
    canReadPeriods,
    hasFullCoursesLoaded,
    isTeachersTabActive,
    loadCampuses,
    loadCourses,
    loadPeriods,
    loadingPeriods,
    loadingCampuses,
    loadingCourses,
    periods.length,
    showTeacherForm,
  ]);

  useEffect(() => {
    if (!isCampusesTabActive) return;
    if (!canReadCampuses || loadingCampuses || campuses.length > 0) return;
    loadCampuses();
  }, [canReadCampuses, campuses.length, isCampusesTabActive, loadCampuses, loadingCampuses]);

  useEffect(() => {
    if (!isPeriodsTabActive) return;
    if (!canReadPeriods || loadingPeriods || periods.length > 0) return;
    loadPeriods();
  }, [canReadPeriods, isPeriodsTabActive, loadPeriods, loadingPeriods, periods.length]);

  useEffect(() => {
    if (!isCoursesTabActive || !canReadCourses) return;
    if (canReadCampuses && !loadingCampuses && campuses.length === 0) {
      loadCampuses();
    }
    if (loadingCourses || coursesScopeKey === desiredCoursesScopeKey) return;

    if (shouldLoadRecentCoursesPreview) {
      loadCourses({
        campusId: null,
        sort: 'CREATED_DESC',
        pageSize: RECENT_COURSES_PREVIEW_LIMIT,
        recentOnly: true,
      });
      return;
    }

    loadCourses({ campusId: courseCampusFilter || null });
  }, [
    campuses.length,
    canReadCampuses,
    canReadCourses,
    courseCampusFilter,
    courseSearchTerm,
    coursesScopeKey,
    desiredCoursesScopeKey,
    isCoursesTabActive,
    loadCampuses,
    loadCourses,
    loadingCampuses,
    loadingCourses,
    shouldLoadRecentCoursesPreview,
  ]);

  useEffect(() => {
    if (!isCoursesTabActive || !canReadCourses || !canViewAssignments || showCourseForm || showStudentForm) {
      return;
    }
    if (!visibleCourseOfferingKey) return;
    if (hasFullTeacherAssignmentsLoaded || loadingTeacherAssignments) return;
    if (teacherAssignmentsScopeKey === visibleCourseOfferingKey) return;

    loadTeacherAssignments({ full: false, courseCampusIds: visibleCourseOfferingIds });
  }, [
    canReadCourses,
    canViewAssignments,
    hasFullTeacherAssignmentsLoaded,
    isCoursesTabActive,
    loadTeacherAssignments,
    loadingTeacherAssignments,
    showCourseForm,
    showStudentForm,
    teacherAssignmentsScopeKey,
    visibleCourseOfferingIds,
    visibleCourseOfferingKey,
  ]);

  useEffect(() => {
    if (!isCoursesTabActive || !canManageCourses || !showCourseForm) return;

    if (canReadCampuses && !loadingCampuses && campuses.length === 0) {
      loadCampuses();
    }

    if (canReadPeriods && !loadingPeriods && periods.length === 0) {
      loadPeriods();
    }

    if (canReadTeachers && !loadingTeachers && !hasFullTeachersLoaded) {
      loadTeachers({ search: '', paginate: false });
    }

    if (canViewAssignments && !loadingTeacherAssignments && !hasFullTeacherAssignmentsLoaded) {
      loadTeacherAssignments({ full: true });
    }
  }, [
    campuses.length,
    canManageCourses,
    canReadCampuses,
    canReadPeriods,
    canReadTeachers,
    canViewAssignments,
    hasFullTeachersLoaded,
    hasFullTeacherAssignmentsLoaded,
    isCoursesTabActive,
    loadCampuses,
    loadPeriods,
    loadTeacherAssignments,
    loadTeachers,
    loadingPeriods,
    loadingCampuses,
    loadingTeacherAssignments,
    loadingTeachers,
    periods.length,
    showCourseForm,
  ]);

  useEffect(() => {
    if (!isStudentsTabActive || !canManageStudents || !showStudentForm) return;

    if (canReadCourses && !loadingCourses && !hasFullCoursesLoaded) {
      loadCourses();
    }

    if (canReadCampuses && !loadingCampuses && campuses.length === 0) {
      loadCampuses();
    }

    if (canReadPeriods && !loadingPeriods && periods.length === 0) {
      loadPeriods();
    }

    if (canViewAssignments && !loadingTeacherAssignments && !hasFullTeacherAssignmentsLoaded) {
      loadTeacherAssignments({ full: true });
    }

    if (canViewPaymentConcepts && canManageInstallments && paymentConcepts.length === 0) {
      loadPaymentConcepts();
    }
  }, [
    canManageInstallments,
    canManageStudents,
    canReadCampuses,
    canReadCourses,
    canViewAssignments,
    canViewPaymentConcepts,
    canReadPeriods,
    hasFullCoursesLoaded,
    campuses.length,
    isStudentsTabActive,
    loadCampuses,
    loadCourses,
    loadPaymentConcepts,
    loadPeriods,
    loadTeacherAssignments,
    loadingCampuses,
    loadingCourses,
    loadingPeriods,
    loadingTeacherAssignments,
    paymentConcepts.length,
    periods.length,
    showStudentForm,
    hasFullTeacherAssignmentsLoaded,
  ]);

  useEffect(() => {
    if (!isStudentsTabActive || !editingEnrollmentId || !canManageEnrollments) return;

    if (canReadCourses && !loadingCourses && !hasFullCoursesLoaded) {
      loadCourses();
    }

    if (canReadCampuses && !loadingCampuses && campuses.length === 0) {
      loadCampuses();
    }

    if (canReadPeriods && !loadingPeriods && periods.length === 0) {
      loadPeriods();
    }
  }, [
    campuses.length,
    canManageEnrollments,
    canReadCampuses,
    canReadCourses,
    canReadPeriods,
    editingEnrollmentId,
    hasFullCoursesLoaded,
    isStudentsTabActive,
    loadCampuses,
    loadCourses,
    loadPeriods,
    loadingCampuses,
    loadingCourses,
    loadingPeriods,
    periods.length,
  ]);

  const assignmentByOfferingId = useMemo(() => {
    const map = new Map();
    for (const assignment of teacherAssignments) {
      const key = String(assignment.course_campus_id);
      const current = map.get(key);
      if (!current || (current.status !== 'ACTIVE' && assignment.status === 'ACTIVE')) {
        map.set(key, assignment);
      }
    }
    return map;
  }, [teacherAssignments]);

  const defaultPeriodId = useMemo(() => {
    const activePeriod = periods.find((period) => period.is_active) || periods[0];
    return activePeriod ? String(activePeriod.id) : '';
  }, [periods]);

  const defaultCampusId = useMemo(() => {
    const firstCampus = campuses[0];
    return firstCampus ? String(firstCampus.id) : '';
  }, [campuses]);

  const teachersById = useMemo(() => {
    const map = new Map();
    for (const teacher of teachers) {
      map.set(String(teacher.id), teacher);
    }
    return map;
  }, [teachers]);

  useEffect(() => {
    setCourseForm((prev) => ({
      ...prev,
      campus_id: prev.campus_id || defaultCampusId,
      period_id: prev.period_id || defaultPeriodId,
    }));
  }, [defaultCampusId, defaultPeriodId]);

  const getPrimaryOffering = (course) => (course.offerings || [])[0] || null;

  const filteredCourses = useMemo(() => {
    const term = courseSearchTerm.toLowerCase();
    const filtered = !term
      ? [...courses]
      : courses.filter((course) => {
          const offering = getPrimaryOffering(course);
          const assignment = offering ? assignmentByOfferingId.get(String(offering.offering_id)) : null;
          return `${course.name || ''} ${course.description || ''} ${course.duration_hours || ''} ${offering?.modality || ''} ${
            assignment?.teacher_name || ''
          }`
            .toLowerCase()
            .includes(term);
        });

    if (isRootAdminProfile && !courseCampusFilter) {
      filtered.sort((left, right) => {
        const leftTime = new Date(left.created_at || 0).getTime();
        const rightTime = new Date(right.created_at || 0).getTime();
        return rightTime - leftTime;
      });
    }

    return filtered;
  }, [assignmentByOfferingId, courseCampusFilter, courseSearchTerm, courses, isRootAdminProfile]);

  const filteredCampuses = useMemo(() => {
    const term = deferredCampusSearch.trim().toLowerCase();
    if (!term) return campuses;
    return campuses.filter((campus) =>
      `${campus.name || ''} ${campus.city || ''} ${campus.address || ''} ${campus.phone || ''} ${
        campus.email || ''
      }`
        .toLowerCase()
        .includes(term),
    );
  }, [campuses, deferredCampusSearch]);

  const filteredRecentEnrollments = useMemo(() => {
    const term = enrollmentSearch.trim().toLowerCase();
    if (!term) return recentEnrollments;
    return recentEnrollments.filter((enrollment) =>
      `${enrollment.student_name || ''} ${enrollment.course_name || ''} ${enrollment.campus_name || ''} ${
        enrollment.period_name || ''
      } ${enrollment.status || ''} ${enrollment.enrollment_date || ''} ${enrollment.created_at || ''} ${
        enrollment.created_by_name || ''
      } ${enrollment.schedule_info || ''
      } ${enrollment.notes || ''}`
        .toLowerCase()
        .includes(term),
    );
  }, [enrollmentSearch, recentEnrollments]);

  const enrollmentOfferingOptions = useMemo(() => {
    const options = [];

    for (const course of courses) {
      for (const offering of course.offerings || []) {
        options.push({
          offering_id: Number(offering.offering_id),
          campus_id: Number(offering.campus_id),
          course_name: course.name || '',
          course_description: course.description || '',
          campus_name: offering.campus_name || 'Sin sede',
          modality: offering.modality || 'PRESENCIAL',
          monthly_fee: offering.monthly_fee,
          schedule_info: offering.schedule_info || '',
          schedule_blocks: getScheduleBlocks(offering.schedule_info),
          label: `${course.name} - ${offering.campus_name} (${offering.modality || 'PRESENCIAL'})`,
        });
      }
    }

    return options;
  }, [courses]);

  const enrollmentEditOfferingOptions = useMemo(() => {
    const campusId = String(enrollmentEditForm.campus_id || '');
    const options = enrollmentOfferingOptions.filter(
      (offering) => !campusId || String(offering.campus_id) === campusId,
    );
    const currentOfferingId = String(enrollmentEditForm.original_course_campus_id || '');

    if (currentOfferingId && !options.some((offering) => String(offering.offering_id) === currentOfferingId)) {
      options.unshift({
        offering_id: Number(currentOfferingId),
        campus_id: Number(enrollmentEditForm.campus_id || 0),
        course_name: enrollmentEditForm.course_name || 'Curso actual',
        campus_name: enrollmentEditForm.campus_name || 'Sede actual',
        modality: enrollmentEditForm.modality || 'PRESENCIAL',
        schedule_info: enrollmentEditForm.offering_schedule_info || enrollmentEditForm.schedule_info || '',
        schedule_blocks: getScheduleBlocks(
          enrollmentEditForm.offering_schedule_info || enrollmentEditForm.schedule_info,
        ),
        label: `${enrollmentEditForm.course_name || 'Curso actual'} - ${
          enrollmentEditForm.campus_name || 'Sede actual'
        } (${enrollmentEditForm.modality || 'PRESENCIAL'})`,
      });
    }

    return options;
  }, [
    enrollmentEditForm.campus_id,
    enrollmentEditForm.campus_name,
    enrollmentEditForm.course_name,
    enrollmentEditForm.modality,
    enrollmentEditForm.offering_schedule_info,
    enrollmentEditForm.original_course_campus_id,
    enrollmentEditForm.schedule_info,
    enrollmentOfferingOptions,
  ]);

  const enrollmentCampusOptions = useMemo(() => {
    if (campuses.length > 0) {
      return campuses
        .map((campus) => ({
          id: Number(campus.id),
          name: campus.name || `Sede #${campus.id}`,
        }))
        .filter((campus) => Number.isFinite(campus.id) && campus.id > 0)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' }));
    }

    const map = new Map();
    for (const offering of enrollmentOfferingOptions) {
      const campusId = Number(offering.campus_id || 0);
      if (!campusId || map.has(campusId)) continue;
      map.set(campusId, {
        id: campusId,
        name: offering.campus_name || `Sede #${campusId}`,
      });
    }
    return Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' }));
  }, [campuses, enrollmentOfferingOptions]);

  const teacherAssignmentCampusOptions = useMemo(() => {
    if (campuses.length > 0) {
      return campuses
        .map((campus) => ({
          id: Number(campus.id),
          name: campus.name || `Sede #${campus.id}`,
        }))
        .filter((campus) => Number.isFinite(campus.id) && campus.id > 0)
        .sort((left, right) => String(left.name).localeCompare(String(right.name), 'es', { sensitivity: 'base' }));
    }

    return enrollmentCampusOptions;
  }, [campuses, enrollmentCampusOptions]);

  const effectiveTeacherAssignmentCampusId = canSelectTeacherCampus
    ? String(teacherForm.assignment_campus_id || '')
    : String(teacherForm.assignment_campus_id || teacherForm.base_campus_id || defaultTeacherCampusId || defaultCampusId || '');

  const filteredTeacherAssignmentOfferingOptions = useMemo(() => {
    if (!effectiveTeacherAssignmentCampusId) {
      return canSelectTeacherCampus ? [] : enrollmentOfferingOptions;
    }

    return enrollmentOfferingOptions.filter(
      (offering) => String(offering.campus_id) === String(effectiveTeacherAssignmentCampusId),
    );
  }, [canSelectTeacherCampus, effectiveTeacherAssignmentCampusId, enrollmentOfferingOptions]);

  const selectedTeacherAssignmentOffering = useMemo(
    () =>
      filteredTeacherAssignmentOfferingOptions.find(
        (offering) => String(offering.offering_id) === String(teacherForm.assignment_course_campus_id),
      ) || null,
    [filteredTeacherAssignmentOfferingOptions, teacherForm.assignment_course_campus_id],
  );

  const teacherAssignmentRequiresCampusOverrideReason =
    Boolean(teacherForm.base_campus_id) &&
    Boolean(selectedTeacherAssignmentOffering?.campus_id) &&
    Number(teacherForm.base_campus_id) !== Number(selectedTeacherAssignmentOffering.campus_id);

  useEffect(() => {
    if (!isTeachersTabActive || !showTeacherForm || editingTeacherId || !canManageAssignments) return;

    const nextCampusId = teacherForm.base_campus_id || defaultTeacherCampusId || defaultCampusId;
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
  }, [
    canManageAssignments,
    defaultCampusId,
    defaultPeriodId,
    defaultTeacherCampusId,
    editingTeacherId,
    isTeachersTabActive,
    showTeacherForm,
    teacherForm.base_campus_id,
  ]);

  useEffect(() => {
    if (!teacherForm.assignment_course_campus_id) return;
    if (
      filteredTeacherAssignmentOfferingOptions.some(
        (offering) => String(offering.offering_id) === String(teacherForm.assignment_course_campus_id),
      )
    ) {
      return;
    }

    setTeacherForm((prev) => ({
      ...prev,
      assignment_course_campus_id: '',
      assignment_campus_override_reason: '',
    }));
  }, [filteredTeacherAssignmentOfferingOptions, teacherForm.assignment_course_campus_id]);

  useEffect(() => {
    if (teacherAssignmentRequiresCampusOverrideReason || !teacherForm.assignment_campus_override_reason) return;
    setTeacherForm((prev) => ({ ...prev, assignment_campus_override_reason: '' }));
  }, [teacherAssignmentRequiresCampusOverrideReason, teacherForm.assignment_campus_override_reason]);

  const lockedEnrollmentCampusId = useMemo(() => {
    if (canSelectEnrollmentCampus) return '';
    if (user?.base_campus_id) return String(user.base_campus_id);
    return defaultCampusId;
  }, [canSelectEnrollmentCampus, defaultCampusId, user?.base_campus_id]);

  const effectiveEnrollmentCampusId = canSelectEnrollmentCampus
    ? String(studentForm.enrollment_campus_id || '')
    : String(studentForm.enrollment_campus_id || lockedEnrollmentCampusId || '');

  const filteredEnrollmentOfferingOptions = useMemo(() => {
    if (!effectiveEnrollmentCampusId) {
      return canSelectEnrollmentCampus ? [] : enrollmentOfferingOptions;
    }

    return enrollmentOfferingOptions.filter(
      (offering) => String(offering.campus_id) === String(effectiveEnrollmentCampusId),
    );
  }, [canSelectEnrollmentCampus, effectiveEnrollmentCampusId, enrollmentOfferingOptions]);

  const selectedEnrollmentOffering = useMemo(
    () =>
      enrollmentOfferingOptions.find(
        (offering) => String(offering.offering_id) === String(studentForm.course_campus_id),
      ) || null,
    [enrollmentOfferingOptions, studentForm.course_campus_id],
  );

  const getDefaultScheduleInfoForOfferingId = useCallback(
    (offeringId, options = enrollmentOfferingOptions) => {
      const offering = options.find((item) => String(item.offering_id) === String(offeringId));
      return getDefaultScheduleInfoFromBlocks(offering?.schedule_blocks || []);
    },
    [enrollmentOfferingOptions],
  );

  const selectedEnrollmentScheduleBlocks = selectedEnrollmentOffering?.schedule_blocks || [];

  const selectedEnrollmentEditOffering = useMemo(
    () =>
      enrollmentEditOfferingOptions.find(
        (offering) => String(offering.offering_id) === String(enrollmentEditForm.course_campus_id),
      ) || null,
    [enrollmentEditForm.course_campus_id, enrollmentEditOfferingOptions],
  );

  const selectedEnrollmentEditScheduleBlocks = selectedEnrollmentEditOffering?.schedule_blocks || [];

  const selectedEnrollmentAssignment = useMemo(
    () => assignmentByOfferingId.get(String(studentForm.course_campus_id)) || null,
    [assignmentByOfferingId, studentForm.course_campus_id],
  );

  const selectedEnrollmentPeriodName = useMemo(() => {
    const selectedPeriod = periods.find((period) => String(period.id) === String(studentForm.period_id));
    if (selectedPeriod?.name) return selectedPeriod.name;
    return selectedEnrollmentAssignment?.period_name || '-';
  }, [periods, selectedEnrollmentAssignment?.period_name, studentForm.period_id]);

  const selectedEnrollmentCampusName = useMemo(() => {
    if (effectiveEnrollmentCampusId) {
      const fromCatalog = campuses.find(
        (campus) => String(campus.id) === String(effectiveEnrollmentCampusId),
      );
      if (fromCatalog?.name) return fromCatalog.name;

      const fromOptions = enrollmentCampusOptions.find(
        (campus) => String(campus.id) === String(effectiveEnrollmentCampusId),
      );
      if (fromOptions?.name) return fromOptions.name;
    }

    if (selectedEnrollmentOffering?.campus_name) return selectedEnrollmentOffering.campus_name;
    return '-';
  }, [campuses, effectiveEnrollmentCampusId, enrollmentCampusOptions, selectedEnrollmentOffering?.campus_name]);

  const shouldShowTeacherCampusField = canSelectTeacherCampus || Boolean(teacherForm.base_campus_id);
  const teacherCampusDisplayName = useMemo(() => {
    const currentCampusId = String(teacherForm.base_campus_id || '');
    if (!currentCampusId) return 'Sin sede base asignada';

    const matchedCampus = campuses.find((campus) => String(campus.id) === currentCampusId);
    if (matchedCampus?.name) return matchedCampus.name;
    if (currentCampusId === String(defaultTeacherCampusId || '')) return 'Sede del usuario actual';
    return `Sede #${currentCampusId}`;
  }, [campuses, defaultTeacherCampusId, teacherForm.base_campus_id]);

  const normalizedInstallmentsCount = useMemo(
    () => normalizeInstallmentsCount(studentForm.installments_count),
    [studentForm.installments_count],
  );

  const plannedInstallmentsVariableTotal = useMemo(() => {
    if (!studentForm.use_variable_installments) return 0;
    const plan = Array.isArray(studentForm.installment_plan) ? studentForm.installment_plan : [];
    return plan.slice(0, normalizedInstallmentsCount).reduce((sum, amountValue) => {
      const amount = Number(amountValue);
      return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
    }, 0);
  }, [normalizedInstallmentsCount, studentForm.installment_plan, studentForm.use_variable_installments]);

  const plannedInstallmentsFixedTotal = useMemo(
    () => normalizedInstallmentsCount * Number(studentForm.installment_amount || 0),
    [normalizedInstallmentsCount, studentForm.installment_amount],
  );

  const plannedInstallmentsTotal = studentForm.use_variable_installments
    ? plannedInstallmentsVariableTotal
    : plannedInstallmentsFixedTotal;

  const plannedEnrollmentTotal = Number(studentForm.enrollment_fee_amount || 0) + plannedInstallmentsTotal;
  const studentAgeLabel = useMemo(
    () => formatAgeLabel(calculateAgeFromBirthDate(studentForm.birth_date)),
    [studentForm.birth_date],
  );

  const conceptIdsByName = useMemo(() => {
    const byName = {};
    for (const concept of paymentConcepts) {
      const key = String(concept.name || '').trim().toUpperCase();
      if (key && !byName[key]) {
        byName[key] = Number(concept.id);
      }
    }
    return byName;
  }, [paymentConcepts]);

  const enrollmentFeeConceptId = conceptIdsByName.MATRICULA || null;
  const installmentConceptId = conceptIdsByName.MENSUALIDAD || null;

  useEffect(() => {
    if (!showStudentForm || editingStudentId || studentForm.period_id || !defaultPeriodId) return;

    setStudentForm((prev) =>
      prev.period_id ? prev : { ...prev, period_id: String(defaultPeriodId) },
    );
  }, [
    defaultPeriodId,
    editingStudentId,
    showStudentForm,
    studentForm.period_id,
  ]);

  useEffect(() => {
    if (editingStudentId) return;
    if (!selectedEnrollmentOffering) return;

    const referenceFee =
      selectedEnrollmentOffering.monthly_fee === null || selectedEnrollmentOffering.monthly_fee === undefined
        ? ''
        : String(selectedEnrollmentOffering.monthly_fee);

    setStudentForm((prev) => {
      if (String(prev.course_campus_id) !== String(selectedEnrollmentOffering.offering_id)) {
        return prev;
      }

      return {
        ...prev,
        enrollment_fee_amount: referenceFee,
        installment_amount: prev.installment_amount || referenceFee,
      };
    });
  }, [editingStudentId, selectedEnrollmentOffering]);

  useEffect(() => {
    if (editingStudentId || !canManageEnrollments) return;

    const preferredCampusId = canSelectEnrollmentCampus
      ? String(studentForm.enrollment_campus_id || '')
      : String(lockedEnrollmentCampusId || '');

    const validOfferingIds =
      canSelectEnrollmentCampus && !preferredCampusId
        ? new Set()
        : new Set(
            enrollmentOfferingOptions
              .filter((offering) =>
                !preferredCampusId ? true : String(offering.campus_id) === String(preferredCampusId),
              )
              .map((offering) => String(offering.offering_id)),
          );

    setStudentForm((prev) => {
      const nextCampusId = preferredCampusId;
      const currentCampusId = String(prev.enrollment_campus_id || '');
      const currentCourseId = String(prev.course_campus_id || '');
      const keepSelectedCourse = !currentCourseId || validOfferingIds.has(currentCourseId);
      const nextCourseId = keepSelectedCourse ? prev.course_campus_id : '';
      const nextScheduleInfo = keepSelectedCourse ? prev.schedule_info : '';

      if (
        currentCampusId === nextCampusId &&
        currentCourseId === String(nextCourseId || '') &&
        prev.schedule_info === nextScheduleInfo
      ) {
        return prev;
      }

      return {
        ...prev,
        enrollment_campus_id: nextCampusId,
        course_campus_id: nextCourseId,
        schedule_info: nextScheduleInfo,
      };
    });
  }, [
    canManageEnrollments,
    canSelectEnrollmentCampus,
    editingStudentId,
    enrollmentOfferingOptions,
    lockedEnrollmentCampusId,
    studentForm.enrollment_campus_id,
  ]);

  useEffect(() => {
    if (editingStudentId || !canManageEnrollments) return;

    setStudentForm((prev) => {
      if (!prev.course_campus_id) {
        return prev.schedule_info ? { ...prev, schedule_info: '' } : prev;
      }

      const selectedOffering = enrollmentOfferingOptions.find(
        (offering) => String(offering.offering_id) === String(prev.course_campus_id),
      );
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
  }, [
    canManageEnrollments,
    editingStudentId,
    enrollmentOfferingOptions,
    studentForm.course_campus_id,
  ]);

  useEffect(() => {
    if (editingStudentId) return;
    if (!studentForm.use_variable_installments) return;

    setStudentForm((prev) => {
      if (!prev.use_variable_installments) return prev;
      const count = normalizeInstallmentsCount(prev.installments_count);
      const currentPlan = Array.isArray(prev.installment_plan) ? prev.installment_plan : [];
      const fallbackAmount = prev.installment_amount || '';
      const nextPlan = Array.from({ length: count }, (_, index) => currentPlan[index] ?? fallbackAmount);

      const sameLength = currentPlan.length === nextPlan.length;
      const sameValues =
        sameLength &&
        currentPlan.every((amountValue, index) => String(amountValue ?? '') === String(nextPlan[index] ?? ''));

      if (sameValues) return prev;

      return {
        ...prev,
        installment_plan: nextPlan,
      };
    });
  }, [
    editingStudentId,
    studentForm.installment_amount,
    studentForm.installments_count,
    studentForm.use_variable_installments,
  ]);

  const resetStudentForm = () => {
    setStudentForm(createStudentDefaults());
    setEditingStudentId(null);
    setShowStudentForm(false);
  };

  const resetEnrollmentEdit = () => {
    setEnrollmentEditForm(createEnrollmentEditDefaults());
    setEditingEnrollmentId(null);
  };

  const toggleVariableInstallments = (enabled) => {
    setStudentForm((prev) => {
      const count = normalizeInstallmentsCount(prev.installments_count);
      const baseAmount = prev.installment_amount || '';
      return {
        ...prev,
        use_variable_installments: enabled,
        installment_plan: enabled
          ? Array.from(
              { length: count },
              (_, index) => (Array.isArray(prev.installment_plan) ? prev.installment_plan[index] : null) ?? baseAmount,
            )
          : [],
      };
    });
  };

  const updateInstallmentPlanAmount = (index, nextAmount) => {
    setStudentForm((prev) => {
      const currentPlan = Array.isArray(prev.installment_plan) ? [...prev.installment_plan] : [];
      currentPlan[index] = nextAmount;
      return {
        ...prev,
        installment_plan: currentPlan,
      };
    });
  };

  const copyBaseAmountToInstallmentPlan = () => {
    setStudentForm((prev) => {
      if (!prev.use_variable_installments) return prev;
      const count = normalizeInstallmentsCount(prev.installments_count);
      const baseAmount = prev.installment_amount || '';
      return {
        ...prev,
        installment_plan: Array.from({ length: count }, () => baseAmount),
      };
    });
  };

  const resetTeacherForm = () => {
    setTeacherForm(createTeacherFormDefaults());
    setEditingTeacherId(null);
    setShowTeacherForm(false);
  };

  const resetCourseForm = () => {
    setCourseForm({
      ...createCourseDefaults(),
      campus_id: defaultCampusId,
      period_id: defaultPeriodId,
    });
    setEditingCourseId(null);
    setShowCourseForm(false);
  };

  const resetCampusForm = () => {
    setCampusForm({
      ...campusDefaults,
      registration_date: getTodayIsoDate(),
    });
    setEditingCampusId(null);
    setShowCampusForm(false);
  };

  const resetPeriodForm = () => {
    setPeriodForm(createPeriodDefaults());
    setShowPeriodForm(false);
  };

  const submitStudent = async (event) => {
    event.preventDefault();
    if (!canManageStudents) return;

    setSaving(true);

    try {
      const payload = {
        first_name: studentForm.first_name.trim(),
        last_name: studentForm.last_name.trim(),
        document_number: buildDocumentValue(studentForm.document_type, studentForm.document_number),
        birth_date: studentForm.birth_date,
        email: normalizeOptional(studentForm.email),
        phone: normalizeOptional(studentForm.phone),
        address: normalizeOptional(studentForm.address),
        notes: normalizeOptional(studentForm.notes),
      };

      if (editingStudentId) {
        const accessUserId = Number(studentForm.access_user_id || 0);
        const nextAccessStatus = Boolean(studentForm.access_is_active);
        const originalAccessStatus = Boolean(studentForm.access_original_is_active);
        const nextAccessPassword = String(studentForm.access_password || '').trim();
        let updatedAccess = false;

        if (nextAccessPassword && nextAccessPassword.length < 8) {
          throw new Error('La nueva contraseña del alumno debe tener al menos 8 caracteres.');
        }

        await api.put(`/students/${editingStudentId}`, payload);

        if (canManageStudentAccess && accessUserId) {
          if (nextAccessPassword) {
            await api.patch(`/users/${accessUserId}/credentials`, { password: nextAccessPassword });
            updatedAccess = true;
          }

          if (nextAccessStatus !== originalAccessStatus) {
            await api.patch(`/users/${accessUserId}/status`, { is_active: nextAccessStatus });
            updatedAccess = true;
          }
        }

        toast.success(updatedAccess ? 'Alumno y acceso actualizados correctamente.' : 'Alumno actualizado correctamente.');
      } else {
        payload.no_guardian = Boolean(studentForm.no_guardian);

        if (!payload.no_guardian) {
          const guardianFirstName = studentForm.guardian_first_name.trim();
          const guardianLastName = studentForm.guardian_last_name.trim();
          const guardianEmail = studentForm.guardian_email.trim();
          const guardianPhone = studentForm.guardian_phone.trim();
          const guardianDocumentNumber = studentForm.guardian_document_number.trim();

          if (!guardianFirstName || !guardianLastName) {
            throw new Error('Debes registrar nombres y apellidos del apoderado o marcar "Sin apoderado".');
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

        const useVariableInstallments = Boolean(studentForm.use_variable_installments);
        let parsedInstallmentPlan = [];

        if (canManageEnrollments) {
          if (canSelectEnrollmentCampus && !studentForm.enrollment_campus_id) {
            throw new Error('Selecciona la sede antes de elegir el curso para la matrícula.');
          }

          if (!studentForm.course_campus_id) {
            throw new Error('Selecciona el curso al que se matriculará el alumno.');
          }

          const selectedOffering = enrollmentOfferingOptions.find(
            (offering) => String(offering.offering_id) === String(studentForm.course_campus_id),
          );
          if (
            selectedOffering &&
            effectiveEnrollmentCampusId &&
            String(selectedOffering.campus_id) !== String(effectiveEnrollmentCampusId)
          ) {
            throw new Error('El curso seleccionado no pertenece a la sede elegida.');
          }

          const scheduleBlocks = selectedOffering?.schedule_blocks || [];
          if (scheduleBlocks.length > 1 && !studentForm.schedule_info) {
            throw new Error('Selecciona el bloque horario para la matrícula.');
          }

          if (
            studentForm.schedule_info &&
            scheduleBlocks.length > 0 &&
            !scheduleBlocks.includes(studentForm.schedule_info)
          ) {
            throw new Error('El bloque horario seleccionado no pertenece al curso elegido.');
          }

          const parsedEnrollmentFeeAmount = Number(studentForm.enrollment_fee_amount || 0);
          if (!Number.isFinite(parsedEnrollmentFeeAmount) || parsedEnrollmentFeeAmount < 0) {
            throw new Error('El importe de matrícula debe ser un número válido mayor o igual a 0.');
          }

          const parsedInstallmentsCount = Number(studentForm.installments_count || 0);
          if (
            !Number.isInteger(parsedInstallmentsCount) ||
            parsedInstallmentsCount < 0 ||
            parsedInstallmentsCount > 24
          ) {
            throw new Error('La cantidad de cuotas debe estar entre 0 y 24.');
          }

          const parsedInstallmentAmount = Number(studentForm.installment_amount || 0);
          if (parsedInstallmentsCount > 0) {
            if (useVariableInstallments) {
              const rawPlan = Array.isArray(studentForm.installment_plan) ? studentForm.installment_plan : [];
              if (rawPlan.length < parsedInstallmentsCount) {
                throw new Error('Debes completar el monto de todas las cuotas configuradas.');
              }

              parsedInstallmentPlan = rawPlan.slice(0, parsedInstallmentsCount).map((amountValue, index) => {
                const normalizedAmount = Number(amountValue);
                if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
                  throw new Error(`Ingresa un monto válido para la cuota ${index + 1}.`);
                }
                return normalizedAmount;
              });
            } else if (!Number.isFinite(parsedInstallmentAmount) || parsedInstallmentAmount <= 0) {
              throw new Error('Ingresa un monto válido para las cuotas.');
            }
          }

          const resolvedPeriodId = Number(studentForm.period_id || defaultPeriodId);
          if (!resolvedPeriodId) {
            throw new Error('No se encontró un periodo válido para la matrícula.');
          }

          payload.enrollment = {
            course_campus_id: Number(studentForm.course_campus_id),
            period_id: resolvedPeriodId,
            enrollment_date: studentForm.enrollment_date || getTodayIsoDate(),
            schedule_info: studentForm.schedule_info || null,
            status: 'ACTIVE',
            notes: normalizeOptional(studentForm.enrollment_notes),
          };
        }

        const createResponse = await api.post('/students', payload);
        const createdEnrollmentId = Number(createResponse.data?.item?.enrollment?.id || 0);

        const enrollmentFeeAmount = Number(studentForm.enrollment_fee_amount || 0);
        const installmentsCount = normalizeInstallmentsCount(studentForm.installments_count);
        const installmentAmount = Number(studentForm.installment_amount || 0);
        const installmentPlan = parsedInstallmentPlan;
        const baseEnrollmentDate = studentForm.enrollment_date || getTodayIsoDate();
        const firstInstallmentDueDate = studentForm.first_installment_due_date || baseEnrollmentDate;

        let generatedInstallments = 0;
        let financeWarning = '';

        if (createdEnrollmentId && canManageInstallments && (enrollmentFeeAmount > 0 || installmentsCount > 0)) {
          try {
            if (enrollmentFeeAmount > 0) {
              if (!enrollmentFeeConceptId) {
                throw new Error('No se encontró el concepto de pago "MATRICULA".');
              }

              await api.post(`/enrollments/${createdEnrollmentId}/installments`, {
                concept_id: enrollmentFeeConceptId,
                due_date: baseEnrollmentDate,
                total_amount: enrollmentFeeAmount,
                description: 'Pago de matrícula',
              });
              generatedInstallments += 1;
            }

            if (installmentsCount > 0) {
              if (!installmentConceptId) {
                throw new Error('No se encontró el concepto de pago "MENSUALIDAD".');
              }

              for (let index = 0; index < installmentsCount; index += 1) {
                const installmentAmountValue = useVariableInstallments
                  ? installmentPlan[index]
                  : installmentAmount;
                await api.post(`/enrollments/${createdEnrollmentId}/installments`, {
                  concept_id: installmentConceptId,
                  due_date: addMonthsToIsoDate(firstInstallmentDueDate, index),
                  total_amount: installmentAmountValue,
                  description: `Cuota ${index + 1} de ${installmentsCount}`,
                });
                generatedInstallments += 1;
              }
            }
          } catch (financeError) {
            financeWarning =
              financeError.response?.data?.message ||
              financeError.message ||
              'No se pudo generar el plan de pagos automático.';
          }
        }

        if (createdEnrollmentId && !canManageInstallments && (enrollmentFeeAmount > 0 || installmentsCount > 0)) {
          financeWarning = 'Matrícula creada sin cuotas: tu usuario no tiene permisos para crear cuotas.';
        }

        if (financeWarning) {
          toast.error(financeWarning);
        }

        toast.success(
          `Alumno creado correctamente${payload.no_guardian ? ' sin apoderado' : ''}.${
            generatedInstallments > 0 ? ` Se generaron ${generatedInstallments} cobro(s).` : ''
          }`,
        );
      }

      resetStudentForm();
      await Promise.all([
        loadStudents({
          search: studentSearch.trim(),
          page: studentPage,
          pageSize: STUDENT_PAGE_SIZE,
        }),
        loadRecentEnrollments(),
      ]);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || requestError.message || 'No se pudo guardar el alumno.');
    } finally {
      setSaving(false);
    }
  };

  const submitEnrollmentEdit = async (event) => {
    event.preventDefault();
    if (!canManageEnrollments || !editingEnrollmentId) return;

    if (!enrollmentEditForm.course_campus_id) {
      toast.error('Selecciona el curso de la matrícula.');
      return;
    }

    if (!enrollmentEditForm.period_id) {
      toast.error('Selecciona el periodo de la matrícula.');
      return;
    }

    if (selectedEnrollmentEditScheduleBlocks.length > 1 && !enrollmentEditForm.schedule_info) {
      toast.error('Selecciona el bloque horario de la matrícula.');
      return;
    }

    setSaving(true);
    try {
      await api.put(`/enrollments/${editingEnrollmentId}`, {
        course_campus_id: Number(enrollmentEditForm.course_campus_id),
        period_id: Number(enrollmentEditForm.period_id),
        enrollment_date: enrollmentEditForm.enrollment_date || getTodayIsoDate(),
        status: enrollmentEditForm.status,
        schedule_info: enrollmentEditForm.schedule_info || null,
        notes: normalizeOptional(enrollmentEditForm.notes),
      });

      toast.success('Matrícula actualizada correctamente.');
      resetEnrollmentEdit();
      await loadRecentEnrollments();
    } catch (requestError) {
      toast.error(
        requestError.response?.data?.message ||
          requestError.message ||
          'No se pudo actualizar la matrícula.',
      );
    } finally {
      setSaving(false);
    }
  };

  const editEnrollment = (enrollment) => {
    if (!canManageEnrollments || String(enrollment.status || '').toUpperCase() === 'TRANSFERRED') return;

    const hasPayments = Boolean(enrollment.has_payments);
    const hasAcademicActivity = Boolean(enrollment.has_academic_activity);
    const hasPendingTransfer = Boolean(enrollment.has_pending_transfer);
    const blockerLabels = [];
    if (hasPayments) blockerLabels.push('pagos emitidos');
    if (hasAcademicActivity) blockerLabels.push('actividad académica');
    if (hasPendingTransfer) blockerLabels.push('un traslado pendiente');

    resetStudentForm();
    setEditingEnrollmentId(Number(enrollment.id));
    setEnrollmentEditForm({
      student_name: enrollment.student_name || '',
      campus_id: String(enrollment.campus_id || ''),
      campus_name: enrollment.campus_name || '',
      course_campus_id: String(enrollment.course_campus_id || ''),
      original_course_campus_id: String(enrollment.course_campus_id || ''),
      course_name: enrollment.course_name || '',
      modality: enrollment.modality || 'PRESENCIAL',
      schedule_info: enrollment.schedule_info || '',
      offering_schedule_info: enrollment.offering_schedule_info || enrollment.schedule_info || '',
      period_id: String(enrollment.period_id || ''),
      original_period_id: String(enrollment.period_id || ''),
      enrollment_date: toInputDate(enrollment.enrollment_date),
      status: enrollment.status || 'ACTIVE',
      notes: enrollment.notes || '',
      course_change_locked: blockerLabels.length > 0,
      course_change_reason: blockerLabels.join(', '),
    });
  };

  const editStudent = (student) => {
    if (!canManageStudents) return;
    resetEnrollmentEdit();
    const parsedDocument = parseDocumentValue(student.document_number);
    setEditingStudentId(student.id);
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
      guardian_first_name: '',
      guardian_last_name: '',
      guardian_email: '',
      guardian_phone: '',
      guardian_document_number: '',
      enrollment_campus_id: '',
      course_campus_id: '',
      schedule_info: '',
      period_id: defaultPeriodId,
      enrollment_date: getTodayIsoDate(),
      enrollment_notes: '',
      enrollment_fee_amount: '',
      installments_count: '4',
      installment_amount: '',
      first_installment_due_date: getTodayIsoDate(),
      use_variable_installments: false,
      installment_plan: [],
      access_user_id: student.user_id ? String(student.user_id) : '',
      access_is_active: student.access_is_active !== false,
      access_original_is_active: student.access_is_active !== false,
      access_password: '',
    });
    setShowStudentForm(true);
  };

  const deleteStudent = async (student) => {
    if (!canManageStudents) return;
    const confirmed = await confirm({
      title: 'Eliminar alumno',
      message: `¿Estás seguro de que deseas eliminar permanentemente a ${student.first_name} ${student.last_name}?`,
      confirmText: 'Eliminar',
      type: 'danger',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await api.delete(`/students/${student.id}`);
      toast.success('Alumno eliminado correctamente.');
      if (editingStudentId === student.id) resetStudentForm();
      await loadStudents();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'No se pudo eliminar al alumno.');
    } finally {
      setSaving(false);
    }
  };

  const openStudentTransferFlow = useCallback(() => {
    if (!canManageTransfers || !editingStudentId) return;
    const transferRequestToken = `${editingStudentId}:${Date.now()}`;

    navigate('/students', {
      state: {
        transferStudent: {
          id: editingStudentId,
          first_name: studentForm.first_name,
          last_name: studentForm.last_name,
        },
        transferRequestToken,
      },
    });
  }, [canManageTransfers, editingStudentId, navigate, studentForm.first_name, studentForm.last_name]);

  const submitTeacher = async (event) => {
    event.preventDefault();
    if (!canCreateTeachers && !canManageTeacherProfile) return;

    setSaving(true);

    const normalizedEmail = teacherForm.email.trim().toLowerCase();
    const useEmailAsPassword = !editingTeacherId && Boolean(teacherForm.use_email_as_password);
    const resolvedPassword = useEmailAsPassword ? normalizedEmail : teacherForm.password;
    const shouldCreateInitialAssignment =
      !editingTeacherId && canManageAssignments && Boolean(teacherForm.create_initial_assignment);

    if (useEmailAsPassword && normalizedEmail.length < 8) {
      toast.error('El correo debe tener al menos 8 caracteres para usarlo como contraseña temporal.');
      setSaving(false);
      return;
    }

    if (!editingTeacherId && !useEmailAsPassword && teacherForm.password.trim().length < 8) {
      toast.error('La contraseña del docente debe tener al menos 8 caracteres.');
      setSaving(false);
      return;
    }

    if (shouldCreateInitialAssignment) {
      if (!effectiveTeacherAssignmentCampusId) {
        toast.error('Selecciona la sede donde el docente dictará su curso inicial.');
        setSaving(false);
        return;
      }

      if (!teacherForm.assignment_course_campus_id) {
        toast.error('Selecciona el curso que dictará el docente.');
        setSaving(false);
        return;
      }

      if (!teacherForm.assignment_period_id) {
        toast.error('Selecciona el periodo académico de la asignación inicial.');
        setSaving(false);
        return;
      }

      if (teacherAssignmentRequiresCampusOverrideReason && !teacherForm.assignment_campus_override_reason.trim()) {
        toast.error('Indica el motivo si el curso inicial se dictará en una sede distinta a la sede base del docente.');
        setSaving(false);
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

        toast.success('Docente actualizado correctamente.');
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
                  campus_override_reason: teacherAssignmentRequiresCampusOverrideReason
                    ? teacherForm.assignment_campus_override_reason.trim()
                    : null,
                },
              }
            : {}),
        });
        toast.success(
          shouldCreateInitialAssignment
            ? 'Docente y asignación inicial guardados correctamente.'
            : 'Docente creado correctamente.',
        );
      }

      resetTeacherForm();
      await loadTeachers({
        search: deferredTeacherSearch.trim(),
        page: teacherPage,
        pageSize: teacherPageSize,
        paginate: true,
      });
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'No se pudo guardar el docente.');
    } finally {
      setSaving(false);
    }
  };

  const editTeacher = (teacher) => {
    if (!canManageTeacherProfile) return;
    const parsedDocument = parseDocumentValue(teacher.document_number);
    setEditingTeacherId(teacher.id);
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
    setShowTeacherForm(true);
  };

  const setTeacherStatus = async (teacher, nextStatus) => {
    if (!canManageTeacherProfile) return;
    const actionLabel = nextStatus ? 'activar' : 'desactivar';
    const confirmed = await confirm({
      title: `${nextStatus ? 'Activar' : 'Desactivar'} docente`,
      message: `¿Estás seguro de que deseas ${actionLabel} al docente ${teacher.first_name} ${teacher.last_name}?`,
      confirmText: nextStatus ? 'Activar' : 'Desactivar',
      type: nextStatus ? 'primary' : 'warning',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await api.patch(`/teachers/${teacher.id}/status`, { is_active: nextStatus });
      toast.success(`Docente ${nextStatus ? 'activado' : 'desactivado'} correctamente.`);
      await loadTeachers();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || `No se pudo ${actionLabel} al docente.`);
    } finally {
      setSaving(false);
    }
  };

  const submitCampus = async (event) => {
    event.preventDefault();
    if (!canManageCampuses) return;

    setSaving(true);
    try {
      const payload = {
        name: campusForm.name.trim(),
        address: campusForm.address.trim(),
        city: campusForm.city.trim(),
        phone: normalizeOptional(campusForm.phone),
        email: normalizeOptional(campusForm.email),
      };

      if (editingCampusId) {
        await api.put(`/campuses/${editingCampusId}`, payload);
        toast.success('Sede actualizada correctamente.');
      } else {
        await api.post('/campuses', {
          ...payload,
          registration_date: campusForm.registration_date || getTodayIsoDate(),
        });
        toast.success('Sede creada correctamente.');
      }

      resetCampusForm();
      await loadCampuses();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'No se pudo guardar la sede.');
    } finally {
      setSaving(false);
    }
  };

  const submitPeriod = async (event) => {
    event.preventDefault();
    if (!canManagePeriods) return;

    setSaving(true);
    try {
      await api.post('/catalogs/periods', {
        ...periodForm,
        is_active: true,
      });
      resetPeriodForm();
      toast.success('Periodo creado correctamente.');
      await loadPeriods();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'No se pudo guardar el periodo.');
    } finally {
      setSaving(false);
    }
  };

  const editCampus = (campus) => {
    if (!canManageCampuses) return;
    setEditingCampusId(campus.id);
    setCampusForm({
      name: campus.name || '',
      address: campus.address || '',
      city: campus.city || '',
      phone: campus.phone || '',
      email: campus.email || '',
      registration_date: toInputDate(campus.created_at),
    });
    setShowCampusForm(true);
  };

  const deleteCampus = async (campus) => {
    if (!canManageCampuses) return;
    const confirmed = await confirm({
      title: 'Eliminar sede',
      message: `¿Estás seguro de que deseas eliminar la sede "${campus.name}"? Esta acción podría fallar si hay registros asociados.`,
      confirmText: 'Eliminar',
      type: 'danger',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await api.delete(`/campuses/${campus.id}`);
      toast.success('Sede eliminada correctamente.');
      if (editingCampusId === campus.id) resetCampusForm();
      await loadCampuses();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'No se pudo eliminar la sede.');
    } finally {
      setSaving(false);
    }
  };

  const submitCourse = async (event) => {
    event.preventDefault();
    if (!canManageCourses) return;

    setSaving(true);

    try {
      const allowWithoutTeacher = Boolean(courseForm.allow_without_teacher);
      if (!Array.isArray(courseForm.schedules) || courseForm.schedules.length === 0) {
        throw new Error('Debes configurar al menos un horario para el curso.');
      }

      for (const [index, schedule] of courseForm.schedules.entries()) {
        const startMin = timeToMinutes(schedule.start);
        const endMin = timeToMinutes(schedule.end);
        if (startMin === null || endMin === null || endMin <= startMin) {
          throw new Error(`El horario del Bloque #${index + 1} no es válido. Revisa hora inicio y hora fin.`);
        }
        if (!Array.isArray(schedule.days) || schedule.days.length === 0) {
          throw new Error(`Selecciona al menos un día para el Bloque #${index + 1}.`);
        }
      }

      if (!courseForm.campus_id) {
        throw new Error('Selecciona una sede para el curso.');
      }

      if (!allowWithoutTeacher && !courseForm.teacher_user_id) {
        throw new Error('Selecciona el docente que dictará el curso.');
      }

      const normalizedPeriodId = Number(courseForm.period_id || defaultPeriodId);
      if (!normalizedPeriodId) {
        throw new Error('No se encontró un periodo académico activo para vincular el curso.');
      }

      const normalizedFee = Number(courseForm.monthly_fee);
      if (!Number.isFinite(normalizedFee) || normalizedFee < 0) {
        throw new Error('Ingresa un importe válido para el curso.');
      }

      const scheduleInfo = getCourseScheduleInfo(courseForm.schedules);

      const coursePayload = {
        name: courseForm.name.trim(),
        description: normalizeOptional(courseForm.description),
        duration_hours: Number(courseForm.duration_hours),
        passing_grade: Number(courseForm.passing_grade),
        is_active: Boolean(courseForm.is_active),
      };

      let courseId = editingCourseId ? Number(editingCourseId) : null;

      if (editingCourseId) {
        await api.put(`/courses/${editingCourseId}`, coursePayload);
      } else {
        const createdCourse = await api.post('/courses', coursePayload);
        courseId = Number(createdCourse.data?.item?.id);
      }

      if (!courseId) {
        throw new Error('No se pudo identificar el curso guardado.');
      }

      const offeringPayload = {
        campus_id: Number(courseForm.campus_id),
        modality: courseForm.modality,
        monthly_fee: normalizedFee,
        capacity: normalizeOptional(courseForm.capacity) ? Number(courseForm.capacity) : null,
        schedule_info: scheduleInfo,
        is_active: Boolean(courseForm.is_active),
      };

      let offeringId = Number(courseForm.offering_id || 0);
      if (offeringId) {
        await api.put(`/courses/offerings/${offeringId}`, offeringPayload);
      } else {
        const createdOffering = await api.post(`/courses/${courseId}/offerings`, offeringPayload);
        offeringId = Number(createdOffering.data?.item?.id);
      }

      if (!offeringId) {
        throw new Error('No se pudo guardar la oferta del curso.');
      }

      const existingAssignment = assignmentByOfferingId.get(String(offeringId)) || null;
      if (!allowWithoutTeacher || existingAssignment) {
        if (!canManageAssignments) {
          throw new Error('No tienes permiso para administrar la asignación docente de este curso.');
        }

        if (allowWithoutTeacher) {
          if (existingAssignment && existingAssignment.status !== 'INACTIVE') {
            await api.patch(`/teachers/assignments/${existingAssignment.id}`, { status: 'INACTIVE' });
          }
        } else {
          const teacherUserId = Number(courseForm.teacher_user_id);
          const assignmentStatus = courseForm.is_active ? 'ACTIVE' : 'INACTIVE';

          if (
            existingAssignment &&
            Number(existingAssignment.teacher_user_id) === teacherUserId &&
            Number(existingAssignment.period_id) === normalizedPeriodId
          ) {
            await api.patch(`/teachers/assignments/${existingAssignment.id}`, {
              schedule_info: scheduleInfo,
              status: assignmentStatus,
            });
          } else {
            await api.post('/teachers/assignments', {
              teacher_user_id: teacherUserId,
              course_campus_id: offeringId,
              period_id: normalizedPeriodId,
              schedule_info: scheduleInfo,
              status: assignmentStatus,
            });

            if (existingAssignment) {
              await api.patch(`/teachers/assignments/${existingAssignment.id}`, { status: 'INACTIVE' });
            }
          }
        }
      }

      const currentVisibleOfferingIds = visibleCourseOfferingIds;
      const refreshCampusId = courseCampusFilter || courseForm.campus_id || null;

      toast.success(
        editingCourseId
          ? allowWithoutTeacher
            ? 'Curso actualizado sin profesor asignado.'
            : 'Curso actualizado correctamente.'
          : allowWithoutTeacher
            ? 'Curso creado sin profesor asignado.'
            : 'Curso creado correctamente.',
      );
      if (!courseCampusFilter && courseForm.campus_id) {
        setCourseCampusFilter(String(courseForm.campus_id));
      }
      resetCourseForm();
      await loadCourses({ campusId: refreshCampusId });

      if (canViewAssignments && currentVisibleOfferingIds.length > 0) {
        await loadTeacherAssignments({ full: false, courseCampusIds: currentVisibleOfferingIds });
      }
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || requestError.message || 'No se pudo guardar el curso.');
    } finally {
      setSaving(false);
    }
  };

  const editCourse = (course) => {
    if (!canManageCourses) return;
    const offering = getPrimaryOffering(course);
    const assignment = offering ? assignmentByOfferingId.get(String(offering.offering_id)) : null;
    const sourceScheduleInfo = assignment?.schedule_info || offering?.schedule_info || '';
    const parsedSchedules = parseCourseSchedule(sourceScheduleInfo);

    setEditingCourseId(course.id);
    setCourseForm({
      offering_id: offering?.offering_id ? String(offering.offering_id) : '',
      name: course.name || '',
      description: course.description || '',
      duration_hours: String(course.duration_hours || ''),
      passing_grade: String(course.passing_grade ?? 11),
      is_active: Boolean(course.is_active),
      campus_id: offering?.campus_id ? String(offering.campus_id) : defaultCampusId,
      period_id: assignment?.period_id ? String(assignment.period_id) : defaultPeriodId,
      teacher_user_id: assignment?.status === 'ACTIVE' && assignment?.teacher_user_id ? String(assignment.teacher_user_id) : '',
      allow_without_teacher: assignment?.status !== 'ACTIVE' || !assignment?.teacher_user_id,
      modality: offering?.modality || 'PRESENCIAL',
      schedules: parsedSchedules,
      monthly_fee:
        offering?.monthly_fee === null || offering?.monthly_fee === undefined ? '' : String(offering.monthly_fee),
      capacity: offering?.capacity === null || offering?.capacity === undefined ? '' : String(offering.capacity),
    });
    setShowCourseForm(true);
  };

  const deleteCourse = async (course) => {
    if (!canManageCourses) return;
    const confirmed = await confirm({
      title: 'Eliminar curso',
      message: `¿Estás seguro de que deseas eliminar el curso "${course.name}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      type: 'danger',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await api.delete(`/courses/${course.id}`);
      toast.success('Curso eliminado correctamente.');
      if (editingCourseId === course.id) resetCourseForm();
      await loadCourses({ campusId: courseCampusFilter || null });
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'No se pudo eliminar el curso.');
    } finally {
      setSaving(false);
    }
  };

  if (!firstEnabledTab) {
    return (
      <section className="card">
        <h1 className="text-xl font-semibold">Gestión académica</h1>
        <p className="mt-2 text-sm text-primary-700">No tienes permisos para acceder a este módulo.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary-900">Gestión académica</h1>
          <p className="text-sm text-primary-700">
            Crea, edita y administra alumnos, docentes, cursos, pagos y certificados desde una sola ventana.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-800">
            {studentTotal || students.length} alumnos
          </span>
          <span className="rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-800">
            {teacherTotal || teachers.length} docentes
          </span>
          <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-800">
            {courseTotal || courses.length} cursos
          </span>
          <span className="rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-800">
            {campuses.length} sedes
          </span>
          <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-800">
            {periods.length} periodos
          </span>
        </div>
      </div>

      <div className="page-tabs">
        {tabs
          .filter((tab) => tab.enabled)
          .map((tab) => {
            const isActive = activeTab === tab.key;
            const TabIcon = tab.icon;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => changeTab(tab.key)}
                className={`page-tab ${isActive ? 'page-tab-active' : ''}`}
              >
                <span className="flex items-center gap-2">
                  {TabIcon ? (
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                        isActive ? 'bg-white/20 text-white' : 'bg-primary-50 text-primary-600'
                      }`}
                    >
                      <TabIcon className="h-4 w-4" />
                    </span>
                  ) : null}
                  <span>{tab.label}</span>
                </span>
              </button>
            );
          })}
      </div>

      {(activeTab === 'students' || activeTab === 'students_list') && (canViewStudents || canManageStudents) ? (
        <article className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-primary-900">
              {activeTab === 'students_list' ? 'Alumnos' : 'Matrícula'}
            </h2>
            {canManageStudents ? (
              <button
                type="button"
                onClick={() => {
                  if (showStudentForm) resetStudentForm();
                  else {
                    resetEnrollmentEdit();
                    setShowStudentForm(true);
                  }
                }}
                className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
              >
                {showStudentForm ? 'Cerrar formulario' : editingStudentId ? 'Editar alumno' : 'Crear alumno'}
              </button>
            ) : null}
          </div>

          {activeTab === 'students' ? (
            <input
              className="app-input"
              placeholder="Buscar matrículas por alumno, curso, sede o periodo"
              value={enrollmentSearch}
              onChange={(event) => setEnrollmentSearch(event.target.value)}
            />
          ) : (
            <input
              className="app-input"
              placeholder="Buscar alumnos por nombre, documento o correo"
              value={studentSearch}
              onChange={(event) => {
                setStudentSearch(event.target.value);
                setStudentPage(1);
              }}
            />
          )}

          {activeTab === 'students' && editingEnrollmentId && canManageEnrollments ? (
            <form onSubmit={submitEnrollmentEdit} className="panel-soft space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">
                    Editando matrícula #{editingEnrollmentId}
                  </p>
                  <h3 className="text-lg font-semibold text-primary-900">
                    {enrollmentEditForm.student_name || 'Alumno'}
                  </h3>
                  <p className="text-xs text-primary-600">
                    La sede permanece fija. Para cambiarla utiliza el módulo de traslados.
                  </p>
                </div>
                <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-800">
                  {enrollmentEditForm.campus_name || 'Sede actual'}
                </span>
              </div>

              {enrollmentEditForm.course_change_locked ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  El curso y el periodo están protegidos porque esta matrícula tiene{' '}
                  <strong>{enrollmentEditForm.course_change_reason}</strong>. Sí puedes modificar la fecha, el
                  horario, el estado y la nota.
                </div>
              ) : (
                <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-800">
                  Puedes cambiar el curso dentro de la misma sede. Las cuotas pendientes conservarán sus montos
                  actuales.
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1 lg:col-span-2">
                  <span className="text-xs font-semibold text-primary-700">Curso</span>
                  <select
                    className="app-input"
                    value={enrollmentEditForm.course_campus_id}
                    onChange={(event) =>
                      setEnrollmentEditForm((prev) => ({
                        ...prev,
                        course_campus_id: event.target.value,
                        schedule_info: getDefaultScheduleInfoForOfferingId(
                          event.target.value,
                          enrollmentEditOfferingOptions,
                        ),
                      }))
                    }
                    disabled={enrollmentEditForm.course_change_locked || loadingCourses}
                    required
                  >
                    <option value="">Selecciona curso</option>
                    {enrollmentEditOfferingOptions.map((offering) => (
                      <option key={offering.offering_id} value={offering.offering_id}>
                        {offering.course_name} ({offering.modality})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 lg:col-span-2">
                  <span className="text-xs font-semibold text-primary-700">Bloque horario</span>
                  <select
                    className="app-input"
                    value={enrollmentEditForm.schedule_info}
                    onChange={(event) =>
                      setEnrollmentEditForm((prev) => ({ ...prev, schedule_info: event.target.value }))
                    }
                    disabled={!enrollmentEditForm.course_campus_id || selectedEnrollmentEditScheduleBlocks.length === 0}
                    required={selectedEnrollmentEditScheduleBlocks.length > 1}
                  >
                    <option value="">
                      {!enrollmentEditForm.course_campus_id
                        ? 'Selecciona primero el curso'
                        : selectedEnrollmentEditScheduleBlocks.length === 0
                          ? 'Sin bloques registrados'
                          : 'Selecciona bloque'}
                    </option>
                    {selectedEnrollmentEditScheduleBlocks.map((block, index) => (
                      <option key={`${block}-${index}`} value={block}>
                        Bloque #{index + 1}: {block}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold text-primary-700">Periodo</span>
                  <select
                    className="app-input"
                    value={enrollmentEditForm.period_id}
                    onChange={(event) =>
                      setEnrollmentEditForm((prev) => ({ ...prev, period_id: event.target.value }))
                    }
                    disabled={enrollmentEditForm.course_change_locked || loadingPeriods}
                    required
                  >
                    <option value="">Selecciona periodo</option>
                    {periods.map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.name}{period.is_active ? '' : ' (Inactivo)'}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold text-primary-700">Fecha de matrícula</span>
                  <input
                    type="date"
                    className="app-input"
                    value={enrollmentEditForm.enrollment_date}
                    onChange={(event) =>
                      setEnrollmentEditForm((prev) => ({ ...prev, enrollment_date: event.target.value }))
                    }
                    required
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold text-primary-700">Estado</span>
                  <select
                    className="app-input"
                    value={enrollmentEditForm.status}
                    onChange={(event) =>
                      setEnrollmentEditForm((prev) => ({ ...prev, status: event.target.value }))
                    }
                  >
                    <option value="ACTIVE">Activa</option>
                    <option value="SUSPENDED">Suspendida</option>
                    <option value="COMPLETED">Completada</option>
                    <option value="CANCELED">Cancelada</option>
                  </select>
                </label>

                <label className="space-y-1 sm:col-span-2 lg:col-span-3">
                  <span className="text-xs font-semibold text-primary-700">Nota de matrícula (opcional)</span>
                  <textarea
                    className="app-input min-h-20 resize-y"
                    maxLength={500}
                    placeholder="Observaciones administrativas de esta matrícula"
                    value={enrollmentEditForm.notes}
                    onChange={(event) =>
                      setEnrollmentEditForm((prev) => ({ ...prev, notes: event.target.value }))
                    }
                  />
                  <span className="block text-right text-[11px] text-primary-500">
                    {enrollmentEditForm.notes.length}/500
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Guardando...' : 'Guardar matrícula'}
                </button>
                <button
                  type="button"
                  onClick={resetEnrollmentEdit}
                  className="rounded-xl border border-primary-300 bg-white px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : null}

          {showStudentForm && canManageStudents ? (
            <form onSubmit={submitStudent} className="panel-soft space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  placeholder="Teléfono"
                  value={studentForm.phone}
                  onChange={(event) => setStudentForm((prev) => ({ ...prev, phone: event.target.value }))}
                />
                <input
                  className="app-input sm:col-span-2"
                  placeholder="Dirección"
                  value={studentForm.address}
                  onChange={(event) => setStudentForm((prev) => ({ ...prev, address: event.target.value }))}
                />
                <label className="space-y-1 sm:col-span-2 lg:col-span-4">
                  <span className="text-xs font-semibold text-primary-700">Nota del alumno (opcional)</span>
                  <textarea
                    className="app-input min-h-20 resize-y"
                    maxLength={500}
                    placeholder="Observaciones generales sobre el alumno"
                    value={studentForm.notes}
                    onChange={(event) => setStudentForm((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                  <span className="block text-right text-[11px] text-primary-500">
                    {studentForm.notes.length}/500
                  </span>
                </label>
              </div>

              {editingStudentId ? (
                <div className="space-y-3 rounded-xl border border-primary-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-primary-900">Acceso al sistema</h3>
                    {canManageTransfers ? (
                      <button
                        type="button"
                        onClick={openStudentTransferFlow}
                        className="rounded-lg border border-accent-300 bg-white px-3 py-1.5 text-xs font-semibold text-accent-700 hover:bg-accent-50"
                      >
                        TRASLADO
                      </button>
                    ) : null}
                  </div>
                  {studentForm.access_user_id ? (
                    canManageStudentAccess ? (
                      <>
                        <p className="text-xs text-primary-700">
                          El correo de acceso usa el campo "Correo". Puedes activar/desactivar acceso y cambiar
                          contraseña.
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <label className="space-y-1">
                            <span className="text-xs font-semibold text-primary-700">Usuario</span>
                            <input className="app-input" value={`#${studentForm.access_user_id}`} readOnly />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-semibold text-primary-700">Estado de acceso</span>
                            <select
                              className="app-input"
                              value={studentForm.access_is_active ? 'ACTIVE' : 'INACTIVE'}
                              onChange={(event) =>
                                setStudentForm((prev) => ({
                                  ...prev,
                                  access_is_active: event.target.value === 'ACTIVE',
                                }))
                              }
                            >
                              <option value="ACTIVE">Activo</option>
                              <option value="INACTIVE">Inactivo</option>
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-semibold text-primary-700">
                              Nueva contraseña (opcional)
                            </span>
                            <input
                              type="password"
                              minLength={8}
                              className="app-input"
                              placeholder="Minimo 8 caracteres"
                              value={studentForm.access_password}
                              onChange={(event) =>
                                setStudentForm((prev) => ({ ...prev, access_password: event.target.value }))
                              }
                            />
                          </label>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-primary-700">
                        No tienes permisos para modificar accesos de usuarios.
                      </p>
                    )
                  ) : (
                    <p className="text-sm text-primary-700">
                      Este alumno no tiene usuario de acceso vinculado.
                    </p>
                  )}
                </div>
              ) : null}

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
                      <input
                        className="app-input"
                        placeholder="Apoderado: nombres"
                        value={studentForm.guardian_first_name}
                        onChange={(event) =>
                          setStudentForm((prev) => ({ ...prev, guardian_first_name: event.target.value }))
                        }
                        required
                      />
                      <input
                        className="app-input"
                        placeholder="Apoderado: apellidos"
                        value={studentForm.guardian_last_name}
                        onChange={(event) =>
                          setStudentForm((prev) => ({ ...prev, guardian_last_name: event.target.value }))
                        }
                        required
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
                  <h3 className="text-sm font-semibold text-primary-900">Datos de matrícula</h3>

                  {canManageEnrollments ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold text-primary-700">Sede</span>
                          {canSelectEnrollmentCampus ? (
                            <select
                              className="app-input"
                              value={studentForm.enrollment_campus_id}
                              onChange={(event) =>
                                setStudentForm((prev) => ({
                                  ...prev,
                                  enrollment_campus_id: event.target.value,
                                  course_campus_id: '',
                                  schedule_info: '',
                                }))
                              }
                              required
                            >
                              <option value="">Selecciona sede</option>
                              {enrollmentCampusOptions.map((campus) => (
                                <option key={campus.id} value={campus.id}>
                                  {campus.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input className="app-input" value={selectedEnrollmentCampusName} readOnly />
                          )}
                        </label>

                        <label className="space-y-1 lg:col-span-2">
                          <span className="text-xs font-semibold text-primary-700">Curso</span>
                          <select
                            className="app-input"
                            value={studentForm.course_campus_id}
                            onChange={(event) =>
                              setStudentForm((prev) => ({
                                ...prev,
                                course_campus_id: event.target.value,
                                schedule_info: getDefaultScheduleInfoForOfferingId(event.target.value),
                              }))
                            }
                            disabled={canSelectEnrollmentCampus && !studentForm.enrollment_campus_id}
                            required
                          >
                            <option value="">
                              {canSelectEnrollmentCampus && !studentForm.enrollment_campus_id
                                ? 'Selecciona primero la sede'
                                : 'Selecciona curso'}
                            </option>
                            {filteredEnrollmentOfferingOptions.map((offering) => (
                              <option key={offering.offering_id} value={offering.offering_id}>
                                {offering.course_name} ({offering.modality})
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-1 lg:col-span-2">
                          <span className="text-xs font-semibold text-primary-700">Bloque horario</span>
                          <select
                            className="app-input"
                            value={studentForm.schedule_info}
                            onChange={(event) =>
                              setStudentForm((prev) => ({ ...prev, schedule_info: event.target.value }))
                            }
                            disabled={!studentForm.course_campus_id || selectedEnrollmentScheduleBlocks.length === 0}
                            required={selectedEnrollmentScheduleBlocks.length > 1}
                          >
                            <option value="">
                              {!studentForm.course_campus_id
                                ? 'Selecciona primero el curso'
                                : selectedEnrollmentScheduleBlocks.length === 0
                                  ? 'Sin bloques registrados'
                                  : 'Selecciona bloque'}
                            </option>
                            {selectedEnrollmentScheduleBlocks.map((block, index) => (
                              <option key={`${block}-${index}`} value={block}>
                                Bloque #{index + 1}: {block}
                              </option>
                            ))}
                          </select>
                        </label>

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

                        <label className="space-y-1">
                          <span className="text-xs font-semibold text-primary-700">Periodo</span>
                          <select
                            className="app-input"
                            value={studentForm.period_id}
                            onChange={(event) =>
                              setStudentForm((prev) => ({ ...prev, period_id: event.target.value }))
                            }
                            required
                          >
                            <option value="">Selecciona periodo</option>
                            {periods.map((period) => (
                              <option key={period.id} value={period.id}>
                                {period.name}{period.is_active ? '' : ' (Inactivo)'}
                              </option>
                            ))}
                          </select>
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
                        <span className="block text-right text-[11px] text-primary-500">
                          {studentForm.enrollment_notes.length}/500
                        </span>
                      </label>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold text-primary-700">Importe matrícula</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="app-input"
                            value={studentForm.enrollment_fee_amount}
                            onChange={(event) =>
                              setStudentForm((prev) => ({ ...prev, enrollment_fee_amount: event.target.value }))
                            }
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-xs font-semibold text-primary-700">Cantidad de cuotas</span>
                          <input
                            type="number"
                            min="0"
                            max="24"
                            step="1"
                            className="app-input"
                            value={studentForm.installments_count}
                            onChange={(event) =>
                              setStudentForm((prev) => ({ ...prev, installments_count: event.target.value }))
                            }
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-xs font-semibold text-primary-700">
                            {studentForm.use_variable_installments ? 'Monto base referencial' : 'Monto por cuota'}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="app-input"
                            value={studentForm.installment_amount}
                            onChange={(event) =>
                              setStudentForm((prev) => ({ ...prev, installment_amount: event.target.value }))
                            }
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-xs font-semibold text-primary-700">Primer vencimiento</span>
                          <input
                            type="date"
                            className="app-input"
                            value={studentForm.first_installment_due_date}
                            onChange={(event) =>
                              setStudentForm((prev) => ({ ...prev, first_installment_due_date: event.target.value }))
                            }
                          />
                        </label>
                      </div>

                      <div className="space-y-2 rounded-xl border border-primary-100 bg-primary-50 p-3">
                        <label className="flex items-center gap-2 text-xs font-semibold text-primary-800">
                          <input
                            type="checkbox"
                            checked={Boolean(studentForm.use_variable_installments)}
                            onChange={(event) => toggleVariableInstallments(event.target.checked)}
                          />
                          Permitir montos distintos por cuota
                        </label>

                        {studentForm.use_variable_installments && normalizedInstallmentsCount > 0 ? (
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs text-primary-700">
                                Configura el monto de cada cuota. El vencimiento se calcula desde el primer
                                vencimiento.
                              </p>
                              <button
                                type="button"
                                onClick={copyBaseAmountToInstallmentPlan}
                                className="rounded-lg border border-primary-300 bg-white px-2 py-1 text-xs font-semibold text-primary-800 hover:bg-primary-100"
                              >
                                Copiar monto base a todas
                              </button>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-2">
                              {Array.from({ length: normalizedInstallmentsCount }, (_, index) => {
                                const dueDate = addMonthsToIsoDate(
                                  studentForm.first_installment_due_date || studentForm.enrollment_date || getTodayIsoDate(),
                                  index,
                                );
                                const amountValue = Array.isArray(studentForm.installment_plan)
                                  ? studentForm.installment_plan[index] || ''
                                  : '';

                                return (
                                  <label
                                    key={`installment-plan-${index + 1}`}
                                    className="grid gap-1 rounded-lg border border-primary-100 bg-white p-2"
                                  >
                                    <span className="text-xs font-semibold text-primary-700">
                                      Cuota {index + 1} | Vence: {dueDate}
                                    </span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      className="app-input"
                                      value={amountValue}
                                      onChange={(event) => updateInstallmentPlanAmount(index, event.target.value)}
                                      required
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <p className="text-xs text-primary-700">
                        Total planificado:{' '}
                        S/ {plannedEnrollmentTotal.toFixed(2)}
                      </p>

                      {!canManageInstallments ? (
                        <p className="text-xs text-red-700">
                          Tu usuario no tiene permiso para crear cuotas; solo se registrará la matrícula.
                        </p>
                      ) : null}

                      {selectedEnrollmentOffering ? (
                        <div className="rounded-xl border border-primary-100 bg-primary-50 p-3 text-sm text-primary-900">
                          <p>
                            <strong>Curso:</strong> {selectedEnrollmentOffering.course_name}
                          </p>
                          <p>
                            <strong>Sede/Modalidad:</strong> {selectedEnrollmentOffering.campus_name} (
                            {selectedEnrollmentOffering.modality})
                          </p>
                          <p>
                            <strong>Bloque elegido:</strong> {studentForm.schedule_info || '-'}
                          </p>
                          <p>
                            <strong>Horarios del curso:</strong> {selectedEnrollmentAssignment?.schedule_info || selectedEnrollmentOffering.schedule_info || '-'}
                          </p>
                          <p>
                            <strong>Docente:</strong> {selectedEnrollmentAssignment?.teacher_name || 'Por asignar'}
                          </p>
                          <p>
                            <strong>Periodo:</strong> {selectedEnrollmentPeriodName}
                          </p>
                          <p>
                            <strong>Importe:</strong>{' '}
                            {selectedEnrollmentOffering.monthly_fee === null ||
                            selectedEnrollmentOffering.monthly_fee === undefined
                              ? '-'
                              : `S/ ${Number(selectedEnrollmentOffering.monthly_fee).toFixed(2)}`}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-primary-700">
                          {canSelectEnrollmentCampus && !studentForm.enrollment_campus_id
                            ? 'Selecciona primero la sede y luego el curso para completar automáticamente la matrícula.'
                            : 'Selecciona el curso para completar automáticamente la información de matrícula.'}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-red-700">
                      Tu usuario no tiene permisos para registrar matrícula automática en esta ventana.
                    </p>
                  )}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Guardando...' : editingStudentId ? 'Guardar cambios' : 'Guardar alumno'}
                </button>
                <button
                  type="button"
                  onClick={resetStudentForm}
                  className="rounded-xl border border-primary-300 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : null}

          {activeTab === 'students' ? (
            loadingEnrollments ? <p className="text-sm text-primary-700">Cargando matrículas recientes...</p> : null
          ) : (
            loadingStudents ? <p className="text-sm text-primary-700">Cargando alumnos...</p> : null
          )}

          {activeTab === 'students' ? (
            canReadEnrollments ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-primary-600">
                      <th className="pb-2 pr-3">Fecha y hora</th>
                      <th className="pb-2 pr-3">Alumno</th>
                      <th className="pb-2 pr-3">Curso</th>
                      <th className="pb-2 pr-3">Sede</th>
                      <th className="pb-2 pr-3">Horario</th>
                      <th className="pb-2 pr-3">Periodo</th>
                      <th className="pb-2 pr-3">Registrado por</th>
                      <th className="pb-2 pr-3">Estado</th>
                      <th className="pb-2 pr-3">Nota</th>
                      {canManageEnrollments ? <th className="pb-2">Acciones</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecentEnrollments.map((enrollment) => (
                      <tr key={enrollment.id} className="border-t border-primary-100">
                        <td className="py-2 pr-3">{toInputDateTime(enrollment.created_at || enrollment.enrollment_date)}</td>
                        <td className="py-2 pr-3 font-medium">{enrollment.student_name || '-'}</td>
                        <td className="py-2 pr-3">{enrollment.course_name || '-'}</td>
                        <td className="py-2 pr-3">{enrollment.campus_name || '-'}</td>
                        <td className="max-w-64 py-2 pr-3 text-primary-700">
                          <span className="block truncate" title={enrollment.schedule_info || ''}>
                            {enrollment.schedule_info || '-'}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{enrollment.period_name || '-'}</td>
                        <td className="py-2 pr-3">{enrollment.created_by_name || 'Sistema'}</td>
                        <td className="py-2 pr-3">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              String(enrollment.status || '').toUpperCase() === 'ACTIVE'
                                ? 'bg-primary-100 text-primary-800'
                                : 'bg-primary-50 text-primary-700'
                            }`}
                          >
                            {toEnrollmentStatusLabel(enrollment.status)}
                          </span>
                        </td>
                        <td className="max-w-56 py-2 pr-3 text-primary-700">
                          <span className="block truncate" title={enrollment.notes || ''}>
                            {enrollment.notes || '-'}
                          </span>
                        </td>
                        {canManageEnrollments ? (
                          <td className="py-2">
                            <button
                              type="button"
                              onClick={() => editEnrollment(enrollment)}
                              disabled={String(enrollment.status || '').toUpperCase() === 'TRANSFERRED'}
                              className="rounded-lg border border-primary-300 px-2 py-1 text-xs font-semibold text-primary-800 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              EDITAR
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    {!loadingEnrollments && filteredRecentEnrollments.length === 0 ? (
                      <tr>
                        <td colSpan={canManageEnrollments ? 10 : 9} className="py-4 text-center text-sm text-primary-600">
                          No se encontraron matrículas recientes.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-primary-700">
                No tienes permisos para ver los registros de matrícula.
              </p>
            )
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-primary-600">
                      <th className="pb-2 pr-3">Alumno</th>
                      <th className="pb-2 pr-3">Tipo doc.</th>
                      <th className="pb-2 pr-3">Nro. doc.</th>
                      <th className="pb-2 pr-3">Correo</th>
                      <th className="pb-2 pr-3">Teléfono</th>
                      <th className="pb-2 pr-3">Nota</th>
                      <th className="pb-2">Acciones</th>
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
                          <td className="py-2 pr-3">{student.email || '-'}</td>
                          <td className="py-2 pr-3">{student.phone || '-'}</td>
                          <td className="max-w-56 py-2 pr-3 text-primary-700">
                            <span className="block truncate" title={student.notes || ''}>
                              {student.notes || '-'}
                            </span>
                          </td>
                          <td className="py-2">
                            <div className="flex flex-wrap gap-2">
                              {canManageStudents ? (
                                <button
                                  type="button"
                                  onClick={() => editStudent(student)}
                                  className="rounded-lg border border-primary-300 px-2 py-1 text-xs font-semibold text-primary-800 hover:bg-primary-50"
                                >
                                  EDITAR
                                </button>
                              ) : null}
                              {canManageStudents ? (
                                <button
                                  type="button"
                                  onClick={() => deleteStudent(student)}
                                  className="rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                                >
                                  ELIMINAR
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!loadingStudents && students.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-4 text-center text-sm text-primary-600">
                          No se encontraron alumnos.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <PaginationControls
                page={studentPage}
                totalPages={studentTotalPages}
                total={studentTotal}
                pageSize={STUDENT_PAGE_SIZE}
                onPageChange={setStudentPage}
                disabled={loadingStudents}
                label="alumnos"
              />
            </>
          )}
        </article>
      ) : null}

      {activeTab === 'teachers' && (canViewTeachers || canCreateTeachers || canManageTeacherProfile) ? (
        <article className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-primary-900">Docentes</h2>
            {canCreateTeachers || canManageTeacherProfile ? (
              <button
                type="button"
                onClick={() => {
                  if (showTeacherForm) resetTeacherForm();
                  else {
                    setEditingTeacherId(null);
                    setTeacherForm(createTeacherFormDefaults());
                    setShowTeacherForm(true);
                  }
                }}
                className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
              >
                {showTeacherForm ? 'Cerrar formulario' : editingTeacherId ? 'Editar docente' : 'Crear docente'}
              </button>
            ) : null}
          </div>

          <input
            className="app-input"
            placeholder="Buscar docentes por nombre, documento, telefono o correo"
            value={teacherSearch}
            onChange={(event) => {
              setTeacherSearch(event.target.value);
              setTeacherPage(1);
            }}
          />

          {showTeacherForm && (canCreateTeachers || canManageTeacherProfile) ? (
            <form onSubmit={submitTeacher} className="panel-soft space-y-3">
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
                      ? 'Nueva contraseña (opcional)'
                      : teacherForm.use_email_as_password
                        ? 'Se usará el correo como contraseña temporal'
                        : 'Contraseña'
                  }
                  value={teacherForm.password}
                  onChange={(event) => setTeacherForm((prev) => ({ ...prev, password: event.target.value }))}
                  required={!editingTeacherId}
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
                          assignment_campus_id:
                            prev.assignment_campus_id || prev.base_campus_id || defaultTeacherCampusId || defaultCampusId,
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
                          <input
                            className="app-input"
                            value={teacherCampusDisplayName}
                            readOnly
                            disabled
                          />
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
                              assignment_campus_override_reason: '',
                            }))
                          }
                          required
                          disabled={
                            loadingCourses ||
                            (canSelectTeacherCampus && !effectiveTeacherAssignmentCampusId) ||
                            filteredTeacherAssignmentOfferingOptions.length === 0
                          }
                        >
                          <option value="">
                            {loadingCourses
                              ? 'Cargando cursos...'
                              : filteredTeacherAssignmentOfferingOptions.length
                                ? 'Selecciona un curso'
                                : 'No hay cursos disponibles'}
                          </option>
                          {filteredTeacherAssignmentOfferingOptions.map((offering) => (
                            <option key={offering.offering_id} value={offering.offering_id}>
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
                        <input
                          className="app-input"
                          placeholder="Ej. Lun-Mie-Vie 7:00 pm a 9:00 pm"
                          value={teacherForm.assignment_schedule_info}
                          onChange={(event) =>
                            setTeacherForm((prev) => ({ ...prev, assignment_schedule_info: event.target.value }))
                          }
                        />
                      </label>

                      {selectedTeacherAssignmentOffering ? (
                        <div className="rounded-xl border border-primary-100 bg-primary-50 px-3 py-3 text-xs text-primary-800 sm:col-span-2 lg:col-span-4">
                          Se asignará el curso <span className="font-semibold">{selectedTeacherAssignmentOffering.course_name}</span> en{' '}
                          <span className="font-semibold">{selectedTeacherAssignmentOffering.campus_name}</span>
                          {' '}({selectedTeacherAssignmentOffering.modality}).
                        </div>
                      ) : null}

                      {teacherAssignmentRequiresCampusOverrideReason ? (
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
                      Puedes dejarlo sin asignación inicial y completar su carga académica después desde la sección de docentes.
                    </p>
                  )}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Guardando...' : editingTeacherId ? 'Guardar cambios' : 'Guardar docente'}
                </button>
                <button
                  type="button"
                  onClick={resetTeacherForm}
                  className="rounded-xl border border-primary-300 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : null}

          {loadingTeachers ? <p className="text-sm text-primary-700">Cargando docentes...</p> : null}

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 mt-4">
            {teachers.map((teacher) => {
              const parsedDocument = parseDocumentValue(teacher.document_number);
              return (
              <div key={teacher.id} className="flex flex-col rounded-2xl border border-primary-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md hover:border-primary-300">
                <div className="flex justify-between items-start mb-3 gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-primary-900 text-lg leading-tight truncate" title={`${teacher.first_name} ${teacher.last_name}`}>
                      {teacher.first_name} {teacher.last_name}
                    </h3>
                    <p className="text-xs text-primary-600 mt-1 truncate" title={teacher.email}>{teacher.email}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      teacher.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
                    }`}
                  >
                    {teacher.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                
                <div className="bg-primary-50/50 rounded-xl p-3 border border-primary-50 mb-4 space-y-2">
                   <div className="flex justify-between items-center text-xs gap-2">
                     <span className="text-gray-500 font-medium whitespace-nowrap">{parsedDocument.document_type || 'Doc.'}</span>
                     <span className="text-gray-900 font-semibold truncate text-right">{parsedDocument.document_number || '-'}</span>
                   </div>
                   <div className="flex justify-between items-center text-xs gap-2">
                     <span className="text-gray-500 font-medium whitespace-nowrap">Sede Base</span>
                     <span className="text-gray-900 font-semibold truncate flex-1 min-w-0 text-right" title={teacher.base_campus_name || 'No asignada'}>{teacher.base_campus_name || 'No asignada'}</span>
                   </div>
                   <div className="flex justify-between items-center text-xs gap-2">
                     <span className="text-gray-500 font-medium whitespace-nowrap">Teléfono</span>
                     <span className="text-gray-900 font-semibold truncate text-right">{teacher.phone || '-'}</span>
                   </div>
                </div>

                <div className="mt-auto pt-4 border-t border-gray-100 flex flex-wrap gap-2">
                  {canManageTeacherProfile ? (
                    <button
                      type="button"
                      onClick={() => editTeacher(teacher)}
                      className="flex-1 rounded-lg bg-primary-50 py-1.5 text-[11px] font-bold text-primary-700 hover:bg-primary-100 transition-colors"
                    >
                      EDITAR
                    </button>
                  ) : null}
                  {canManageTeacherProfile && teacher.is_active ? (
                    <button
                      type="button"
                      onClick={() => setTeacherStatus(teacher, false)}
                      className="flex-1 rounded-lg bg-red-50 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-100 transition-colors"
                    >
                      ELIMINAR
                    </button>
                  ) : null}
                  {canManageTeacherProfile && !teacher.is_active ? (
                    <button
                      type="button"
                      onClick={() => setTeacherStatus(teacher, true)}
                      className="flex-1 rounded-lg bg-emerald-50 py-1.5 text-[11px] font-bold text-emerald-600 hover:bg-emerald-100 transition-colors"
                    >
                      ACTIVAR
                    </button>
                  ) : null}
                </div>
              </div>
              );
            })}
            {!loadingTeachers && teachers.length === 0 ? (
              <div className="col-span-full py-12 text-center text-sm font-medium text-primary-700 bg-white rounded-2xl border border-dashed border-primary-200">
                No se encontraron docentes.
              </div>
            ) : null}
          </div>

          <PaginationControls
            page={teacherPage}
            totalPages={teacherTotalPages}
            total={teacherTotal}
            pageSize={teacherPageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setTeacherPage}
            onPageSizeChange={(nextSize) => {
              setTeacherPageSize(nextSize);
              setTeacherPage(1);
            }}
            disabled={loadingTeachers}
            label="docentes"
          />
        </article>
      ) : null}

      {activeTab === 'campuses' && (canViewCampuses || canManageCampuses) ? (
        <article className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-primary-900">Sedes</h2>
            {canManageCampuses ? (
              <button
                type="button"
                onClick={() => {
                  if (showCampusForm) resetCampusForm();
                  else {
                    setEditingCampusId(null);
                    setCampusForm({
                      ...campusDefaults,
                      registration_date: getTodayIsoDate(),
                    });
                    setShowCampusForm(true);
                  }
                }}
                className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
              >
                {showCampusForm ? 'Cerrar formulario' : editingCampusId ? 'Editar sede' : 'Crear sede'}
              </button>
            ) : null}
          </div>

          <input
            className="app-input"
            placeholder="Buscar sede por nombre, ciudad, dirección, teléfono o correo"
            value={campusSearch}
            onChange={(event) => setCampusSearch(event.target.value)}
          />

          {showCampusForm && canManageCampuses ? (
            <form onSubmit={submitCampus} className="panel-soft space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <input
                  className="app-input lg:col-span-2"
                  placeholder="Nombre de sede"
                  value={campusForm.name}
                  onChange={(event) => setCampusForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
                <input
                  className="app-input"
                  placeholder="Ciudad"
                  value={campusForm.city}
                  onChange={(event) => setCampusForm((prev) => ({ ...prev, city: event.target.value }))}
                  required
                />
                <input
                  type="date"
                  className="app-input"
                  value={campusForm.registration_date}
                  onChange={(event) => setCampusForm((prev) => ({ ...prev, registration_date: event.target.value }))}
                  required
                />
                <input
                  className="app-input"
                  placeholder="Teléfono (opcional)"
                  value={campusForm.phone}
                  onChange={(event) => setCampusForm((prev) => ({ ...prev, phone: event.target.value }))}
                />
                <input
                  className="app-input lg:col-span-2"
                  placeholder="Dirección"
                  value={campusForm.address}
                  onChange={(event) => setCampusForm((prev) => ({ ...prev, address: event.target.value }))}
                  required
                />
                <input
                  type="email"
                  className="app-input lg:col-span-2"
                  placeholder="Correo (opcional)"
                  value={campusForm.email}
                  onChange={(event) => setCampusForm((prev) => ({ ...prev, email: event.target.value }))}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Guardando...' : editingCampusId ? 'Guardar cambios' : 'Guardar sede'}
                </button>
                <button
                  type="button"
                  onClick={resetCampusForm}
                  className="rounded-xl border border-primary-300 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : null}

          {loadingCampuses ? <p className="text-sm text-primary-700">Cargando sedes...</p> : null}

          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filteredCampuses.map((campus) => (
              <div
                key={campus.id}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-primary-100 bg-white p-3 shadow-sm transition-all hover:-translate-y-1 hover:border-primary-200 hover:shadow-md"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-bold text-primary-900 group-hover:text-accent-600 transition-colors">
                        {campus.name}
                      </h3>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="inline-flex items-center rounded-md bg-primary-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-700 shadow-sm border border-primary-100">
                          {campus.city}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${campus.address} ${campus.city}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 text-sm text-primary-700 hover:text-accent-600 transition-colors group/link"
                      title="Ver en Google Maps"
                    >
                      <div className="mt-0.5 flex-shrink-0 transition-transform group-hover/link:scale-110">
                        <svg className="h-4 w-4 text-primary-400 group-hover/link:text-accent-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
                        </svg>
                      </div>
                      <span className="leading-tight underline-offset-4 group-hover/link:underline">{campus.address}</span>
                    </a>

                    {campus.phone && (
                      <a
                        href={`tel:${campus.phone.replace(/\s+/g, '')}`}
                        className="flex items-center gap-3 text-sm text-primary-700 hover:text-accent-600 transition-colors group/link"
                        title="Llamar a esta sede"
                      >
                        <div className="flex-shrink-0 transition-transform group-hover/link:scale-110">
                          <svg className="h-4 w-4 text-primary-400 group-hover/link:text-accent-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                          </svg>
                        </div>
                        <span className="underline-offset-4 group-hover/link:underline">{campus.phone}</span>
                      </a>
                    )}

                    {campus.email && (
                      <a
                        href={`mailto:${campus.email}`}
                        className="flex items-center gap-3 text-sm text-primary-700 hover:text-accent-600 transition-colors group/link"
                        title="Enviar correo"
                      >
                        <div className="flex-shrink-0 transition-transform group-hover/link:scale-110">
                          <svg className="h-4 w-4 text-primary-400 group-hover/link:text-accent-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                          </svg>
                        </div>
                        <span className="truncate underline-offset-4 group-hover/link:underline">{campus.email}</span>
                      </a>
                    )}
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-2 pt-4 border-t border-primary-50">
                  {canManageCampuses ? (
                    <>
                      <button
                        type="button"
                        onClick={() => editCampus(campus)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-primary-200 bg-white py-2 text-xs font-bold text-primary-700 transition hover:bg-primary-50 hover:text-primary-900 active:scale-95"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                        </svg>
                        EDITAR
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCampus(campus)}
                        className="flex items-center justify-center rounded-xl border border-red-100 bg-red-50/50 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-100 hover:text-red-700 active:scale-95"
                        title="Eliminar sede"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
            {!loadingCampuses && filteredCampuses.length === 0 ? (
              <div className="col-span-full py-12 text-center text-sm text-primary-600">
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-primary-300">
                  <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>
                  </svg>
                </div>
                No se encontraron sedes registradas.
              </div>
            ) : null}
          </div>
        </article>
      ) : null}

      {activeTab === 'transfers' ? (
        <TransfersManager title="Gestión de Traslados" showHeader={false} />
      ) : null}

      {activeTab === 'periods' && canReadPeriods ? (
        <article className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-primary-900">Periodos académicos</h2>
            {canManagePeriods ? (
              <button
                type="button"
                onClick={() => {
                  if (showPeriodForm) resetPeriodForm();
                  else setShowPeriodForm(true);
                }}
                className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
              >
                {showPeriodForm ? 'Cerrar formulario' : 'Nuevo periodo'}
              </button>
            ) : null}
          </div>

          {showPeriodForm && canManagePeriods ? (
            <form onSubmit={submitPeriod} className="panel-soft space-y-3">
              <h3 className="text-sm font-semibold text-primary-900">Registrar periodo</h3>
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

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Guardando...' : 'Guardar periodo'}
                </button>
                <button
                  type="button"
                  onClick={resetPeriodForm}
                  className="rounded-xl border border-primary-300 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : null}

          {canViewPeriods ? (
            <div className="overflow-x-auto rounded-xl border border-primary-200 bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-primary-600">
                    <th className="pb-2 pl-3 pr-3 pt-3">Periodo</th>
                    <th className="pb-2 pr-3 pt-3">Inicio</th>
                    <th className="pb-2 pr-3 pt-3">Fin</th>
                    <th className="pb-2 pr-3 pt-3">Activo</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => (
                    <tr key={period.id} className="border-t border-primary-100">
                      <td className="py-2 pl-3 pr-3 font-medium">{period.name}</td>
                      <td className="py-2 pr-3">{period.start_date}</td>
                      <td className="py-2 pr-3">{period.end_date}</td>
                      <td className="py-2 pr-3">{period.is_active ? 'SI' : 'NO'}</td>
                    </tr>
                  ))}
                  {!periods.length ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-sm text-primary-600">
                        No hay periodos registrados.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-primary-700">Tu usuario no tiene permisos para ver periodos.</p>
          )}
        </article>
      ) : null}

      {activeTab === 'payments' && canReadPayments ? <PaymentsPage /> : null}

      {activeTab === 'certificates' && canReadPayments ? (
        <article className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-primary-900">Generación de certificados</h2>
              <p className="text-sm text-primary-700">
                Configura primero los datos del certificado y luego abre el generador con toda la información precargada.
              </p>
            </div>
            <button
              type="button"
              onClick={() => changeTab('certificate_history')}
              className="rounded-xl border border-primary-200 bg-white px-4 py-2 text-sm font-semibold text-primary-800 transition hover:border-primary-300 hover:bg-primary-50"
            >
              Ver certificados emitidos
            </button>
          </div>

          <CertificateGeneratorLauncher />
        </article>
      ) : null}

      {activeTab === 'certificate_history' && canReadPayments ? <CertificateLibraryPage /> : null}

      {activeTab === 'courses' && canReadCoursesModule ? (
        <article className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-primary-900">Cursos</h2>
            <div className="flex flex-wrap gap-2">
              {canManageCourses ? (
                <button
                  type="button"
                  onClick={() => {
                    if (showCourseForm) resetCourseForm();
                    else setShowCourseForm(true);
                  }}
                  className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
                >
                  {showCourseForm ? 'Cerrar formulario' : editingCourseId ? 'Editar curso' : 'Crear curso'}
                </button>
              ) : null}
            </div>
          </div>

          {canReadCourses ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="app-input"
                placeholder="Buscar por curso, docente o modalidad"
                value={courseSearch}
                onChange={(event) => setCourseSearch(event.target.value)}
              />
              {canReadCampuses ? (
                <select
                  className="app-input"
                  value={courseCampusFilter}
                  onChange={(event) => setCourseCampusFilter(event.target.value)}
                  disabled={loadingCampuses || (!isRootAdminProfile && Boolean(user?.base_campus_id))}
                >
                  <option value="">{isRootAdminProfile ? 'Todas las sedes' : 'Filtrar por sede'}</option>
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}

          {showCourseForm && canManageCourses ? (
            <form onSubmit={submitCourse} className="panel-soft space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <input
                  className="app-input lg:col-span-2"
                  placeholder="Nombre del curso"
                  value={courseForm.name}
                  onChange={(event) => setCourseForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
                <select
                  className="app-input"
                  value={courseForm.teacher_user_id}
                  onChange={(event) =>
                    setCourseForm((prev) => {
                      const nextTeacherId = event.target.value;
                      const selectedTeacher = teachersById.get(String(nextTeacherId));
                      return {
                        ...prev,
                        teacher_user_id: nextTeacherId,
                        allow_without_teacher: false,
                        campus_id: selectedTeacher?.base_campus_id
                          ? String(selectedTeacher.base_campus_id)
                          : prev.campus_id || defaultCampusId,
                      };
                    })
                  }
                  required={!courseForm.allow_without_teacher}
                  disabled={courseForm.allow_without_teacher}
                >
                  <option value="">
                    {courseForm.allow_without_teacher ? 'Curso sin profesor asignado' : 'Docente a cargo'}
                  </option>
                  {teachers
                    .filter((teacher) => teacher.is_active !== false)
                    .map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.first_name} {teacher.last_name}
                      </option>
                    ))}
                </select>
                <label className="flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-sm text-primary-800">
                  <input
                    type="checkbox"
                    checked={Boolean(courseForm.allow_without_teacher)}
                    onChange={(event) =>
                      setCourseForm((prev) => ({
                        ...prev,
                        allow_without_teacher: event.target.checked,
                        teacher_user_id: event.target.checked ? '' : prev.teacher_user_id,
                      }))
                    }
                  />
                  <span>Crear curso sin profesor asignado</span>
                </label>
                <select
                  className="app-input"
                  value={courseForm.campus_id}
                  onChange={(event) => setCourseForm((prev) => ({ ...prev, campus_id: event.target.value }))}
                  required
                >
                  <option value="">Sede</option>
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  className="app-input"
                  placeholder="Duración (horas)"
                  value={courseForm.duration_hours}
                  onChange={(event) => setCourseForm((prev) => ({ ...prev, duration_hours: event.target.value }))}
                  required
                />
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="0.1"
                  className="app-input"
                  placeholder="Nota mínima"
                  value={courseForm.passing_grade}
                  onChange={(event) => setCourseForm((prev) => ({ ...prev, passing_grade: event.target.value }))}
                  required
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="app-input"
                  placeholder="Importe del curso"
                  value={courseForm.monthly_fee}
                  onChange={(event) => setCourseForm((prev) => ({ ...prev, monthly_fee: event.target.value }))}
                  required
                />
                <select
                  className="app-input"
                  value={courseForm.modality}
                  onChange={(event) => setCourseForm((prev) => ({ ...prev, modality: event.target.value }))}
                  required
                >
                  <option value="PRESENCIAL">Presencial</option>
                  <option value="VIRTUAL">Remoto</option>
                  <option value="HIBRIDO">Híbrido</option>
                </select>

                <div className="rounded-xl border border-primary-200 bg-white p-4 sm:col-span-2 lg:col-span-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold uppercase tracking-wide text-primary-900">Horarios del curso</p>
                    <button
                      type="button"
                      className="text-xs font-semibold text-accent-600 hover:text-accent-700 flex items-center gap-1"
                      onClick={() => setCourseForm(prev => ({
                        ...prev,
                        schedules: [...prev.schedules, { id: Date.now(), days: ['LUN'], start: '18:00', end: '20:00' }]
                      }))}
                    >
                      <span className="text-lg">+</span> Agregar horario
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    {courseForm.schedules.map((schedule, index) => (
                      <div key={schedule.id} className="relative rounded-xl border border-primary-100 bg-primary-50/30 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-primary-500">Bloque #{index + 1}</span>
                          {courseForm.schedules.length > 1 && (
                            <button
                              type="button"
                              className="text-xs font-semibold text-red-600 hover:text-red-700"
                              onClick={() => setCourseForm(prev => ({
                                ...prev,
                                schedules: prev.schedules.filter(s => s.id !== schedule.id)
                              }))}
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                        
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="space-y-1">
                            <span className="text-[11px] font-semibold text-primary-700">Hora inicio</span>
                            <input
                              type="time"
                              className="app-input"
                              value={schedule.start}
                              onChange={(event) => setCourseForm(prev => ({
                                ...prev,
                                schedules: prev.schedules.map(s => s.id === schedule.id ? { ...s, start: event.target.value } : s)
                              }))}
                              required
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[11px] font-semibold text-primary-700">Hora fin</span>
                            <input
                              type="time"
                              className="app-input"
                              value={schedule.end}
                              onChange={(event) => setCourseForm(prev => ({
                                ...prev,
                                schedules: prev.schedules.map(s => s.id === schedule.id ? { ...s, end: event.target.value } : s)
                              }))}
                              required
                            />
                          </label>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[11px] font-semibold text-primary-700">Días aplicables</span>
                          <div className="flex flex-wrap gap-1.5">
                            {COURSE_DAY_OPTIONS.map((day) => {
                              const checked = schedule.days.includes(day.value);
                              return (
                                <label
                                  key={day.value}
                                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                                    checked
                                      ? 'border-primary-500 bg-primary-50 text-primary-900 shadow-sm'
                                      : 'border-primary-200 bg-white text-primary-600 hover:border-primary-300'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="h-3 w-3"
                                    checked={checked}
                                    onChange={(event) =>
                                      setCourseForm((prev) => ({
                                        ...prev,
                                        schedules: prev.schedules.map(s => {
                                          if (s.id !== schedule.id) return s;
                                          const currentDays = new Set(s.days || []);
                                          if (event.target.checked) currentDays.add(day.value);
                                          else currentDays.delete(day.value);
                                          return {
                                            ...s,
                                            days: COURSE_DAY_OPTIONS.map(opt => opt.value).filter(val => currentDays.has(val))
                                          };
                                        })
                                      }))
                                    }
                                  />
                                  {day.label}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <select
                  className="app-input"
                  value={courseForm.period_id}
                  onChange={(event) => setCourseForm((prev) => ({ ...prev, period_id: event.target.value }))}
                  required
                >
                  <option value="">Periodo académico</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  className="app-input"
                  placeholder="Capacidad (opcional)"
                  value={courseForm.capacity}
                  onChange={(event) => setCourseForm((prev) => ({ ...prev, capacity: event.target.value }))}
                />
                <input
                  className="app-input lg:col-span-3"
                  placeholder="Descripción"
                  value={courseForm.description}
                  onChange={(event) => setCourseForm((prev) => ({ ...prev, description: event.target.value }))}
                />
                <label className="flex items-center gap-2 text-sm font-medium text-primary-800">
                  <input
                    type="checkbox"
                    checked={courseForm.is_active}
                    onChange={(event) => setCourseForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                  />
                  Curso activo (desmarca para desactivar)
                </label>
              </div>
              {!canManageAssignments ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  Necesitas permiso de asignaciones docentes para guardar el curso con docente.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Guardando...' : editingCourseId ? 'Guardar cambios' : 'Guardar curso'}
                </button>
                <button
                  type="button"
                  onClick={resetCourseForm}
                  className="rounded-xl border border-primary-300 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : null}

          {canReadCourses ? (
            <>
              {coursesScopeKey === 'preview:recent' ? (
                <p className="rounded-xl bg-primary-50 px-3 py-2 text-sm text-primary-800">
                  Mostrando los {RECENT_COURSES_PREVIEW_LIMIT} cursos creados más recientemente de todas las sedes.
                  Si eliges una sede o buscas un curso, se cargará el listado completo que corresponda.
                </p>
              ) : null}
              {loadingCourses ? <p className="text-sm text-primary-700">Cargando cursos...</p> : null}

              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 mt-4">
                {filteredCourses.map((course) => {
                  const offering = getPrimaryOffering(course);
                  const assignment = offering ? assignmentByOfferingId.get(String(offering.offering_id)) : null;
                  const modalityLabel =
                    offering?.modality === 'VIRTUAL' ? 'REMOTO'
                      : offering?.modality === 'HIBRIDO' ? 'HIBRIDO'
                      : offering?.modality === 'PRESENCIAL' ? 'PRESENCIAL' : '-';
                  const scheduleInfo = assignment?.schedule_info || offering?.schedule_info || '-';
                  const fee = offering?.monthly_fee;

                  return (
                    <div key={course.id} className="flex flex-col rounded-2xl border border-primary-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md hover:border-primary-300">
                      <div className="flex justify-between items-start mb-3 gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-primary-900 text-lg leading-tight line-clamp-2" title={course.name}>
                            {course.name}
                          </h3>
                          <p className="text-xs text-primary-600 mt-1 truncate" title={assignment?.teacher_name || 'Docente sin asignar'}>
                            {assignment?.teacher_name || 'Docente sin asignar'}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                            course.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          {course.is_active ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                      
                      <div className="bg-primary-50/50 rounded-xl p-3 border border-primary-50 mb-4 space-y-2">
                        <div className="flex justify-between items-center text-xs gap-2">
                          <span className="text-gray-500 font-medium whitespace-nowrap">Modalidad</span>
                          <span className="text-gray-900 font-semibold truncate text-right">{modalityLabel}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs gap-2">
                          <span className="text-gray-500 font-medium whitespace-nowrap">Horario</span>
                          <span className="text-gray-900 font-semibold truncate flex-1 min-w-0 text-right" title={scheduleInfo}>{scheduleInfo}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs gap-2">
                          <span className="text-gray-500 font-medium whitespace-nowrap">Duración / Min</span>
                          <span className="text-gray-900 font-semibold truncate text-right">{course.duration_hours}h / {Number(course.passing_grade).toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs gap-2">
                          <span className="text-gray-500 font-medium whitespace-nowrap">Importe</span>
                          <span className="text-gray-900 font-semibold truncate text-right">{fee === null || fee === undefined ? '-' : `S/ ${Number(fee).toFixed(2)}`}</span>
                        </div>
                      </div>

                      <div className="mt-auto pt-4 border-t border-gray-100 flex flex-wrap gap-2">
                        {canManageCourses ? (
                          <button
                            type="button"
                            onClick={() => editCourse(course)}
                            className="flex-1 rounded-lg bg-primary-50 py-1.5 text-[11px] font-bold text-primary-700 hover:bg-primary-100 transition-colors"
                          >
                            EDITAR
                          </button>
                        ) : null}
                        {canManageCourses ? (
                          <button
                            type="button"
                            onClick={() => deleteCourse(course)}
                            className="flex-1 rounded-lg bg-red-50 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-100 transition-colors"
                          >
                            ELIMINAR
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {!loadingCourses && filteredCourses.length === 0 ? (
                  <div className="col-span-full py-12 text-center text-sm font-medium text-primary-700 bg-white rounded-2xl border border-dashed border-primary-200">
                     No se encontraron cursos.
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-primary-700">Tu usuario no tiene permisos para gestionar cursos.</p>
          )}
        </article>
      ) : null}
    </section>
  );
}
