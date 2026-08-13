export default function StatCard({ title, value, hint, tone = 'primary', action = null }) {
  const toneClasses = {
    primary: 'border-slate-200 bg-white text-slate-900',
    accent: 'border-slate-200 bg-white text-slate-900',
  };

  return (
    <article className={`card border ${toneClasses[tone] || toneClasses.primary}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-600">{title}</p>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <p className="ui-numeric mt-1 break-words text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{hint}</p>
    </article>
  );
}
