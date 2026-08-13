import RankingBarsCard from './RankingBarsCard';
import { formatCurrency, formatShortDate } from './dashboardUtils';

export default function DashboardMorositySection({ visibility, morosityByCampusChart, morosity, loading }) {
  return (
    <>
      <RankingBarsCard items={visibility.reports ? morosityByCampusChart : []} subtitle="" />

      <article className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-primary-900">Cuotas vencidas</h2>
          </div>
          <span className="rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-800">
            {morosity.length} registro(s)
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {morosity.slice(0, 6).map((item) => (
            <div key={item.installment_id} className="rounded-2xl border border-accent-100 bg-accent-50 p-4">
              <p className="text-sm font-semibold text-accent-900">{item.student_name}</p>
              <p className="mt-1 text-xs text-accent-700">
                {item.course_name} | {item.campus_name}
              </p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-accent-700">
                Vencimiento
              </p>
              <p className="text-sm text-accent-900">{formatShortDate(item.due_date)}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-accent-700">
                Pendiente
              </p>
              <p className="text-lg font-semibold text-accent-900">
                {formatCurrency(item.pending_amount)}
              </p>
            </div>
          ))}
          {!loading && morosity.length === 0 ? (
            <p className="text-sm text-primary-700">No hay cuotas vencidas pendientes.</p>
          ) : null}
        </div>
      </article>
    </>
  );
}
