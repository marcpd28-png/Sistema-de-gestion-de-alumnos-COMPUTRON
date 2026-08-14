import { useEffect, useState } from 'react';
import { ArrowRight, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const COMPUTRON_LOGO_SRC = '/brand/logo-computron-transparent.png';

const getPostLoginPath = (user) => (user?.must_change_password ? '/change-password' : '/');

const replaceWithFreshApp = (path) => {
  if (typeof window === 'undefined') return;
  window.location.replace(path);
};

export default function LoginPage() {
  const { login, loading, isAuthenticated, mustChangePassword } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      replaceWithFreshApp(mustChangePassword ? '/change-password' : '/');
    }
  }, [isAuthenticated, mustChangePassword]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const result = await login(form.email, form.password);
    if (!result.ok) {
      setError(result.message || 'Credenciales inválidas.');
      return;
    }

    replaceWithFreshApp(getPostLoginPath(result.user));
  };

  return (
    <main className="min-h-screen bg-[#eef5f4] text-slate-950">
      <div className="mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 px-4 py-5 sm:px-6 lg:grid-cols-[1fr_440px] lg:items-center lg:gap-10 lg:px-8">
        <section className="hidden min-h-[620px] flex-col justify-between rounded-lg border border-white/70 bg-white/55 p-8 shadow-[0_24px_80px_rgba(16,58,58,0.12)] lg:flex">
          <div>
            <div className="inline-flex h-20 w-56 items-center">
              <img
                src={COMPUTRON_LOGO_SRC}
                alt="Computron"
                className="h-auto w-full object-contain"
                width="445"
                height="165"
              />
            </div>
          </div>

          <div className="max-w-xl">
            <p className="text-sm font-semibold uppercase text-primary-700">Sistema administrativo</p>
            <h1 className="mt-4 max-w-lg text-4xl font-semibold leading-tight text-primary-950">
              Gestión académica y caja en un solo lugar.
            </h1>
            <p className="mt-4 max-w-md text-base leading-7 text-slate-600">
              Acceso institucional para administrar alumnos, pagos, boletas, reportes y operaciones diarias.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {['Caja', 'Alumnos', 'Boletas'].map((item) => (
              <div key={item} className="rounded-lg border border-primary-100 bg-white/80 px-4 py-3">
                <p className="text-sm font-semibold text-primary-900">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex min-h-[calc(100vh-2.5rem)] items-center justify-center lg:min-h-0">
          <div className="w-full max-w-[440px] rounded-lg border border-white/80 bg-white p-5 shadow-[0_22px_60px_rgba(15,70,65,0.14)] sm:p-7">
            <div className="mb-7 text-center">
              <div className="mx-auto flex h-24 w-64 max-w-full items-center justify-center">
                <img
                  src={COMPUTRON_LOGO_SRC}
                  alt="Computron"
                  className="h-auto max-h-24 w-full object-contain"
                  width="445"
                  height="165"
                />
              </div>
              <div className="mt-5">
                <p className="text-sm font-semibold text-primary-700">Instituto Computron</p>
                <h1 className="mt-1 text-2xl font-semibold text-primary-950">Ingreso al sistema</h1>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Correo</label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    type="email"
                    required
                    className="app-input"
                    style={{ paddingLeft: '2.75rem' }}
                    value={form.email}
                    onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                    placeholder="admin@computron.com"
                    autoComplete="username"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Contraseña</label>
                <div className="relative">
                  <LockKeyhole
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    type="password"
                    required
                    className="app-input"
                    style={{ paddingLeft: '2.75rem' }}
                    value={form.password}
                    onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                    placeholder="********"
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {error ? <p className="app-alert app-alert-danger">{error}</p> : null}

              <button
                type="submit"
                disabled={loading || isAuthenticated}
                className="btn-primary h-11 w-full"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>{loading || isAuthenticated ? 'Validando...' : 'Ingresar'}</span>
                {!loading && !isAuthenticated ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
              </button>
            </form>

            <div className="mt-6 border-t border-slate-100 pt-4 text-center">
              <p className="text-xs font-medium text-slate-500">Acceso reservado para personal autorizado.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export { getPostLoginPath };
