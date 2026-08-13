import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, loading, isAuthenticated, mustChangePassword } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');

  if (isAuthenticated) {
    return <Navigate to={mustChangePassword ? '/change-password' : '/'} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const result = await login(form.email, form.password);
    if (!result.ok) {
      setError(result.message || 'Credenciales inválidas.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-primary-100 bg-white p-6">
        <div className="mb-6 border-b border-slate-100 pb-4">
          <p className="text-sm font-semibold text-primary-700">Instituto Computron</p>
          <h1 className="mt-1 text-2xl font-semibold text-primary-900">Ingreso al sistema</h1>
          <p className="mt-1 text-sm text-slate-600">Accede con tu usuario institucional.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-sm font-medium">Correo</label>
            <input
              type="email"
              required
              className="app-input"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="admin@computron.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Contraseña</label>
            <input
              type="password"
              required
              className="app-input"
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="********"
            />
          </div>

          {error ? <p className="app-alert app-alert-danger">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? 'Validando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
