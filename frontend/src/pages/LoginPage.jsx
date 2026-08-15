import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const COMPUTRON_LOGO_SRC = '/brand/logo-computron-transparent.png';
const ACCOUNT_PENDING_ACTIVATION = 'ACCOUNT_PENDING_ACTIVATION';
const FIELD_ICON_CLASS = 'pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400';
const AUTH_INPUT_CLASS = 'app-input h-11 rounded-lg border-slate-200 bg-white/95 text-[15px]';
const LOGO_BOX_CLASS = 'mx-auto flex h-[96px] w-[260px] max-w-full items-center justify-center';

const getPostLoginPath = (user) => (user?.must_change_password ? '/change-password' : '/');

const replaceWithFreshApp = (path) => {
  if (typeof window === 'undefined') return;
  window.location.replace(path);
};

export default function LoginPage() {
  const { login, loading, isAuthenticated, mustChangePassword } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [activationForm, setActivationForm] = useState({ email: '', code: '' });
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activationBusy, setActivationBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isActivationMode = mode === 'activate';
  const cardTitle = isActivationMode ? 'Activar cuenta' : 'Ingreso al sistema';

  useEffect(() => {
    if (isAuthenticated) {
      replaceWithFreshApp(mustChangePassword ? '/change-password' : '/');
    }
  }, [isAuthenticated, mustChangePassword]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');

    const result = await login(form.email, form.password);
    if (!result.ok) {
      if (result.code === ACCOUNT_PENDING_ACTIVATION) {
        const pendingEmail = result.email || form.email.trim().toLowerCase();
        setActivationForm((prev) => ({ ...prev, email: pendingEmail }));
        setMode('activate');
        setNotice('Ingresa el código enviado al correo para activar la cuenta.');
        return;
      }
      setError(result.message || 'Credenciales inválidas.');
      return;
    }

    replaceWithFreshApp(getPostLoginPath(result.user));
  };

  const handleActivationSubmit = async (event) => {
    event.preventDefault();
    setActivationBusy(true);
    setError('');
    setNotice('');

    try {
      const response = await api.post('/auth/activate', {
        email: activationForm.email.trim().toLowerCase(),
        code: activationForm.code.trim(),
      });
      setForm((prev) => ({ ...prev, email: activationForm.email.trim().toLowerCase(), password: '' }));
      setActivationForm((prev) => ({ ...prev, code: '' }));
      setMode('login');
      setNotice(response.data?.message || 'Cuenta activada. Ya puedes iniciar sesión.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo activar la cuenta.');
    } finally {
      setActivationBusy(false);
    }
  };

  const handleResendActivationCode = async () => {
    const email = activationForm.email.trim().toLowerCase() || form.email.trim().toLowerCase();
    if (!email) {
      setError('Ingresa el correo para reenviar el código.');
      return;
    }

    setActivationBusy(true);
    setError('');
    setNotice('');

    try {
      const response = await api.post('/auth/activation/resend', { email });
      const previewCode = response.data?.activation?.activation_code_preview;
      setActivationForm((prev) => ({ ...prev, email }));
      setNotice(
        previewCode
          ? `Código reenviado. Modo local: ${previewCode}`
          : response.data?.message || 'Si la cuenta está pendiente, se enviará un nuevo código.',
      );
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo reenviar el código.');
    } finally {
      setActivationBusy(false);
    }
  };

  const switchToLogin = () => {
    setMode('login');
    setError('');
    setNotice('');
  };

  const switchToActivation = () => {
    setActivationForm((prev) => ({
      ...prev,
      email: prev.email || form.email.trim().toLowerCase(),
    }));
    setMode('activate');
    setError('');
    setNotice('');
  };

  const selectMode = (nextMode) => {
    if (nextMode === mode) return;
    if (nextMode === 'activate') {
      switchToActivation();
      return;
    }
    switchToLogin();
  };

  return (
    <main className="min-h-screen bg-[#f4f8f7] text-slate-950">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(90deg,rgba(28,104,93,0.05)_1px,transparent_1px),linear-gradient(180deg,rgba(28,104,93,0.045)_1px,transparent_1px)] bg-[size:44px_44px]" />
      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:gap-10 lg:px-8">
        <section className="hidden h-[620px] flex-col justify-between rounded-lg border border-white/80 bg-white/70 p-8 shadow-[0_22px_70px_rgba(18,38,32,0.10)] backdrop-blur lg:flex">
          <div className="text-center">
            <div className={LOGO_BOX_CLASS}>
              <img
                src={COMPUTRON_LOGO_SRC}
                alt="Computron"
                className="h-auto max-h-[92px] w-full object-contain"
                width="445"
                height="165"
              />
            </div>
          </div>

          <div className="mx-auto max-w-xl text-center">
            <div className="mx-auto inline-flex h-10 items-center gap-2 rounded-lg border border-primary-100 bg-white px-3 text-sm font-semibold text-primary-800">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              Sistema administrativo
            </div>
            <h1 className="mt-5 text-3xl font-semibold leading-tight text-primary-950">
              Operación clara para caja, alumnos y documentos.
            </h1>
            <p className="mx-auto mt-4 max-w-md text-base leading-7 text-slate-600">
              Un ingreso limpio para que el personal administrativo avance directo al trabajo diario.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              ['Caja', 'Cobros'],
              ['Alumnos', 'Gestión'],
              ['Boletas', 'Emisión'],
            ].map(([title, helper]) => (
              <div key={title} className="min-h-[78px] rounded-lg border border-slate-200 bg-white px-4 py-3 text-center">
                <p className="text-sm font-semibold text-primary-950">{title}</p>
                <p className="mt-1 text-xs font-medium text-slate-500">{helper}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex min-h-[calc(100vh-2.5rem)] items-center justify-center lg:min-h-0">
          <div className="flex min-h-[600px] w-full max-w-[440px] flex-col rounded-lg border border-white/90 bg-white p-5 shadow-[0_22px_70px_rgba(18,38,32,0.14)] sm:p-7 lg:h-[620px]">
            <div className="text-center">
              <div className={LOGO_BOX_CLASS}>
                <img
                  src={COMPUTRON_LOGO_SRC}
                  alt="Computron"
                  className="h-auto max-h-[92px] w-full object-contain"
                  width="445"
                  height="165"
                />
              </div>
              <div className="mt-3">
                <p className="text-sm font-semibold text-primary-700">Instituto Computron</p>
                <h1 className="mt-1 text-[1.55rem] font-semibold text-primary-950">{cardTitle}</h1>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
              {[
                ['login', 'Ingreso'],
                ['activate', 'Activación'],
              ].map(([value, label]) => {
                const selected = mode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => selectMode(value)}
                    aria-pressed={selected}
                    style={{
                      backgroundColor: selected ? '#1c685d' : 'transparent',
                      color: selected ? '#ffffff' : '#475569',
                    }}
                    className={`h-9 rounded-md text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200 ${
                      selected
                        ? 'bg-primary-700 text-white shadow-[0_1px_3px_rgba(18,38,32,0.12)]'
                        : 'text-slate-600 hover:bg-white hover:text-primary-900'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {mode === 'login' ? (
              <form className="mt-6 flex flex-1 flex-col" onSubmit={handleSubmit}>
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Correo</label>
                    <div className="relative">
                      <Mail className={FIELD_ICON_CLASS} aria-hidden="true" />
                      <input
                        type="email"
                        required
                        className={AUTH_INPUT_CLASS}
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
                      <LockKeyhole className={FIELD_ICON_CLASS} aria-hidden="true" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        className={AUTH_INPUT_CLASS}
                        style={{ paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                        value={form.password}
                        onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                        placeholder="********"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-primary-800"
                        aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  {notice ? <p className="app-alert app-alert-info">{notice}</p> : null}
                  {error ? <p className="app-alert app-alert-danger">{error}</p> : null}
                </div>

                <button
                  type="submit"
                  disabled={loading || isAuthenticated}
                  className="btn-primary mt-5 h-11 w-full"
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  <span>{loading || isAuthenticated ? 'Validando...' : 'Ingresar'}</span>
                  {!loading && !isAuthenticated ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
                </button>

              </form>
            ) : (
              <form className="mt-6 flex flex-1 flex-col" onSubmit={handleActivationSubmit}>
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Correo</label>
                    <div className="relative">
                      <Mail className={FIELD_ICON_CLASS} aria-hidden="true" />
                      <input
                        type="email"
                        required
                        className={AUTH_INPUT_CLASS}
                        style={{ paddingLeft: '2.75rem' }}
                        value={activationForm.email}
                        onChange={(event) => setActivationForm((prev) => ({ ...prev, email: event.target.value }))}
                        placeholder="correo@dominio.com"
                        autoComplete="username"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Código</label>
                    <div className="relative">
                      <KeyRound className={FIELD_ICON_CLASS} aria-hidden="true" />
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        className={`${AUTH_INPUT_CLASS} text-center text-lg font-semibold tabular-nums`}
                        style={{ paddingLeft: '2.75rem' }}
                        value={activationForm.code}
                        onChange={(event) =>
                          setActivationForm((prev) => ({
                            ...prev,
                            code: event.target.value.replace(/\D/g, '').slice(0, 6),
                          }))
                        }
                        placeholder="000000"
                        autoComplete="one-time-code"
                      />
                    </div>
                  </div>

                  {notice ? <p className="app-alert app-alert-info">{notice}</p> : null}
                  {error ? <p className="app-alert app-alert-danger">{error}</p> : null}
                </div>

                <button type="submit" disabled={activationBusy} className="btn-primary mt-5 h-11 w-full">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  <span>{activationBusy ? 'Validando...' : 'Activar cuenta'}</span>
                </button>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleResendActivationCode}
                    disabled={activationBusy}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-primary-200 text-sm font-semibold text-primary-800 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Reenviar
                  </button>
                  <button
                    type="button"
                    onClick={switchToLogin}
                    disabled={activationBusy}
                    className="h-10 rounded-lg border border-primary-200 text-sm font-semibold text-primary-800 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Volver
                  </button>
                </div>
              </form>
            )}

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
