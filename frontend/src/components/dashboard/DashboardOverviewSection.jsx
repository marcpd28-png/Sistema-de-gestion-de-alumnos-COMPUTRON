import { AlertTriangle, ArrowUpRight, Banknote, CheckCircle2, Clock3, CreditCard, ReceiptText } from 'lucide-react';
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

const CashMetric = ({ label, value, hint, icon: Icon }) => (
  <div className="rounded-lg border border-primary-100 bg-white p-4">
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-primary-600" /> : null}
    </div>
    <p className="ui-numeric mt-2 text-2xl font-semibold text-primary-900">{value}</p>
    {hint ? <p className="mt-1 text-sm text-slate-600">{hint}</p> : null}
  </div>
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
  const sunatPendingCount = Number(cashRegister?.sunatPendingCount || 0);
  const sunatErrorCount = Number(cashRegister?.sunatErrorCount || 0);
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
      {visibility.cash_register ? (
        <section
          className={`overflow-hidden rounded-lg border bg-white ${
            hasOpenCash ? 'border-emerald-200' : 'border-amber-200'
          }`}
        >
          <div
            className={`flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between ${
              hasOpenCash ? 'bg-emerald-50/80' : 'bg-amber-50/80'
            }`}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                    hasOpenCash ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {hasOpenCash ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {hasOpenCash
                    ? `${cashOpenCount} caja${cashOpenCount === 1 ? '' : 's'} abierta${cashOpenCount === 1 ? '' : 's'}`
                    : 'Caja cerrada'}
                </span>
                {cashOpenedDate ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-primary-700">
                    <Clock3 className="h-3.5 w-3.5" />
                    Apertura {cashOpenedDate}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-3 text-xl font-semibold text-primary-950">Caja de hoy</h2>
              <p className="mt-1 text-sm text-slate-600">
                Estado operativo para cobrar, controlar efectivo y revisar comprobantes del día.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOpenCashRegister}
                className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
                  hasOpenCash ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-amber-700 hover:bg-amber-800'
                }`}
              >
                {hasOpenCash ? 'Nueva operación' : 'Abrir caja'}
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid gap-3 bg-slate-50/70 p-4 md:grid-cols-2 xl:grid-cols-4">
            <CashMetric
              label="Efectivo esperado"
              value={visibleCurrency(cashOpenSession.expected_cash_amount)}
              hint={hasOpenCash ? `Apertura ${visibleCurrency(cashOpenSession.opening_amount)}` : 'Abre caja para iniciar'}
              icon={Banknote}
            />
            <CashMetric
              label="Entró hoy"
              value={visibleCurrency(cashToday.total_completed)}
              hint={`${Number(cashToday.completed_count || 0)} operaciones`}
              icon={ReceiptText}
            />
            <CashMetric
              label="Digital/otros"
              value={visibleCurrency(cashToday.digital_received)}
              hint={`Efectivo neto ${visibleCurrency(cashToday.cash_net)}`}
              icon={CreditCard}
            />
            <CashMetric
              label="Vuelto entregado"
              value={visibleCurrency(cashToday.change_given)}
              hint="No cuenta como egreso manual"
              icon={Banknote}
            />
          </div>

          <div className="grid border-t border-primary-100 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-primary-900">Últimos movimientos</p>
                <button
                  type="button"
                  onClick={onOpenCashRegister}
                  className="text-xs font-semibold text-emerald-800 hover:text-emerald-900"
                >
                  Ver caja
                </button>
              </div>
              <div className="mt-2 divide-y divide-primary-100">
                {recentCashTransactions.slice(0, 4).map((transaction) => (
                  <div key={transaction.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-primary-900">{transaction.customer_name || 'Cliente'}</p>
                      <p className="text-xs text-slate-500">
                        {toPaymentMethodLabel(transaction.method)} · #{transaction.id}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold text-primary-900">
                      {visibleCurrency(transaction.total_amount)}
                    </span>
                  </div>
                ))}
                {!recentCashTransactions.length ? (
                  <p className="py-2 text-sm text-slate-600">Sin movimientos recientes.</p>
                ) : null}
              </div>
            </div>

            <div className="border-t border-primary-100 p-4 lg:border-l lg:border-t-0">
              <p className="text-sm font-semibold text-primary-900">Alertas rápidas</p>
              <div className="mt-3 space-y-2 text-sm">
                <div
                  className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
                    hasOpenCash ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
                  }`}
                >
                  <span>{hasOpenCash ? 'Lista para cobrar' : 'Requiere apertura'}</span>
                  <span className="font-semibold">{hasOpenCash ? 'OK' : 'Pendiente'}</span>
                </div>
                <div
                  className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
                    sunatErrorCount > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  <span>SUNAT con error</span>
                  <span className="font-semibold">{sunatErrorCount}</span>
                </div>
                <div
                  className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
                    sunatPendingCount > 0 ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  <span>SUNAT pendiente</span>
                  <span className="font-semibold">{sunatPendingCount}</span>
                </div>
                <div
                  className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
                    Number(cashToday.voided_count || 0) > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  <span>Operaciones anuladas</span>
                  <span className="font-semibold">{Number(cashToday.voided_count || 0)}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
      </div>

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
