import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenText,
  CalendarRange,
  ClipboardCheck,
  FileBadge,
  House,
  LayoutDashboard,
  LibraryBig,
  LogOut,
  Menu,
  NotebookTabs,
  ReceiptText,
  School,
  ShieldCheck,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../constants/permissions';
import { MANAGEMENT_SECTION_ITEMS, buildManagementSectionPath } from '../constants/managementSections';
import { DASHBOARD_SECTION_ITEMS, buildDashboardSectionPath } from '../constants/dashboardSections';
import { preloadCoreRoutes, preloadRoute } from '../utils/routePreload';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permissions: [PERMISSIONS.DASHBOARD_VIEW] },
  { to: '/users', label: 'Usuarios', icon: UsersRound, permissions: [PERMISSIONS.USERS_VIEW] },
];

const managementMenuGroups = [
  {
    key: 'finance',
    label: 'Caja y finanzas',
    icon: Wallet,
    itemKeys: ['cash_register', 'payments'],
  },
  {
    key: 'academic',
    label: 'Gestión académica',
    icon: School,
    itemKeys: ['students', 'students_list', 'transfers', 'teachers', 'courses', 'campuses', 'periods'],
  },
  {
    key: 'documents',
    label: 'Documentos',
    icon: ReceiptText,
    itemKeys: ['certificates', 'certificate_history'],
  },
];

const aulaVirtualItems = [
  {
    to: '/courses',
    label: 'Salones',
    icon: BookOpenText,
    permissions: [PERMISSIONS.TEACHERS_ASSIGNMENTS_VIEW],
  },
  {
    to: '/courses?tab=attendance',
    label: 'Asistencias',
    icon: ClipboardCheck,
    permissions: [PERMISSIONS.TEACHERS_ASSIGNMENTS_VIEW, PERMISSIONS.ACADEMIC_ATTENDANCE_MANAGE],
  },
  {
    to: '/virtual-library',
    label: 'Biblioteca virtual',
    icon: LibraryBig,
    permissions: [PERMISSIONS.TEACHERS_ASSIGNMENTS_VIEW],
    adminOnly: true,
  },
];

const ChevronIcon = ({ className = '' }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="m6 8 4 4 4-4" />
  </svg>
);

const studentNavItems = [
  { to: '/courses', label: 'Mis cursos', icon: BookOpenText },
  { to: '/my-grades', label: 'Mis notas', icon: NotebookTabs },
  { to: '/calendar', label: 'Mi calendario', icon: CalendarRange },
  { to: '/payments', label: 'Mis pagos', icon: Wallet },
  { to: '/certificates', label: 'Certificados', icon: FileBadge },
];

