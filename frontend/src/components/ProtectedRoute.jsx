import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute() {
  const { isAuthenticated, loading, mustChangePassword } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <section className="mx-auto mt-6 w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
        Validando sesión...
      </section>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  if (!mustChangePassword && location.pathname === '/change-password') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
