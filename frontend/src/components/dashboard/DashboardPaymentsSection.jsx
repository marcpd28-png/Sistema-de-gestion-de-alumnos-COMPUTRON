import InteractiveDonutCard from './InteractiveDonutCard';
import PaymentsTrendCard from './PaymentsTrendCard';
import { formatCurrency, toPaymentMethodLabel, toPaymentStatusLabel } from './dashboardUtils';

function RecentPaymentsPanel({ items, loading }) {
  return (
    <article className="card">
      <h2 className="text-lg font-semibold text-primary-900">Ultimos pagos</h2>
      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-primary-600">
              <th className="pb-2 pr-3">Alumno</th>
              <th className="pb-2 pr-3">Monto</th>
              <th className="pb-2 pr-3">Metodo</th>
              <th className="pb-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((payment) => (
              <tr key={payment.id} className="border-t border-primary-100">
                <td className="py-2 pr-3">{payment.student_name}</td>
                <td className="py-2 pr-3">{formatCurrency(payment.total_amount)}</td>
                <td className="py-2 pr-3">{payment.method}</td>
                <td className="py-2">{toPaymentStatusLabel(payment.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 ? (
          <p className="mt-2 text-sm text-primary-700">No hay pagos registrados.</p>
        ) : null}
      </div>

      <div className="mt-3 space-y-3 md:hidden">
        {items.map((payment) => (
          <div key={payment.id} className="rounded-2xl border border-primary-100 bg-primary-50/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-primary-900">{payment.student_name}</p>
                <p className="text-xs text-primary-600">{toPaymentMethodLabel(payment.method)}</p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-primary-800 shadow-soft">
                {toPaymentStatusLabel(payment.status)}
              </span>
            </div>
            <p className="mt-3 text-lg font-semibold text-primary-900">
              {formatCurrency(payment.total_amount)}
            </p>
          </div>
        ))}
        {!loading && items.length === 0 ? (
          <p className="text-sm text-primary-700">No hay pagos registrados.</p>
        ) : null}
      </div>
    </article>
  );
}

export default function DashboardPaymentsSection({
  visibility,
  paymentStatusChart,
  paymentMethodsChart,
  paymentsByDayChart,
  recentPayments,
  loading,
}) {
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-3">
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
        <PaymentsTrendCard items={visibility.payments ? paymentsByDayChart : []} subtitle="" />
      </div>

      <RecentPaymentsPanel items={recentPayments} loading={loading} />
    </>
  );
}
