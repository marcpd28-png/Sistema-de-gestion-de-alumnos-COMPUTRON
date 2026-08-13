import { useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_COLORS } from './dashboardUtils';

export default function InteractiveDonutCard({
  title,
  subtitle,
  items,
  emptyMessage,
  totalFormatter = (value) => value,
  activeValueFormatter = (value) => value,
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!items.length) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex((current) => Math.min(current, items.length - 1));
  }, [items]);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.value || 0), 0),
    [items],
  );


  return (
    <article className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-primary-900">{title}</h2>
        {subtitle ? <p className="text-sm text-primary-700">{subtitle}</p> : null}
      </div>

      {!items.length ? (
        <p className="text-sm text-primary-700">{emptyMessage}</p>
      ) : (
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <div className="relative h-48 w-full md:w-1/2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={items}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  onMouseEnter={(_, index) => setActiveIndex(index)}
                >
                  {items.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color || CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="rounded-xl border border-primary-100 bg-white p-3 shadow-xl dark:border-white/10 dark:bg-slate-800">
                          <p className="text-sm font-bold text-primary-900 dark:text-white">
                            {payload[0].name}: {activeValueFormatter(payload[0].value)}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-primary-500">Total</p>
              <p className="text-lg font-bold text-primary-900 dark:text-white">{totalFormatter(total)}</p>
            </div>
          </div>

          <div className="flex-1 space-y-2">
            {items.map((item, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={item.key || item.label}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center justify-between rounded-xl border p-2 text-left transition ${
                    isActive
                      ? 'border-primary-300 bg-primary-50 dark:border-white/20 dark:bg-slate-800'
                      : 'border-transparent hover:bg-primary-50/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: item.color || CHART_COLORS[index % CHART_COLORS.length] }}
                    />
                    <div>
                      <p className="text-xs font-bold text-primary-900 dark:text-white">{item.label}</p>
                      <p className="text-[10px] text-primary-600 truncate max-w-[120px]">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-primary-900 dark:text-white">
                      {activeValueFormatter(item.value)}
                    </p>
                    <p className="text-[10px] text-primary-500">{item.shareLabel}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
