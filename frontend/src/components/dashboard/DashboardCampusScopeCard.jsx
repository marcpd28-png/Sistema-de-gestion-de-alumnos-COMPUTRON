export default function DashboardCampusScopeCard({
  canViewCampuses,
  allowGlobalCampusScope,
  campuses,
  showCampusSelector,
  selectedCampusName,
  campusDraftId,
  onToggleSelector,
  onCampusDraftChange,
  onApply,
  onClear,
}) {
  return (
    <>
      <div className="app-page-header">
        <div>
          <h1 className="app-title">Panel de control</h1>
          <p className="app-subtitle">Resumen operativo, académico y financiero del instituto.</p>
        </div>
        {canViewCampuses ? (
          <div className="app-toolbar">
            <button
              type="button"
              onClick={onToggleSelector}
              className="btn-secondary"
            >
              Seleccionar sede
            </button>
            <span className="app-pill">
              Sede activa: {selectedCampusName}
            </span>
          </div>
        ) : null}
      </div>

      {showCampusSelector && canViewCampuses ? (
        <article className="card flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 sm:min-w-72">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-primary-700">
              Sedes disponibles
            </label>
            <select
              className="app-input"
              value={campusDraftId}
              onChange={(event) => onCampusDraftChange(event.target.value)}
            >
              {allowGlobalCampusScope ? <option value="">Todas las sedes</option> : null}
              {campuses.map((campus) => (
                <option key={campus.id} value={campus.id}>
                  {campus.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={onApply}
            className="btn-primary"
          >
            Aplicar sede
          </button>
          {allowGlobalCampusScope ? (
            <button
              type="button"
              onClick={onClear}
              className="btn-secondary"
            >
              Ver todo
            </button>
          ) : null}
        </article>
      ) : null}
    </>
  );
}
