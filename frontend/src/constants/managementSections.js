import {
  ArrowLeftRight,
  BookOpenText,
  BriefcaseBusiness,
  Building2,
  CalendarRange,
  CircleDollarSign,
  FileBadge,
  GraduationCap,
  History,
  NotebookPen,
  Wallet,
} from 'lucide-react';
import { PERMISSIONS } from './permissions';

export const MANAGEMENT_SECTION_ITEMS = [
  {
    key: 'cash_register',
    label: 'Caja',
    icon: CircleDollarSign,
    permissions: [PERMISSIONS.CASH_REGISTER_VIEW, PERMISSIONS.CASH_REGISTER_MANAGE],
  },
  {
    key: 'payments',
    label: 'Pagos',
    icon: Wallet,
    permissions: [PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_MANAGE],
  },
  {
    key: 'students',
    label: 'Matrícula',
    icon: NotebookPen,
    permissions: [PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_MANAGE],
  },
  {
    key: 'students_list',
    label: 'Alumnos',
    icon: GraduationCap,
    permissions: [PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_MANAGE],
  },
  {
    key: 'transfers',
    label: 'Traslados',
    icon: ArrowLeftRight,
    permissions: [PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_MANAGE],
  },
  {
    key: 'teachers',
    label: 'Docentes',
    icon: BriefcaseBusiness,
    permissions: [PERMISSIONS.TEACHERS_VIEW, PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_STATUS_MANAGE],
  },
  {
    key: 'courses',
    label: 'Cursos',
    icon: BookOpenText,
    permissions: [PERMISSIONS.COURSES_VIEW, PERMISSIONS.COURSES_MANAGE],
  },
  {
    key: 'campuses',
    label: 'Sedes',
    icon: Building2,
    permissions: [PERMISSIONS.CAMPUSES_VIEW, PERMISSIONS.CAMPUSES_MANAGE],
  },
  {
    key: 'periods',
    label: 'Periodos',
    icon: CalendarRange,
    permissions: [PERMISSIONS.PERIODS_VIEW, PERMISSIONS.PERIODS_MANAGE],
  },
  {
    key: 'certificates',
    label: 'Generar certificado',
    icon: FileBadge,
    permissions: [PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_MANAGE],
  },
  {
    key: 'certificate_history',
    label: 'Certificados emitidos',
    icon: History,
    permissions: [PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_MANAGE],
  },
];

export const buildManagementSectionPath = (sectionKey) => {
  const params = new URLSearchParams();
  if (sectionKey) {
    params.set('section', sectionKey);
  }

  const query = params.toString();
  return query ? `/management?${query}` : '/management';
};
