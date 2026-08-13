import { ArrowUpRight } from 'lucide-react';
import StatCard from '../StatCard';
import InteractiveDonutCard from './InteractiveDonutCard';
import PaymentsTrendCard from './PaymentsTrendCard';
import RankingBarsCard from './RankingBarsCard';
import { formatCurrency, toPaymentMethodLabel } from './dashboardUtils';

const EyeToggleIcon = ({ hidden }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    {hidden ? (
      <>
        <path d="M3 3L21 21" />
        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
        <path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c5.5 0 9.7 3.4 11 8-0.4 1.5-1.2 2.9-2.3 4.1" />
        <path d="M6.1 6.1C4 7.6 2.6 9.7 2 12c1.3 4.6 5.5 8 11 8 1.6 0 3.1-0.3 4.4-0.8" />
      </>
    ) : (
      <>
        <path d="M2 12c1.3-4.6 5.5-8 10-8s8.7 3.4 10 8c-1.3 4.6-5.5 8-10 8s-8.7-3.4-10-8Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
  </svg>
);

export default function DashboardOverviewSection({
  totals,
  visibility,
  incomeValue,
  incomeHint,
  hideIncome,
  cashRegister,
  paymentMethodsChart,
  paymentStatusChart,
  paymentsByDayChart,
  morosityByCampusChart,
  onToggleIncome,
  onOpenSection,
  onOpenCashRegister,
}) {
  const cashToday = cashRegister?.today || {};
  const cashOpenSession = cashRegister?.openSession || {};
  const recentCashTransactions = cashRegister?.recentTransactions || [];
  const cashOpenCount = Number(cashOpenSession.open_count || 0);
  const hasOpenCash = cashOpenCount > 0;
  const visibleCurrency = (value) => (hideIncome ? '••••••' : formatCurrency(value));
  const cashOpenedDate = cashOpenSession.opened_at
    ? new Date(cashOpenSession.opened_at).toLocaleString('es-PE', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <>
      <div className={`grid gap-4 md:grid-cols-2 ${visibility.cash_register ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        <StatCard
          title="Alumnos"
          value={visibility.students ? Number(totals.students || 0) : '-'}
          hint={visibility.students ? 'Registros activos' : 'Sin permiso'}
        />
        <StatCard
          title="Cursos"
          value={visibility.courses ? Number(totals.courses || 0) : '-'}
          hint={visibility.courses ? 'Catalogo institucional' : 'Sin permiso'}
        />
        <StatCard
          title="Pagos"
          value={visibility.payments ? Number(totals.payments || 0) : '-'}
          hint={visibility.payments ? 'Transacciones registradas' : 'Sin permiso'}
          tone="accent"
        />
        <StatCard
          title="Ingresos"
          value={incomeValue}
          hint={incomeHint}
          tone="accent"
          action={
            visibility.payments ? (
              <button
                type="button"
                onClick={onToggleIncome}
                className="rounded-lg border border-primary-200 p-1 text-primary-700 hover:bg-primary-50"
                title={hideIncome ? 'Mostrar monto facturado' : 'Ocultar monto facturado'}
                aria-label={hideIncome ? 'Mostrar monto facturado' : 'Ocultar monto facturado'}
              >
                <EyeToggleIcon hidden={hideIncome} />
              </button>
            ) : null
          }
        />
        {visibility.cash_register ? (
          <StatCard
            title="Caja hoy"
            value={visibleCurrency(cashToday.total_completed)}
            hint={`${Number(cashToday.completed_count || 0)} operacion(es) de servicios`}
            tone="accent"
            action={
              <button
                type="button"
                onClick={onOpenCashRegister}
                className="rounded-lg border border-accent-200 p-1 text-accent-800 hover:bg-accent-50"
                title="Abrir flujo de caja"
                aria-label="Abrir flujo de caja"
              >
                <ArrowUpRight className="h-4 w-4" />
              </button>
            }
          />
        ) : null}
      </div>

      {visibility.cash_register ? (
        <section className="card overflow-hidden border-emerald-200 p-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-100 bg-emerald-50/70 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-primary-900">Flujo de caja</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  hasOpenCash ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {hasOpenCash
                  ? `${cashOpenCount} caja${cashOpenCount === 1 ? '' : 's'} abierta${cashOpenCount === 1 ? '' : 's'}`
                  : 'Caja cerrada'}
              </span>
              <button
                type="button"
                onClick={onOpenCashRegister}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                Ir a caja
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid divide-y divide-primary-100 md:grid-cols-4 md:divide-x md:divide-y-0">
            <div className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-500">Entró hoy</p>
              <p className="mt-2 text-2xl font-semibold text-primary-900">
                {visibleCurrency(cashToday.total_completed)}
              </p>
              <p className="text-sm text-primary-700">{Number(cashToday.completed_count || 0)} operaciones</p>
            </div>
            <div className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-500">Salió</p>
              <p className="mt-2 text-2xl font-semibold text-primary-900">
                {visibleCurrency(cashToday.change_given)}
              </p>
              <p className="text-sm text-primary-700">Vuelto entregado</p>
            </div>
            <div className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-500">Efectivo caja</p>
              <p className="mt-2 text-2xl font-semibold text-primary-900">
                {visibleCurrency(cashOpenSession.expected_cash_amount)}
              </p>
              <p className="text-sm text-primary-700">
                {hasOpenCash
                  ? `Apertura ${visibleCurrency(cashOpenSession.opening_amount)}${cashOpenedDate ? ` · ${cashOpenedDate}` : ''}`
                  : 'Sin caja abierta'}
              </p>
            </div>
            <div className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-500">Digital/otros</p>
              <p className="mt-2 text-2xl font-semibold text-primary-900">
                {visibleCurrency(cashToday.digital_received)}
              </p>
              <p className="text-sm text-primary-700">
                Efectivo neto: {visibleCurrency(cashToday.cash_net)}
              </p>
            </div>
          </div>

          <div className="grid border-t border-primary-100 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
            <div className="p-4">
              <p className="text-sm font-semibold text-primary-900">Control del día</p>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-primary-500">Efectivo recibido</p>
                  <p className="font-semibold text-primary-900">{visibleCurrency(cashToday.cash_received)}</p>
                </div>
                <div>
                  <p className="text-primary-500">Anulado</p>
                  <p className="font-semibold text-primary-900">{visibleCurrency(cashToday.total_voided)}</p>
                </div>
                <div>
                  <p className="text-primary-500">Operaciones anuladas</p>
                  <p className="font-semibold text-primary-900">{Number(cashToday.voided_count || 0)}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-primary-100 p-4 lg:border-l lg:border-t-0">
              <p className="text-sm font-semibold text-primary-900">Últimos movimientos</p>
              <div className="mt-2 divide-y divide-primary-100">
                {recentCashTransactions.slice(0, 3).map((transaction) => (
                  <div key={transaction.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-primary-900">{transaction.customer_name || 'Cliente'}</p>
                      <p className="text-xs text-primary-600">
                        {toPaymentMethodLabel(transaction.method)} · #{transaction.id}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold text-primary-900">
                      {visibleCurrency(transaction.total_amount)}
                    </span>
                  </div>
                ))}
                {!recentCashTransactions.length ? (
                  <p className="py-2 text-sm text-primary-600">Sin movimientos de caja recientes.</p>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-primary-900">Panorama visual</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onOpenSection('payments')}
              className="rounded-full border border-primary-200 px-3 py-1.5 text-xs font-semibold text-primary-800 hover:bg-primary-50"
            >
              Ver pagos
            </button>
            <button
              type="button"
              onClick={() => onOpenSection('morosity')}
              className="rounded-full border border-accent-200 px-3 py-1.5 text-xs font-semibold text-accent-900 hover:bg-accent-50"
            >
              Ver morosidad
            </button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <PaymentsTrendCard
            items={visibility.payments ? paymentsByDayChart : []}
            title="Tendencia de pagos"
            subtitle=""
            emptyMessage={visibility.payments ? 'No hay datos recientes para graficar.' : 'Sin permiso para ver pagos.'}
          />

          <InteractiveDonutCard
            title="Estados de pago"
            subtitle=""
            items={visibility.payments ? paymentStatusChart : []}
            emptyMessage={visibility.payments ? 'No hay pagos para mostrar.' : 'Sin permiso para ver pagos.'}
            totalFormatter={(value) => `${value}`}
            activeValueFormatter={(value) => `${value}`}
            activeDetailFormatter={(item) => item?.detail || ''}
          />

          <InteractiveDonutCard
            title="Metodos de cobro"
            subtitle=""
            items={visibility.payments ? paymentMethodsChart : []}
            emptyMessage={visibility.payments ? 'No hay metodos para mostrar.' : 'Sin permiso para ver pagos.'}
            totalFormatter={(value) => formatCurrency(value)}
            activeValueFormatter={(value) => formatCurrency(value)}
            activeDetailFormatter={(item) => item?.detail || ''}
          />

          <RankingBarsCard
            items={visibility.reports ? morosityByCampusChart : []}
            title="Morosidad por sede"
            subtitle=""
            emptyMessage={
              visibility.reports ? 'No hay morosidad agregada para mostrar.' : 'Sin permiso para ver morosidad.'
            }
          />
        </div>
      </section>
    </>
  );
}
