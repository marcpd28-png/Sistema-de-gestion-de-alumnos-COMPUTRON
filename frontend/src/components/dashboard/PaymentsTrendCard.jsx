import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency, formatShortDate } from './dashboardUtils';

export default function PaymentsTrendCard({
  items,
  title = 'Tendencia de pagos',
  subtitle = 'Ultimos 7 dias con foco en montos completados.',
  emptyMessage = 'No hay datos recientes para graficar.',
}) {
  const [activeIndex, setActiveIndex] = useState(Math.max(0, items.length - 1));

  useEffect(() => {
    if (!items.length) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex((current) => Math.min(current, items.length - 1));
  }, [items]);

  const activeItem = items[activeIndex] || null;

  return (
    <article className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-primary-900">{title}</h2>
          {subtitle ? <p className="text-sm text-primary-700">{subtitle}</p> : null}
        </div>
        {activeItem ? (
          <div className="w-full rounded-2xl bg-primary-50 px-4 py-2 text-left sm:w-auto sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-500">
              {formatShortDate(activeItem.payment_date)}
            </p>
            <p className="text-lg font-semibold text-primary-900">
              {formatCurrency(activeItem.completed_amount)}
            </p>
            <p className="text-xs text-primary-600">{Number(activeItem.total || 0)} pago(s)</p>
          </div>
        ) : null}
      </div>

      {!items.length ? (
        <p className="text-sm text-primary-700">{emptyMessage}</p>
      ) : (
        <div className="space-y-4">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={items}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                onMouseMove={(state) => {
                  if (state.activeTooltipIndex !== undefined) {
                    setActiveIndex(state.activeTooltipIndex);
                  }
                }}
              >
                <defs>
                  <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2ca38f" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2ca38f" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="payment_date"
                  tickFormatter={formatShortDate}
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `S/${value}`}
                />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="rounded-xl border border-primary-100 bg-white p-3 shadow-xl dark:border-white/10 dark:bg-slate-800">
                          <p className="text-xs font-semibold text-primary-500">
                            {formatShortDate(payload[0].payload.payment_date)}
                          </p>
                          <p className="text-sm font-bold text-primary-900 dark:text-white">
                            {formatCurrency(payload[0].value)}
                          </p>
                          <p className="text-[10px] text-primary-600">
                            {payload[0].payload.total} transacciones
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="completed_amount"
                  stroke="#1c685d"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorAmount)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {items.map((item, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={`meta-${item.payment_date}`}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={`rounded-2xl border px-3 py-2 text-left transition ${
                    isActive
                      ? 'border-primary-400 bg-primary-50'
                      : 'border-primary-200 bg-white hover:border-primary-300 hover:bg-primary-50/40'
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-500">
                    {formatShortDate(item.payment_date)}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-primary-900">
                    {formatCurrency(item.completed_amount)}
                  </p>
                  <p className="text-xs text-primary-600">{Number(item.total || 0)} operaciones</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
