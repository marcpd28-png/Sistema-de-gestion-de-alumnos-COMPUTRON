import { Component } from 'react';

const STALE_CHUNK_RELOAD_KEY = 'computron_stale_chunk_reloaded';
const STALE_CHUNK_RELOAD_WINDOW_MS = 60_000;

const isStaleChunkError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('loading chunk') ||
    message.includes('importing a module script failed') ||
    message.includes('error loading dynamically imported module')
  );
};

const getSessionFlag = (key) => {
  try {
    return window.sessionStorage?.getItem(key);
  } catch {
    return null;
  }
};

const setSessionFlag = (key, value) => {
  try {
    window.sessionStorage?.setItem(key, value);
  } catch {
    // no-op
  }
};

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    if (typeof console !== 'undefined') {
      console.error('AppErrorBoundary caught an error:', error, errorInfo);
    }

    if (typeof window !== 'undefined' && isStaleChunkError(error)) {
      const lastReloadAt = Number(getSessionFlag(STALE_CHUNK_RELOAD_KEY) || 0);
      const alreadyReloaded = Date.now() - lastReloadAt < STALE_CHUNK_RELOAD_WINDOW_MS;
      if (!alreadyReloaded) {
        setSessionFlag(STALE_CHUNK_RELOAD_KEY, String(Date.now()));
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="card">
          <h1 className="text-xl font-semibold text-primary-900">Se produjo un error en la interfaz</h1>
          <p className="mt-2 text-sm text-primary-700">
            Recarga la página. Si el problema persiste, el error quedó atrapado para evitar que toda la pantalla se
            quede en blanco.
          </p>
        </section>
      );
    }

    return this.props.children;
  }
}