export default function AppShell() {
  const [open, setOpen] = useState(false);
  const [isDashboardExpanded, setIsDashboardExpanded] = useState(false);
  const [expandedManagementGroup, setExpandedManagementGroup] = useState(null);
  const [isAulaVirtualExpanded, setIsAulaVirtualExpanded] = useState(false);
  const [isAdminExpanded, setIsAdminExpanded] = useState(false);
  const { user, logout, hasAnyPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const roles = useMemo(() => user?.roles || [], [user]);
  const isDocenteProfile = roles.length === 1 && roles.includes('DOCENTE');
  const isAlumnoProfile = roles.length === 1 && roles.includes('ALUMNO');
  const isDashboardRoute = location.pathname === '/';
  const isManagementRoute = location.pathname === '/management';
  const aulaVirtualActivePaths = ['/courses', '/calendar', '/virtual-library'];
  const isAulaVirtualRoute = aulaVirtualActivePaths.some(p => location.pathname.startsWith(p));
  const activeCoursesTab = location.pathname === '/courses' ? new URLSearchParams(location.search).get('tab') : null;
  const isAttendanceTabActive = activeCoursesTab === 'attendance';
  const isCourseWorkspaceRoute = location.pathname.startsWith('/courses/salon/');
  const isCoursesOverviewRoute =
    (location.pathname === '/courses' && activeCoursesTab !== 'attendance') || isCourseWorkspaceRoute;
  const requestedDashboardSection = isDashboardRoute
    ? new URLSearchParams(location.search).get('section')
    : null;
  const requestedManagementSection = isManagementRoute
    ? new URLSearchParams(location.search).get('section')
    : null;

  const isNavItemActive = (itemPath, pathActive) => {
    if (itemPath === '/courses') {
      return isCoursesOverviewRoute;
    }
    if (itemPath === '/courses?tab=attendance') {
      return location.pathname === '/courses' && isAttendanceTabActive;
    }
    return pathActive;
  };

  const visibleManagementItems = useMemo(() => {
    if (isAlumnoProfile || isDocenteProfile) {
      return [];
    }

    return MANAGEMENT_SECTION_ITEMS.filter((item) => {
      return hasAnyPermission(item.permissions || []);
    });
  }, [hasAnyPermission, isAlumnoProfile, isDocenteProfile]);

  const visibleManagementGroups = useMemo(() => {
    const visibleItemsByKey = new Map(visibleManagementItems.map((item) => [item.key, item]));
    return managementMenuGroups
      .map((group) => ({
        ...group,
        items: group.itemKeys.map((itemKey) => visibleItemsByKey.get(itemKey)).filter(Boolean),
      }))
      .filter((group) => group.items.length > 0);
  }, [visibleManagementItems]);

  const visibleAulaVirtualItems = useMemo(() => {
    if (isAlumnoProfile) {
      return [];
    }
    return aulaVirtualItems.filter((item) => {
      if (item.adminOnly && isDocenteProfile) return false;
      if (!hasAnyPermission(item.permissions || [])) return false;
      return true;
    });
  }, [hasAnyPermission, isAlumnoProfile, isDocenteProfile]);

  const visibleDashboardItems = useMemo(() => {
    if (isAlumnoProfile) {
      return [];
    }

    return DASHBOARD_SECTION_ITEMS.filter((item) => hasAnyPermission(item.permissions || []));
  }, [hasAnyPermission, isAlumnoProfile]);

  const visibleAdminItems = useMemo(() => {
    if (isAlumnoProfile || isDocenteProfile) {
      return [];
    }

    return navItems.filter((item) => {
      if (item.to === '/') return false;
      if (item.adminOnly && isDocenteProfile) return false;
      if (!hasAnyPermission(item.permissions || [])) return false;
      if (Array.isArray(item.roles) && item.roles.length > 0 && !item.roles.some((role) => roles.includes(role))) {
        return false;
      }
      return true;
    });
  }, [hasAnyPermission, isAlumnoProfile, isDocenteProfile, roles]);

  const activeDashboardSection = useMemo(() => {
    if (!visibleDashboardItems.length) return null;
    const requested = String(requestedDashboardSection || '').trim();
    if (requested && visibleDashboardItems.some((item) => item.key === requested)) {
      return requested;
    }
    return visibleDashboardItems[0]?.key || null;
  }, [requestedDashboardSection, visibleDashboardItems]);

  const activeManagementSection = useMemo(() => {
    if (!visibleManagementItems.length) return null;
    const requested = String(requestedManagementSection || '').trim();
    if (requested && visibleManagementItems.some((item) => item.key === requested)) {
      return requested;
    }
    return visibleManagementItems[0]?.key || null;
  }, [requestedManagementSection, visibleManagementItems]);

  const activeManagementGroupKey = useMemo(() => {
    if (!activeManagementSection) return null;
    return visibleManagementGroups.find((group) =>
      group.items.some((item) => item.key === activeManagementSection),
    )?.key || null;
  }, [activeManagementSection, visibleManagementGroups]);

  const resolvedItems = isAlumnoProfile ? studentNavItems : visibleAdminItems;
  const priorityPreloadRoutes = useMemo(() => {
    if (!user) return [];

    if (isAlumnoProfile) {
      return resolvedItems.map((item) => item.to).slice(0, 4);
    }

    const routes = [];
    if (visibleDashboardItems.length) routes.push('/');
    if (visibleManagementItems.length) routes.push('/management');
    if (visibleAulaVirtualItems.length) routes.push('/courses');
    if (visibleAdminItems.length) routes.push('/users');
    return routes;
  }, [
    isAlumnoProfile,
    resolvedItems,
    user,
    visibleAdminItems.length,
    visibleAulaVirtualItems.length,
    visibleDashboardItems.length,
    visibleManagementItems.length,
  ]);

  useEffect(() => {
    let cancelPreload = null;

    const startPreload = () => {
      if (cancelPreload || priorityPreloadRoutes.length === 0) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      cancelPreload = preloadCoreRoutes(priorityPreloadRoutes);
    };

    const timeoutId = window.setTimeout(startPreload, 2200);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cancelPreload) {
        startPreload();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancelPreload?.();
    };
  }, [priorityPreloadRoutes]);

  const isCertificatesRoute = location.pathname === '/certificates';
  const dashboardMenuActive = isDashboardRoute || isDashboardExpanded;
  const isAdminRoute = location.pathname === '/users';
  const adminMenuActive = isAdminRoute || isAdminExpanded;

  const renderSidebarLabel = (label, Icon, active, { trailing = null, compact = false } = {}) => (
    <span className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        {Icon ? (
          <span
            className={`flex shrink-0 items-center justify-center ${compact ? 'h-6 w-6 rounded-md' : 'h-7 w-7 rounded-md'
              } transition ${active
                ? 'bg-white/10 text-white'
                : 'text-primary-200 group-hover:bg-primary-800 group-hover:text-white'
              }`}
          >
            <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          </span>
        ) : null}
        <span className={compact ? 'truncate text-xs font-medium' : 'truncate'}>
          {label}
        </span>
      </span>
      {trailing}
    </span>
  );

  useEffect(() => {
    if (isDashboardRoute && visibleDashboardItems.length > 0) {
      setIsDashboardExpanded(true);
      setExpandedManagementGroup(null);
      setIsAulaVirtualExpanded(false);
      setIsAdminExpanded(false);
      return;
    }

    setIsDashboardExpanded(false);
  }, [isDashboardRoute, visibleDashboardItems.length]);

  useEffect(() => {
    if (!isManagementRoute) {
      setExpandedManagementGroup(null);
      return;
    }

    if (activeManagementGroupKey) {
      setExpandedManagementGroup(activeManagementGroupKey);
    }
  }, [activeManagementGroupKey, isManagementRoute]);

  useEffect(() => {
    if (isAulaVirtualRoute && visibleAulaVirtualItems.length > 0) {
      setIsAulaVirtualExpanded(true);
      setIsDashboardExpanded(false);
      setExpandedManagementGroup(null);
      setIsAdminExpanded(false);
      return;
    }

    setIsAulaVirtualExpanded(false);
  }, [isAulaVirtualRoute, visibleAulaVirtualItems.length]);

  useEffect(() => {
    if (isAdminRoute && visibleAdminItems.length > 0) {
      setIsAdminExpanded(true);
      setIsDashboardExpanded(false);
      setExpandedManagementGroup(null);
      setIsAulaVirtualExpanded(false);
      return;
    }

    setIsAdminExpanded(false);
  }, [isAdminRoute, visibleAdminItems.length]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handlePrimaryNavClick = () => {
    setIsDashboardExpanded(false);
    setExpandedManagementGroup(null);
    setIsAulaVirtualExpanded(false);
    setIsAdminExpanded(false);
    setOpen(false);
  };

  const handleDashboardClick = () => {
    const nextExpanded = !isDashboardExpanded;
    setIsDashboardExpanded(nextExpanded);
    setExpandedManagementGroup(null);
    setIsAulaVirtualExpanded(false);
    setIsAdminExpanded(false);

    if (nextExpanded) {
      const defaultSectionKey = activeDashboardSection || visibleDashboardItems[0]?.key;
      if (defaultSectionKey && !isDashboardRoute) {
        navigate(buildDashboardSectionPath(defaultSectionKey));
      }
    }
  };

  const handleManagementGroupClick = (group) => {
    const nextExpandedGroup = expandedManagementGroup === group.key ? null : group.key;
    setExpandedManagementGroup(nextExpandedGroup);
    setIsDashboardExpanded(false);
    setIsAulaVirtualExpanded(false);
    setIsAdminExpanded(false);

    if (nextExpandedGroup) {
      const defaultSectionKey = group.items[0]?.key;
      if (defaultSectionKey && (!isManagementRoute || activeManagementGroupKey !== group.key)) {
        navigate(buildManagementSectionPath(defaultSectionKey));
      }
    }
  };

  const handleAulaVirtualClick = () => {
    const nextExpanded = !isAulaVirtualExpanded;
    setIsAulaVirtualExpanded(nextExpanded);
    setIsDashboardExpanded(false);
    setExpandedManagementGroup(null);
    setIsAdminExpanded(false);

    if (nextExpanded && visibleAulaVirtualItems.length > 0) {
      if (!isAulaVirtualRoute) {
        navigate(visibleAulaVirtualItems[0].to);
      }
    }
  };

  const handleAdminClick = () => {
    const nextExpanded = !isAdminExpanded;
    setIsAdminExpanded(nextExpanded);
    setIsDashboardExpanded(false);
    setExpandedManagementGroup(null);
    setIsAulaVirtualExpanded(false);

    if (nextExpanded && visibleAdminItems.length > 0 && !isAdminRoute) {
      navigate(visibleAdminItems[0].to);
    }
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside
        className={`fixed left-0 top-0 z-20 flex h-full w-[260px] transform flex-col overflow-y-auto border-r border-primary-200 bg-primary-900 text-primary-50 transition lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="p-4 pb-2">
          <h1 className="text-xl font-semibold">Computron</h1>
          <p className="mt-2 truncate text-sm text-slate-300">{user?.first_name} {user?.last_name}</p>
          <p className="truncate text-xs text-slate-400">{roles.join(' · ')}</p>
        </div>

        <nav className="flex-1 space-y-1 p-3 pb-5">
          {isAlumnoProfile ? (
            resolvedItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={handlePrimaryNavClick}
                onMouseEnter={() => preloadRoute(item.to)}
                onFocus={() => preloadRoute(item.to)}
                className={({ isActive }) =>
                  `group block rounded-xl px-3 py-2 text-sm font-medium transition ${isNavItemActive(item.to, isActive)
                    ? 'bg-primary-500 text-white'
                    : 'text-primary-100 hover:bg-primary-800 hover:text-white'
                  }`
                }
              >
                {({ isActive }) => renderSidebarLabel(item.label, item.icon, isNavItemActive(item.to, isActive))}
              </NavLink>
            ))
          ) : (
            <>
              {visibleDashboardItems.length ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={handleDashboardClick}
                    onMouseEnter={() => preloadRoute('/')}
                    onFocus={() => preloadRoute('/')}
                    className={
                      `group block w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${dashboardMenuActive
                        ? 'bg-primary-500 text-white'
                        : 'text-primary-100 hover:bg-primary-800 hover:text-white'
                      }`
                    }
                  >
                    {renderSidebarLabel('Dashboard', House, dashboardMenuActive, {
                      trailing: <ChevronIcon className={`h-4 w-4 transition ${isDashboardExpanded ? 'rotate-180' : ''}`} />,
                    })}
                  </button>

                  <div
                    className={`overflow-hidden transition-all duration-200 ${isDashboardExpanded ? 'max-h-[220px] opacity-100' : 'max-h-0 opacity-0'
                      }`}
                  >
                    <div className="ml-3 space-y-1 pl-3 pt-1">
                      {visibleDashboardItems.map((item) => {
                        const isSubItemActive = activeDashboardSection === item.key;
                        return (
                          <NavLink
                            key={item.key}
                            to={buildDashboardSectionPath(item.key)}
                            onClick={() => setOpen(false)}
                            onMouseEnter={() => preloadRoute('/')}
                            onFocus={() => preloadRoute('/')}
                            className={() =>
                              `group block rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] transition ${isSubItemActive
                                ? 'bg-primary-800 text-white'
                                : 'text-primary-200 hover:bg-primary-800 hover:text-white'
                              }`
                            }
                          >
                            {renderSidebarLabel(item.label, item.icon, isSubItemActive, { compact: true })}
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}

              {visibleManagementGroups.map((group) => {
                const isGroupExpanded = expandedManagementGroup === group.key;
                const isGroupActive = isGroupExpanded || (isManagementRoute && activeManagementGroupKey === group.key);
                const GroupIcon = group.icon;

                return (
                  <div key={group.key} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => handleManagementGroupClick(group)}
                      onMouseEnter={() => preloadRoute('/management')}
                      onFocus={() => preloadRoute('/management')}
                      className={
                        `group block w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${isGroupActive
                          ? 'bg-primary-500 text-white'
                          : 'text-primary-100 hover:bg-primary-800 hover:text-white'
                        }`
                      }
                    >
                      {renderSidebarLabel(group.label, GroupIcon, isGroupActive, {
                        trailing: <ChevronIcon className={`h-4 w-4 transition ${isGroupExpanded ? 'rotate-180' : ''}`} />,
                      })}
                    </button>

                    <div
                      className={`overflow-hidden transition-all duration-200 ${isGroupExpanded ? 'max-h-[360px] opacity-100' : 'max-h-0 opacity-0'
                        }`}
                    >
                      <div className="ml-3 space-y-1 pl-3 pt-1">
                        {group.items.map((item) => {
                          const isSubItemActive = activeManagementSection === item.key;
                          const itemPath = buildManagementSectionPath(item.key);
                          return (
                            <NavLink
                              key={item.key}
                              to={itemPath}
                              onClick={() => {
                                setExpandedManagementGroup(group.key);
                                setOpen(false);
                              }}
                              onMouseEnter={() => preloadRoute(itemPath)}
                              onFocus={() => preloadRoute(itemPath)}
                              className={() =>
                                `group block rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] transition ${isSubItemActive
                                  ? 'bg-primary-800 text-white'
                                  : 'text-primary-200 hover:bg-primary-800 hover:text-white'
                                }`
                              }
                            >
                              {renderSidebarLabel(item.label, item.icon, isSubItemActive, { compact: true })}
                            </NavLink>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}

              {visibleAulaVirtualItems.length ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={handleAulaVirtualClick}
                    onMouseEnter={() => preloadRoute('/courses')}
                    onFocus={() => preloadRoute('/courses')}
                    className={
                      `group block w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${isAulaVirtualExpanded || isAulaVirtualRoute
                        ? 'bg-primary-500 text-white'
                        : 'text-primary-100 hover:bg-primary-800 hover:text-white'
                      }`
                    }
                  >
                    {renderSidebarLabel('Aula Virtual', BookOpenText, isAulaVirtualExpanded || isAulaVirtualRoute, {
                      trailing: <ChevronIcon className={`h-4 w-4 transition ${isAulaVirtualExpanded ? 'rotate-180' : ''}`} />,
                    })}
                  </button>

                  <div
                    className={`overflow-hidden transition-all duration-200 ${isAulaVirtualExpanded ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0'
                      }`}
                  >
                    <div className="ml-3 space-y-1 pl-3 pt-1">
                      {visibleAulaVirtualItems.map((item) => {
                        const pathWithoutSearch = item.to.split('?')[0];
                        const isSubItemActive = isNavItemActive(item.to, location.pathname === pathWithoutSearch);
                        return (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            onClick={() => setOpen(false)}
                            onMouseEnter={() => preloadRoute(pathWithoutSearch)}
                            onFocus={() => preloadRoute(pathWithoutSearch)}
                            className={() =>
                              `group block rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] transition ${isSubItemActive
                                ? 'bg-primary-800 text-white'
                                : 'text-primary-200 hover:bg-primary-800 hover:text-white'
                              }`
                            }
                          >
                            {renderSidebarLabel(item.label, item.icon, isSubItemActive, { compact: true })}
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}

              {resolvedItems.length ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={handleAdminClick}
                    onMouseEnter={() => preloadRoute('/users')}
                    onFocus={() => preloadRoute('/users')}
                    className={
                      `group block w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${adminMenuActive
                        ? 'bg-primary-500 text-white'
                        : 'text-primary-100 hover:bg-primary-800 hover:text-white'
                      }`
                    }
                  >
                    {renderSidebarLabel('Administración', ShieldCheck, adminMenuActive, {
                      trailing: <ChevronIcon className={`h-4 w-4 transition ${isAdminExpanded ? 'rotate-180' : ''}`} />,
                    })}
                  </button>

                  <div
                    className={`overflow-hidden transition-all duration-200 ${isAdminExpanded ? 'max-h-[220px] opacity-100' : 'max-h-0 opacity-0'
                      }`}
                  >
                    <div className="ml-3 space-y-1 pl-3 pt-1">
                      {resolvedItems.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === '/'}
                          onClick={() => {
                            setIsAdminExpanded(true);
                            setOpen(false);
                          }}
                          onMouseEnter={() => preloadRoute(item.to)}
                          onFocus={() => preloadRoute(item.to)}
                          className={({ isActive }) =>
                            `group block rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] transition ${isNavItemActive(item.to, isActive)
                              ? 'bg-primary-800 text-white'
                              : 'text-primary-200 hover:bg-primary-800 hover:text-white'
                            }`
                          }
                        >
                          {({ isActive }) => renderSidebarLabel(item.label, item.icon, isNavItemActive(item.to, isActive), { compact: true })}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </nav>

        <div className="mt-auto border-t border-primary-700 p-3">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-lg border border-primary-300 px-3 py-2 text-sm font-medium text-primary-50 transition hover:bg-primary-800"
          >
            <span className="flex items-center justify-center gap-2">
              <LogOut className="h-4 w-4" />
              <span>Cerrar sesión</span>
            </span>
          </button>
        </div>
      </aside>

      <div className="min-h-screen min-w-0 lg:ml-0">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium lg:hidden dark:border-white/20 dark:text-white"
            >
              <span className="flex items-center gap-2">
                <Menu className="h-4 w-4" />
                <span>Menú</span>
              </span>
            </button>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Sistema de Gestión</h2>
          </div>

          <div />
        </header>

        <main className={isCertificatesRoute ? 'w-full min-w-0 p-2 md:p-3' : 'mx-auto w-full max-w-7xl min-w-0 p-3 sm:p-4 md:p-6'}>
          <Outlet key={location.pathname} />
        </main>
      </div>

      {open ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-10 bg-primary-950/30 lg:hidden"
        />
      ) : null}
    </div>
  );
}
