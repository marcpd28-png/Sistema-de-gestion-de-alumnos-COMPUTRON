import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { useEffect, useState } from 'react';
import { formatCurrency } from './dashboardUtils';

export default function RankingBarsCard({
  items,
  title = 'Morosidad por sede',
  subtitle = 'Ranking visual de deuda vencida segun monto pendiente.',
  emptyMessage = 'No hay morosidad agregada para mostrar.',
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!items.length) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex((current) => Math.min(current, items.length - 1));
  }, [items]);

  return (
    <article className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-primary-900">{title}</h2>
        {subtitle ? <p className="text-sm text-primary-700">{subtitle}</p> : null}
      </div>

      {!items.length ? (
        <p className="text-sm text-primary-700">{emptyMessage}</p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={items}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              onMouseMove={(state) => {
                if (state.activeTooltipIndex !== undefined) {
                  setActiveIndex(state.activeTooltipIndex);
                }
              }}
            >
              <XAxis type="number" hide />
              <YAxis
                dataKey="campus_name"
                type="category"
                stroke="#94a3b8"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                width={100}
              />
              <Tooltip
                cursor={{ fill: 'transparent' }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="rounded-xl border border-primary-100 bg-white p-3 shadow-xl dark:border-white/10 dark:bg-slate-800">
                        <p className="text-xs font-semibold text-primary-500">{payload[0].payload.campus_name}</p>
                        <p className="text-sm font-bold text-accent-700">
                          {formatCurrency(payload[0].value)}
                        </p>
                        <p className="text-[10px] text-primary-600">
                          {payload[0].payload.installments} cuotas vencidas
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="pending_amount" radius={[0, 10, 10, 0]} barSize={20}>
                {items.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={index === activeIndex ? '#f98617' : '#2ca38f'}
                    className="transition-all duration-300"
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </article>
  );
}
