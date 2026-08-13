import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import PaginationControls from '../components/PaginationControls';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../constants/permissions';
import { downloadCsv } from '../utils/csv';
import { fetchAllPages } from '../utils/paginatedFetch';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export default function ReportsPage() {
  const { hasPermission } = useAuth();

  const [balances, setBalances] = useState([]);
  const [balanceStudentIdInput, setBalanceStudentIdInput] = useState('');
  const [balanceStudentId, setBalanceStudentId] = useState('');
  const [balancesPage, setBalancesPage] = useState(1);
  const [balancesPageSize, setBalancesPageSize] = useState(20);
  const [balancesTotal, setBalancesTotal] = useState(0);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [exportingBalances, setExportingBalances] = useState(false);

  const [morosity, setMorosity] = useState([]);
  const [morosityPage, setMorosityPage] = useState(1);
  const [morosityPageSize, setMorosityPageSize] = useState(20);
  const [morosityTotal, setMorosityTotal] = useState(0);
  const [loadingMorosity, setLoadingMorosity] = useState(false);
  const [exportingMorosity, setExportingMorosity] = useState(false);

  const [byCampus, setByCampus] = useState([]);
  const [campusDateFrom, setCampusDateFrom] = useState('');
  const [campusDateTo, setCampusDateTo] = useState('');
  const [campusPage, setCampusPage] = useState(1);
  const [campusPageSize, setCampusPageSize] = useState(20);
  const [campusTotal, setCampusTotal] = useState(0);
  const [loadingCampus, setLoadingCampus] = useState(false);
  const [exportingCampus, setExportingCampus] = useState(false);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const canViewReports = hasPermission(PERMISSIONS.REPORTS_VIEW);

  const balanceFilterParams = useMemo(
    () => ({
      student_id: balanceStudentId ? Number(balanceStudentId) : undefined,
    }),
    [balanceStudentId],
  );

  const campusFilterParams = useMemo(
    () => ({
      date_from: campusDateFrom || undefined,
      date_to: campusDateTo || undefined,
    }),
    [campusDateFrom, campusDateTo],
  );

  const loadBalances = useCallback(
    async ({ page = balancesPage, pageSize = balancesPageSize } = {}) => {
      if (!canViewReports) {
        setBalances([]);
        setBalancesTotal(0);
        return;
      }

      setLoadingBalances(true);
      try {
        const response = await api.get('/reports/student-balances', {
          params: {
            ...balanceFilterParams,
            page,
            page_size: pageSize,
          },
        });

        const items = response.data.items || [];
        const meta = response.data.meta || {};
        const total = Number(meta.total || items.length);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        if (page > totalPages) {
          setBalancesPage(totalPages);
          return;
        }

        setBalances(items);
        setBalancesTotal(total);
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'No se pudieron cargar los saldos por alumno.');
      } finally {
        setLoadingBalances(false);
      }
    },
    [balanceFilterParams, balancesPage, balancesPageSize, canViewReports],
  );

  const loadMorosity = useCallback(
    async ({ page = morosityPage, pageSize = morosityPageSize } = {}) => {
      if (!canViewReports) {
        setMorosity([]);
        setMorosityTotal(0);
        return;
      }

      setLoadingMorosity(true);
      try {
        const response = await api.get('/reports/morosity', {
          params: {
            page,
            page_size: pageSize,
          },
        });

        const items = response.data.items || [];
        const meta = response.data.meta || {};
        const total = Number(meta.total || items.length);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        if (page > totalPages) {
          setMorosityPage(totalPages);
          return;
        }

        setMorosity(items);
        setMorosityTotal(total);
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'No se pudo cargar la morosidad.');
      } finally {
        setLoadingMorosity(false);
      }
    },
    [canViewReports, morosityPage, morosityPageSize],
  );

  const loadByCampus = useCallback(
    async ({ page = campusPage, pageSize = campusPageSize } = {}) => {
      if (!canViewReports) {
        setByCampus([]);
        setCampusTotal(0);
        return;
      }

      setLoadingCampus(true);
      try {
        const response = await api.get('/reports/payments-by-campus', {
          params: {
            ...campusFilterParams,
            page,
            page_size: pageSize,
          },
        });

        const items = response.data.items || [];
        const meta = response.data.meta || {};
        const total = Number(meta.total || items.length);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        if (page > totalPages) {
          setCampusPage(totalPages);
          return;
        }

        setByCampus(items);
        setCampusTotal(total);
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'No se pudieron cargar los pagos por sede.');
      } finally {
        setLoadingCampus(false);
      }
    },
    [campusFilterParams, campusPage, campusPageSize, canViewReports],
  );

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  useEffect(() => {
    loadMorosity();
  }, [loadMorosity]);

  useEffect(() => {
    loadByCampus();
  }, [loadByCampus]);

  const applyBalanceFilter = () => {
    const normalized = balanceStudentIdInput.trim();
    if (!normalized) {
      setBalanceStudentId('');
      setBalancesPage(1);
      return;
    }

    const numericValue = Number(normalized);
    if (!Number.isInteger(numericValue) || numericValue <= 0) {
      setError('El ID de alumno debe ser un entero positivo.');
      return;
    }

    setError('');
    setBalanceStudentId(String(numericValue));
    setBalancesPage(1);
  };

  const clearBalanceFilter = () => {
    setBalanceStudentIdInput('');
    setBalanceStudentId('');
    setBalancesPage(1);
  };

  const clearCampusFilters = () => {
    setCampusDateFrom('');
    setCampusDateTo('');
    setCampusPage(1);
  };

  const exportBalancesCsv = async () => {
    if (!canViewReports) return;

    setExportingBalances(true);
    setMessage('');
    setError('');

    try {
      const items = await fetchAllPages({
        path: '/reports/student-balances',
        params: balanceFilterParams,
      });

      const rows = items.map((item) => ({
        student_id: item.student_id,
        student_name: item.student_name || '',
        total_amount: Number(item.total_amount || 0).toFixed(2),
        total_paid: Number(item.total_paid || 0).toFixed(2),
        balance_pending: Number(item.balance_pending || 0).toFixed(2),
      }));

      await downloadCsv({
        filename: `reporte_saldos_${new Date().toISOString().slice(0, 10)}.csv`,
        headers: [
          { key: 'student_id', label: 'Alumno ID' },
          { key: 'student_name', label: 'Alumno' },
          { key: 'total_amount', label: 'Total' },
          { key: 'total_paid', label: 'Pagado' },
          { key: 'balance_pending', label: 'Pendiente' },
        ],
        rows,
      });

      setMessage(`Exportacion completada: ${rows.length} filas de saldos.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo exportar el Excel de saldos.');
    } finally {
      setExportingBalances(false);
    }
  };

  const exportMorosityCsv = async () => {
    if (!canViewReports) return;

    setExportingMorosity(true);
    setMessage('');
    setError('');

    try {
      const items = await fetchAllPages({
        path: '/reports/morosity',
      });

      const rows = items.map((item) => ({
        installment_id: item.installment_id,
        due_date: item.due_date || '',
        student_name: item.student_name || '',
        course_name: item.course_name || '',
        campus_name: item.campus_name || '',
        pending_amount: Number(item.pending_amount || 0).toFixed(2),
      }));

      await downloadCsv({
        filename: `reporte_morosidad_${new Date().toISOString().slice(0, 10)}.csv`,
        headers: [
          { key: 'installment_id', label: 'Cuota ID' },
          { key: 'due_date', label: 'Vencimiento' },
          { key: 'student_name', label: 'Alumno' },
          { key: 'course_name', label: 'Curso' },
          { key: 'campus_name', label: 'Sede' },
          { key: 'pending_amount', label: 'Pendiente' },
        ],
        rows,
      });

      setMessage(`Exportacion completada: ${rows.length} filas de morosidad.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo exportar el Excel de morosidad.');
    } finally {
      setExportingMorosity(false);
    }
  };

  const exportByCampusCsv = async () => {
    if (!canViewReports) return;

    setExportingCampus(true);
    setMessage('');
    setError('');

    try {
      const items = await fetchAllPages({
        path: '/reports/payments-by-campus',
        params: campusFilterParams,
      });

      const rows = items.map((item) => ({
        campus_id: item.campus_id,
        campus_name: item.campus_name || '',
        payment_status: item.payment_status || '',
        payment_count: item.payment_count || 0,
        total_amount: Number(item.total_amount || 0).toFixed(2),
      }));

      await downloadCsv({
        filename: `reporte_pagos_sede_${new Date().toISOString().slice(0, 10)}.csv`,
        headers: [
          { key: 'campus_id', label: 'Sede ID' },
          { key: 'campus_name', label: 'Sede' },
          { key: 'payment_status', label: 'Estado de pago' },
          { key: 'payment_count', label: 'Cantidad pagos' },
          { key: 'total_amount', label: 'Total' },
        ],
        rows,
      });

      setMessage(`Exportacion completada: ${rows.length} filas de pagos por sede.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo exportar el Excel de pagos por sede.');
    } finally {
      setExportingCampus(false);
    }
  };

  const balancesTotalPages = Math.max(1, Math.ceil(balancesTotal / balancesPageSize));
  const morosityTotalPages = Math.max(1, Math.ceil(morosityTotal / morosityPageSize));
  const campusTotalPages = Math.max(1, Math.ceil(campusTotal / campusPageSize));

  if (!canViewReports) {
    return (
      <section className="card">
        <h1 className="text-xl font-semibold">Reportes</h1>
        <p className="mt-2 text-sm text-primary-700">No tienes permisos para acceder a este modulo.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary-900">Reportes</h1>
        <p className="text-sm text-primary-700">Consulta consolidada academica y financiera del instituto.</p>
      </div>

      {message ? <p className="rounded-xl bg-primary-50 p-3 text-sm text-primary-800">{message}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <article className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Saldo por alumno</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={clearBalanceFilter}
              disabled={loadingBalances}
              className="rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Limpiar
            </button>
            <button
              type="button"
              onClick={exportBalancesCsv}
              disabled={loadingBalances || exportingBalances}
              className="rounded-lg border border-primary-300 bg-white px-3 py-2 text-sm font-semibold text-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportingBalances ? 'Exportando...' : 'Exportar Excel'}
            </button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            className="app-input w-56"
            placeholder="Filtrar por ID de alumno"
            value={balanceStudentIdInput}
            onChange={(event) => setBalanceStudentIdInput(event.target.value)}
          />
          <button
            type="button"
            onClick={applyBalanceFilter}
            className="rounded-lg bg-primary-700 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-800"
          >
            Aplicar
          </button>
        </div>

        <table className="mt-3 min-w-full text-sm">
          <thead>
            <tr className="text-left text-primary-600">
              <th className="pb-2 pr-3">Alumno</th>
              <th className="pb-2 pr-3">Total</th>
              <th className="pb-2 pr-3">Pagado</th>
              <th className="pb-2">Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((item) => (
              <tr key={item.student_id} className="border-t border-primary-100">
                <td className="py-2 pr-3">{item.student_name}</td>
                <td className="py-2 pr-3">S/ {Number(item.total_amount).toFixed(2)}</td>
                <td className="py-2 pr-3">S/ {Number(item.total_paid).toFixed(2)}</td>
                <td className="py-2">S/ {Number(item.balance_pending).toFixed(2)}</td>
              </tr>
            ))}

            {!loadingBalances && balances.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 text-center text-sm text-primary-600">
                  No se encontraron saldos con ese criterio.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <PaginationControls
          page={balancesPage}
          totalPages={balancesTotalPages}
          total={balancesTotal}
          pageSize={balancesPageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={setBalancesPage}
          onPageSizeChange={(nextSize) => {
            setBalancesPageSize(nextSize);
            setBalancesPage(1);
          }}
          disabled={loadingBalances}
          label="filas"
        />
      </article>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="card overflow-x-auto">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Pagos por sede</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={clearCampusFilters}
                disabled={loadingCampus}
                className="rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Limpiar
              </button>
              <button
                type="button"
                onClick={exportByCampusCsv}
                disabled={loadingCampus || exportingCampus}
                className="rounded-lg border border-primary-300 bg-white px-3 py-2 text-sm font-semibold text-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportingCampus ? 'Exportando...' : 'Exportar Excel'}
              </button>
            </div>
          </div>

          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <input
              type="date"
              className="app-input"
              value={campusDateFrom}
              onChange={(event) => {
                setCampusDateFrom(event.target.value);
                setCampusPage(1);
              }}
            />
            <input
              type="date"
              className="app-input"
              value={campusDateTo}
              onChange={(event) => {
                setCampusDateTo(event.target.value);
                setCampusPage(1);
              }}
            />
          </div>

          <table className="mt-3 min-w-full text-sm">
            <thead>
              <tr className="text-left text-primary-600">
                <th className="pb-2 pr-3">Sede</th>
                <th className="pb-2 pr-3">Estado</th>
                <th className="pb-2 pr-3">Pagos</th>
                <th className="pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {byCampus.map((item, index) => (
                <tr key={`${item.campus_id}-${index}`} className="border-t border-primary-100">
                  <td className="py-2 pr-3">{item.campus_name}</td>
                  <td className="py-2 pr-3">{item.payment_status}</td>
                  <td className="py-2 pr-3">{item.payment_count}</td>
                  <td className="py-2">S/ {Number(item.total_amount).toFixed(2)}</td>
                </tr>
              ))}

              {!loadingCampus && byCampus.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm text-primary-600">
                    No hay resultados para el rango seleccionado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <PaginationControls
            page={campusPage}
            totalPages={campusTotalPages}
            total={campusTotal}
            pageSize={campusPageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setCampusPage}
            onPageSizeChange={(nextSize) => {
              setCampusPageSize(nextSize);
              setCampusPage(1);
            }}
            disabled={loadingCampus}
            label="filas"
          />
        </article>

        <article className="card overflow-x-auto">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Morosidad vencida</h2>
            <button
              type="button"
              onClick={exportMorosityCsv}
              disabled={loadingMorosity || exportingMorosity}
              className="rounded-lg border border-primary-300 bg-white px-3 py-2 text-sm font-semibold text-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportingMorosity ? 'Exportando...' : 'Exportar Excel'}
            </button>
          </div>

          <table className="mt-3 min-w-full text-sm">
            <thead>
              <tr className="text-left text-primary-600">
                <th className="pb-2 pr-3">Alumno</th>
                <th className="pb-2 pr-3">Curso</th>
                <th className="pb-2">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {morosity.map((item) => (
                <tr key={item.installment_id} className="border-t border-primary-100">
                  <td className="py-2 pr-3">{item.student_name}</td>
                  <td className="py-2 pr-3">
                    {item.course_name} - {item.campus_name}
                  </td>
                  <td className="py-2">S/ {Number(item.pending_amount).toFixed(2)}</td>
                </tr>
              ))}

              {!loadingMorosity && morosity.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-sm text-primary-600">
                    No hay cuotas vencidas pendientes.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <PaginationControls
            page={morosityPage}
            totalPages={morosityTotalPages}
            total={morosityTotal}
            pageSize={morosityPageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setMorosityPage}
            onPageSizeChange={(nextSize) => {
              setMorosityPageSize(nextSize);
              setMorosityPage(1);
            }}
            disabled={loadingMorosity}
            label="filas"
          />
        </article>
      </div>
    </section>
  );
}
