import PaginationControls from '../../components/PaginationControls';
import { ROLE_FILTER_OPTIONS, USER_PAGE_SIZE } from './constants';
import { getPrimaryRole } from './helpers';

export default function UsersListCard({
  users,
  userTotal,
  userPage,
  userTotalPages,
  onUserPageChange,
  userSearchInput,
  onUserSearchInputChange,
  userRoleFilter,
  onUserRoleFilterChange,
  onClearUserFilters,
  clearFiltersDisabled,
  loadingUsers,
  exportingUsers,
  onExportUsers,
  canCreateUsers,
  onOpenCreateUser,
  statusUpdatingUserId,
  canManageStatus,
  onToggleStatus,
  onOpenCredentialEditor,
  canOpenEditor,
  showReadOnlyNote,
  onDeleteUser,
  deletingUserId,
  selectedUserIds = [],
  onToggleSelectUser,
  onToggleSelectAll,
  onDeleteSelected,
  sortConfig,
  onSort,
}) {
  const isAllSelected = users.length > 0 && selectedUserIds.length === users.length;
  const hasSelection = selectedUserIds.length > 0;

  const handleSort = (key) => {
    onSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const renderSortIcon = (column) => {
    if (sortConfig?.key !== column) return <span className="ml-1 opacity-30">↕</span>;
    return <span className="ml-1 text-primary-700">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <article className="card overflow-x-auto relative">
      {hasSelection ? (
        <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between border-b border-primary-200 bg-primary-50 px-4 py-2 dark:bg-slate-800">
          <span className="text-sm font-semibold text-primary-800 dark:text-primary-200">
            {selectedUserIds.length} usuarios seleccionados
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDeleteSelected}
              className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
            >
              Eliminar seleccionados
            </button>
          </div>
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Usuarios registrados</h2>
          <p className="text-sm text-primary-700">
            {users.length} en página / {userTotal} total
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          <input
            className="app-input w-full lg:w-72"
            placeholder="Buscar por nombre, documento o correo"
            value={userSearchInput}
            onChange={(event) => onUserSearchInputChange(event.target.value)}
          />
          <select
            className="app-input w-full lg:w-48"
            value={userRoleFilter}
            onChange={(event) => onUserRoleFilterChange(event.target.value)}
            aria-label="Filtrar por rol"
          >
            {ROLE_FILTER_OPTIONS.map((option) => (
              <option key={`${option.value || 'all'}-${option.label}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onClearUserFilters}
            disabled={clearFiltersDisabled}
            className="rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Limpiar
          </button>
          <button
            type="button"
            onClick={onExportUsers}
            disabled={loadingUsers || exportingUsers}
            className="rounded-lg border border-primary-300 bg-white px-3 py-2 text-sm font-semibold text-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exportingUsers ? 'Exportando...' : 'Exportar Excel'}
          </button>
          {canCreateUsers ? (
            <button
              type="button"
              onClick={onOpenCreateUser}
              className="rounded-lg bg-primary-700 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-800"
            >
              Nuevo usuario
            </button>
          ) : null}
        </div>
      </div>

      <table className="mt-3 min-w-full text-sm">
        <thead>
          <tr className="text-left text-primary-600 dark:text-primary-300">
            <th className="pb-2 pr-3">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-primary-300 text-primary-600 focus:ring-primary-500"
                checked={isAllSelected}
                onChange={onToggleSelectAll}
              />
            </th>
            <th className="cursor-pointer pb-2 pr-3 hover:text-primary-800" onClick={() => handleSort('first_name')}>
              Usuario {renderSortIcon('first_name')}
            </th>
            <th className="cursor-pointer pb-2 pr-3 hover:text-primary-800" onClick={() => handleSort('document_number')}>
              Documento {renderSortIcon('document_number')}
            </th>
            <th className="cursor-pointer pb-2 pr-3 hover:text-primary-800" onClick={() => handleSort('email')}>
              Correo {renderSortIcon('email')}
            </th>
            <th className="pb-2 pr-3 text-left">Sede</th>
            <th className="pb-2 pr-3">Activo</th>
            <th className="pb-2">Rol</th>
            <th className="pb-2 pl-3 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {users.map((targetUser) => {
            const statusBusy = statusUpdatingUserId === targetUser.id;

            return (
              <tr key={targetUser.id} className={`border-t border-primary-100 align-top transition ${selectedUserIds.includes(targetUser.id) ? 'bg-primary-50 dark:bg-slate-700/50' : 'hover:bg-primary-50/30 dark:hover:bg-slate-800/30'}`}>
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-primary-300 text-primary-600 focus:ring-primary-500"
                    checked={selectedUserIds.includes(targetUser.id)}
                    onChange={() => onToggleSelectUser(targetUser.id)}
                    disabled={targetUser.id === 1}
                  />
                </td>
                <td className="py-2 pr-3">
                  {targetUser.first_name} {targetUser.last_name}
                </td>
                <td className="py-2 pr-3">{targetUser.document_number || '-'}</td>
                <td className="py-2 pr-3">{targetUser.email}</td>
                <td className="py-2 pr-3">
                  {(targetUser.campus_names || []).length > 0
                    ? targetUser.campus_names.join(', ')
                    : targetUser.base_campus_name ||
                      (getPrimaryRole(targetUser.roles) === 'ADMIN' ? 'Todas las sedes' : 'Sin sede')}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={targetUser.is_active}
                      aria-label={`Cambiar estado de ${targetUser.first_name} ${targetUser.last_name}`}
                      onClick={() => onToggleStatus(targetUser)}
                      disabled={!canManageStatus || statusBusy}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                        targetUser.is_active ? 'bg-primary-700' : 'bg-primary-200'
                      } ${!canManageStatus || statusBusy ? 'cursor-not-allowed opacity-60' : 'hover:opacity-90'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                          targetUser.is_active ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <span
                      className={`text-xs font-semibold ${
                        targetUser.activation_required
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-primary-700 dark:text-primary-300'
                      }`}
                    >
                      {targetUser.activation_required ? 'PENDIENTE' : targetUser.is_active ? 'ACTIVO' : 'INACTIVO'}
                    </span>
                  </div>
                </td>
                <td className="py-2">
                  <span className="rounded-lg border border-primary-200 px-2 py-1 text-xs text-primary-700 dark:border-white/10 dark:text-primary-200">
                    {getPrimaryRole(targetUser.roles) || '-'}
                  </span>
                </td>
                <td className="py-2 pl-3 flex gap-2 flex-wrap justify-end">
                  <button
                    type="button"
                    onClick={() => onOpenCredentialEditor(targetUser)}
                    disabled={!canOpenEditor}
                    className={`rounded-lg border border-primary-300 px-2 py-1 text-xs font-semibold text-primary-800 dark:border-white/20 dark:text-white ${!canOpenEditor ? 'cursor-not-allowed opacity-60' : 'hover:bg-primary-50 dark:hover:bg-slate-700'
                      }`}
                  >
                    Editar
                  </button>
                  {onDeleteUser && canManageStatus && targetUser.id !== 1 ? (
                    <button
                      type="button"
                      onClick={() => onDeleteUser(targetUser)}
                      disabled={deletingUserId === targetUser.id}
                      title="Eliminar usuario de forma permanente"
                      className="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400"
                    >
                      {deletingUserId === targetUser.id ? '...' : 'Eliminar'}
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}

          {!loadingUsers && users.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-4 text-center text-sm text-primary-600">
                No se encontraron usuarios con ese criterio.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <PaginationControls
        page={userPage}
        totalPages={userTotalPages}
        total={userTotal}
        pageSize={USER_PAGE_SIZE}
        onPageChange={onUserPageChange}
        disabled={loadingUsers}
        label="usuarios"
      />

      {showReadOnlyNote ? (
        <p className="mt-3 text-xs text-primary-600">
          Tienes acceso de solo lectura. Para editar estado, datos o accesos del usuario, habilita los permisos
          correspondientes.
        </p>
      ) : null}
    </article>
  );
}
