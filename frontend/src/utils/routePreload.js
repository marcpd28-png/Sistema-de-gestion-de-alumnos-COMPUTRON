const routeLoaders = {
  '/login': () => import('../pages/LoginPage'),
  '/': () => import('../pages/DashboardPage'),
  '/management': () => import('../pages/ManagementPage'),
  '/students': () => import('../pages/StudentsPage'),
  '/teachers': () => import('../pages/TeachersPage'),
  '/courses': () => import('../pages/CoursesPage'),
  '/courses/salon': () => import('../pages/CourseWorkspacePage'),
  '/courses/salon/examen/nuevo': () => import('../pages/ExamBuilderPage'),
  '/my-grades': () => import('../pages/StudentGradesPage'),
  '/calendar': () => import('../pages/CalendarPage'),
  '/payments': () => import('../pages/PaymentsPage'),
  '/certificate-library': () => import('../pages/CertificateLibraryPage'),
  '/virtual-library': () => import('../pages/VirtualLibraryPage'),
  '/certificates': () => import('../pages/CertificatesPage'),
  '/users': () => import('../pages/UsersPage'),
};

const preloadedRoutes = new Set();
const DEFAULT_CORE_ROUTE_PRELOAD_ORDER = ['/'];

let corePreloadInProgress = false;
let corePreloadQueue = [];
let cancelScheduledStep = null;

const normalizeRoute = (path = '') => {
  const normalizedPath = String(path || '').split('?')[0].split('#')[0];
  if (/^\/courses\/salon\/[^/]+\/examen\/nuevo$/.test(normalizedPath)) return '/courses/salon/examen/nuevo';
  if (normalizedPath.startsWith('/courses/salon/')) return '/courses/salon';
  return normalizedPath;
};

const isPreloadConnectionSuitable = () => {
  if (typeof navigator === 'undefined') return true;

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return true;
  if (connection.saveData) return false;

  const effectiveType = String(connection.effectiveType || '').toLowerCase();
  if (effectiveType.includes('2g') || effectiveType.includes('slow-2g')) return false;
  return true;
};

const scheduleIdleTask = (callback, timeout = 2500) => {
  if (typeof window === 'undefined') return () => {};

  if (typeof window.requestIdleCallback === 'function') {
    const idleId = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback?.(idleId);
  }

  const timeoutId = window.setTimeout(callback, 200);
  return () => window.clearTimeout(timeoutId);
};

const runNextCorePreloadStep = () => {
  if (!corePreloadQueue.length) {
    corePreloadInProgress = false;
    cancelScheduledStep = null;
    return;
  }

  const nextPath = corePreloadQueue.shift();
  preloadRoute(nextPath);
  cancelScheduledStep = scheduleIdleTask(runNextCorePreloadStep, 3000);
};

export const preloadRoute = (path) => {
  const normalizedPath = normalizeRoute(String(path || ''));
  const loader = routeLoaders[normalizedPath];
  if (!loader || preloadedRoutes.has(normalizedPath)) return;

  preloadedRoutes.add(normalizedPath);
  loader().catch(() => {
    preloadedRoutes.delete(normalizedPath);
  });
};

export const preloadCoreRoutes = (routes = DEFAULT_CORE_ROUTE_PRELOAD_ORDER) => {
  if (typeof window === 'undefined') return () => {};
  if (!isPreloadConnectionSuitable()) return () => {};
  if (corePreloadInProgress) return () => {};

  const preloadOrder = Array.from(
    new Set((Array.isArray(routes) && routes.length ? routes : DEFAULT_CORE_ROUTE_PRELOAD_ORDER).map(normalizeRoute)),
  ).filter((path) => routeLoaders[path]);

  corePreloadInProgress = true;
  corePreloadQueue = preloadOrder.filter((path) => !preloadedRoutes.has(path));
  cancelScheduledStep = scheduleIdleTask(runNextCorePreloadStep, 2500);

  return () => {
    cancelScheduledStep?.();
    cancelScheduledStep = null;
    corePreloadQueue = [];
    corePreloadInProgress = false;
  };
};
