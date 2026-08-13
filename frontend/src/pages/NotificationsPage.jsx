import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import PaginationControls from '../components/PaginationControls';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../constants/permissions';
import { downloadCsv } from '../utils/csv';
import { fetchAllPages } from '../utils/paginatedFetch';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export default function NotificationsPage() {
  const { hasPermission } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [job, setJob] = useState(null);

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const canViewNotifications = hasPermission(PERMISSIONS.NOTIFICATIONS_VIEW);
  const canManageNotifications = hasPermission(PERMISSIONS.NOTIFICATIONS_MANAGE);

  const filterParams = useMemo(
    () => ({
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      q: search || undefined,
    }),
    [search, statusFilter],
  );

  const loadNotifications = useCallback(
    async ({ targetPage = page, targetPageSize = pageSize } = {}) => {
      if (!canViewNotifications) {
        setNotifications([]);
        setTotal(0);
        return;
      }

      setLoadingNotifications(true);
      try {
        const response = await api.get('/notifications', {
          params: {
            ...filterParams,
            page: targetPage,
            page_size: targetPageSize,
          },
        });

        const items = response.data.items || [];
        const meta = response.data.meta || {};
        const totalRows = Number(meta.total || items.length);
        const totalPages = Math.max(1, Math.ceil(totalRows / targetPageSize));

        if (targetPage > totalPages) {
          setPage(totalPages);
          return;
        }

        setNotifications(items);
        setTotal(totalRows);
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'No se pudieron cargar las notificaciones.');
      } finally {
        setLoadingNotifications(false);
      }
    },
    [canViewNotifications, filterParams, page, pageSize],
  );

  useEffect(() => {
    const debounce = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);

    return () => clearTimeout(debounce);
  }, [searchInput]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const runReminder = async () => {
    if (!canManageNotifications) return;

    setRunning(true);
    setMessage('');
    setError('');

    try {
      const response = await api.post('/notifications/reminders/run');
      const queuedJob = response.data.job;
      setJob(queuedJob || null);
      setMessage(`Proceso en cola. Job: ${queuedJob?.id || 'N/A'}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo ejecutar el recordatorio.');
    } finally {
      setRunning(false);
    }
  };

  const clearFilters = () => {
    setStatusFilter('ALL');
    setSearchInput('');
    setSearch('');
    setPage(1);
  };

  const exportNotificationsCsv = async () => {
    if (!canViewNotifications) return;

    setExporting(true);
    setMessage('');
    setError('');

    try {
      const allNotifications = await fetchAllPages({
        path: '/notifications',
        params: filterParams,
      });

      const rows = allNotifications.map((item) => ({
        id: item.id,
        fecha_programada: item.scheduled_at ? new Date(item.scheduled_at).toLocaleString() : '',
        fecha_envio: item.sent_at ? new Date(item.sent_at).toLocaleString() : '',
        destinatario: item.recipient || '',
        asunto: item.subject || '',
        estado: item.status || '',
        error: item.error_message || '',
      }));

      await downloadCsv({
        filename: `notificaciones_${new Date().toISOString().slice(0, 10)}.csv`,
        headers: [
          { key: 'id', label: 'ID' },
          { key: 'fecha_programada', label: 'Fecha programada' },
          { key: 'fecha_envio', label: 'Fecha envio' },
          { key: 'destinatario', label: 'Destinatario' },
          { key: 'asunto', label: 'Asunto' },
          { key: 'estado', label: 'Estado' },
          { key: 'error', label: 'Error' },
        ],
        rows,
      });

      setMessage(`Exportacion completada: ${rows.length} notificaciones.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo exportar el Excel de notificaciones.');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!canManageNotifications || !job?.id) return undefined;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return undefined;

    const interval = setInterval(async () => {
      try {
        const response = await api.get(`/notifications/jobs/${job.id}`);
        const latestJob = response.data.item;
        setJob(latestJob);

        if (latestJob.status === 'COMPLETED') {
          const summary = latestJob.summary || {};
          setMessage(
            `Proceso completado. Cuotas: ${summary.due_installments || 0}, enviados: ${summary.sent || 0}, simulados: ${summary.simulated || 0}, fallidos: ${summary.failed || 0}.`,
          );
          await loadNotifications();
        }

        if (latestJob.status === 'FAILED') {
          setError(latestJob.error_message || 'El proceso de recordatorios fallo.');
        }
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'No se pudo consultar el estado del job.');
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [canManageNotifications, job?.id, job?.status, loadNotifications]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (!canViewNotifications && !canManageNotifications) {
    return (
      <section className="card">
        <h1 className="text-xl font-semibold">Notificaciones</h1>
        <p className="mt-2 text-sm text-primary-700">No tienes permisos para acceder a este modulo.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary-900">Notificaciones</h1>
          <p className="text-sm text-primary-700">Seguimiento de envios por correo y recordatorios automaticos.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-800">
            {notifications.length} en pagina / {total} total
          </span>
          <button
            type="button"
            onClick={exportNotificationsCsv}
            disabled={!canViewNotifications || loadingNotifications || exporting}
            className="rounded-lg border border-primary-300 bg-white px-3 py-2 text-sm font-semibold text-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting ? 'Exportando...' : 'Exportar Excel'}
          </button>
          {canManageNotifications ? (
            <button
              type="button"
              onClick={runReminder}
              disabled={running}
              className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800 disabled:opacity-70"
            >
              {running ? 'Ejecutando...' : 'Ejecutar recordatorios'}
            </button>
          ) : null}
        </div>
      </div>

      {message ? <p className="rounded-xl bg-primary-50 p-3 text-sm text-primary-800">{message}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {job ? (
        <p className="rounded-xl bg-accent-50 p-3 text-sm text-accent-800">
          Job {job.id}: {job.status}
        </p>
      ) : null}

      {canViewNotifications ? (
        <article className="card overflow-x-auto">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Historial de notificaciones</h2>
            <button
              type="button"
              onClick={clearFilters}
              disabled={loadingNotifications}
              className="rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Limpiar filtros
            </button>
          </div>

          <div className="mb-3 grid gap-2 lg:grid-cols-2">
            <input
              className="app-input"
              placeholder="Buscar por destinatario, asunto o error"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <select
              className="app-input"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">Todos los estados</option>
              <option value="SENT">Enviadas</option>
              <option value="PENDING">Pendientes</option>
              <option value="FAILED">Fallidas</option>
            </select>
          </div>

          <table className="mt-3 min-w-full text-sm">
            <thead>
              <tr className="text-left text-primary-600">
                <th className="pb-2 pr-3">Fecha</th>
                <th className="pb-2 pr-3">Destinatario</th>
                <th className="pb-2 pr-3">Asunto</th>
                <th className="pb-2 pr-3">Estado</th>
                <th className="pb-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((item) => (
                <tr key={item.id} className="border-t border-primary-100">
                  <td className="py-2 pr-3">{new Date(item.scheduled_at).toLocaleString()}</td>
                  <td className="py-2 pr-3">{item.recipient}</td>
                  <td className="py-2 pr-3">{item.subject}</td>
                  <td className="py-2 pr-3">{item.status}</td>
                  <td className="py-2">{item.error_message || '-'}</td>
                </tr>
              ))}

              {!loadingNotifications && notifications.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-sm text-primary-600">
                    No se encontraron notificaciones con ese criterio.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <PaginationControls
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setPage}
            onPageSizeChange={(nextSize) => {
              setPageSize(nextSize);
              setPage(1);
            }}
            disabled={loadingNotifications}
            label="notificaciones"
          />
        </article>
      ) : null}
    </section>
  );
}
