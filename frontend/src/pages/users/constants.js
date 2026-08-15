import { PERMISSIONS } from '../../constants/permissions';

export const AVAILABLE_ROLES = ['ADMIN', 'DIRECTOR', 'SECRETARIADO', 'DOCENTE', 'ALUMNO'];
export const USER_PAGE_SIZE = 8;
export const ROLE_ADMIN = 'ADMIN';
export const DEFAULT_CREATE_ROLE = 'SECRETARIADO';

export const INITIAL_CREDENTIAL_FORM = {
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  use_email_as_password: false,
  send_activation_code: true,
  document_type: 'DNI',
  document_number: '',
  phone: '',
  address: '',
  role: '',
  campus_ids: [],
};

export const MANAGEMENT_ACCESS_GROUPS = [
  {
    key: 'enrollments',
    label: 'Matrícula',
    permissions: [
      PERMISSIONS.STUDENTS_VIEW,
      PERMISSIONS.STUDENTS_MANAGE,
      PERMISSIONS.ENROLLMENTS_VIEW,
      PERMISSIONS.ENROLLMENTS_MANAGE,
    ],
  },
  {
    key: 'students',
    label: 'Alumnos',
    permissions: [PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_MANAGE],
  },
  {
    key: 'teachers',
    label: 'Docentes',
    permissions: [PERMISSIONS.TEACHERS_VIEW, PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_STATUS_MANAGE],
  },
  {
    key: 'courses',
    label: 'Cursos',
    permissions: [PERMISSIONS.COURSES_VIEW, PERMISSIONS.COURSES_MANAGE],
  },
  {
    key: 'campuses',
    label: 'Sedes',
    permissions: [PERMISSIONS.CAMPUSES_VIEW, PERMISSIONS.CAMPUSES_MANAGE],
  },
  {
    key: 'periods',
    label: 'Periodos',
    permissions: [PERMISSIONS.PERIODS_VIEW, PERMISSIONS.PERIODS_MANAGE],
  },
  {
    key: 'payments',
    label: 'Pagos',
    permissions: [PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_MANAGE],
  },
  {
    key: 'certificates',
    label: 'Certificados',
    permissions: [PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_MANAGE],
  },
];

export const MANAGEMENT_ACCESS_CODES = Array.from(
  new Set(MANAGEMENT_ACCESS_GROUPS.flatMap((group) => group.permissions)),
).sort();

export const MENU_ACCESS_GROUPS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    permissions: [PERMISSIONS.DASHBOARD_VIEW],
  },
  {
    key: 'management',
    label: 'Gestión académica',
    permissions: MANAGEMENT_ACCESS_CODES,
  },
  {
    key: 'courses',
    label: 'Cursos',
    permissions: [PERMISSIONS.COURSES_VIEW, PERMISSIONS.COURSES_MANAGE],
  },
  {
    key: 'calendar',
    label: 'Calendario',
    permissions: [PERMISSIONS.TEACHERS_ASSIGNMENTS_VIEW],
  },
  {
    key: 'payments',
    label: 'Reporte de pagos',
    permissions: [PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_MANAGE],
  },
  {
    key: 'users',
    label: 'Usuarios',
    permissions: [PERMISSIONS.USERS_VIEW],
  },
];

export const MENU_ACCESS_CODES = Array.from(
  new Set(MENU_ACCESS_GROUPS.flatMap((group) => group.permissions)),
).sort();

export const ROLE_FILTER_OPTIONS = [
  { value: ROLE_ADMIN, label: 'ADMIN' },
  ...AVAILABLE_ROLES.filter((role) => role !== ROLE_ADMIN).map((role) => ({
    value: role,
    label: role,
  })),
  { value: '', label: 'Todos los roles' },
];
