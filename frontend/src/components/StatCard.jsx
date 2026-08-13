export default function StatCard({ title, value, hint, tone = 'primary', action = null }) {
  const toneClasses = {
    primary: 'text-slate-900',
    accent: 'text-slate-900',
  };

  return (
    <article className={`card relative overflow-hidden ${toneClasses[tone] || toneClasses.primary}`}>
      <span className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-primary-600" aria-hidden="true" />
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-600">{title}</p>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <p className="ui-numeric mt-1 break-words text-2xl font-semibold text-primary-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{hint}</p>
    </article>
  );
}
