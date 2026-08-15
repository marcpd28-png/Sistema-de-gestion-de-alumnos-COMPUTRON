import { DOCUMENT_TYPE_OPTIONS } from '../../utils/document';
import {
  AVAILABLE_ROLES,
  MANAGEMENT_ACCESS_GROUPS,
  MENU_ACCESS_GROUPS,
  ROLE_ADMIN,
} from './constants';
import { getPermissionGroupState } from './helpers';
import CampusMultiSelect from './CampusMultiSelect';

const resolvePermissionCardClassName = (state) => {
  if (state === 'all') return 'border-primary-300 bg-primary-50';
  if (state === 'partial') return 'border-amber-200 bg-amber-50';
  return 'border-primary-100 bg-white';
};

const EyeOpenIcon = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
    <path d="M1.5 12s3.5-6 10.5-6 10.5 6 10.5 6-3.5 6-10.5 6S1.5 12 1.5 12Z" />
    <circle cx="12" cy="12" r="3.5" />
  </svg>
);

const EyeClosedIcon = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
    <path d="M3 3l18 18" />
    <path d="M1.5 12s3.5-6 10.5-6c2.2 0 4.1.6 5.7 1.5" />
    <path d="M9.9 9.9A3.5 3.5 0 0 0 14.1 14.1" />
    <path d="M22.5 12s-3.5 6-10.5 6c-2.2 0-4.1-.6-5.7-1.5" />
  </svg>
);

export default function UserCreateModal({
  isOpen,
  creatingUser,
  onClose,
  form,
  onFieldChange,
  onSave,
  canManageRoles,
  isRootAdmin,
  campuses,
  loadingCampuses,
  showPassword,
  onTogglePassword,
  canManagePermissions,
  permissionTemplatesReady,
  loadingPermissionTemplates,
  accessPermissions,
  accessMenuLevel,
  onAccessMenuLevelChange,
  onAccessGroupChange,
  onAllAccessChange,
  onAllManagementAccessChange,
  enabledMenuCount,
  enabledManagementCount,
  accessMatchesRole,
}) {
  if (!isOpen) return null;

  const bindField = (field) => (event) => onFieldChange(field, event.target.value);
  const bindToggleField = (field) => (event) => onFieldChange(field, event.target.checked);
  const isAdminRole = form.role === ROLE_ADMIN;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar creación de usuario"
        onClick={onClose}
        disabled={creatingUser}
        className="absolute inset-0 bg-black/45"
      />

      <article
        role="dialog"
        aria-modal="true"
        aria-label="Crear usuario y configurar accesos"
        className="relative z-10 w-full max-w-5xl rounded-2xl border border-primary-100 bg-white p-4 shadow-2xl md:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-primary-900">Crear usuario</h2>
            <p className="text-sm text-primary-700">Registra un usuario nuevo, define su rol y configura sus vistas.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={creatingUser}
            className="rounded-lg border border-primary-200 px-3 py-1 text-sm text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cerrar
          </button>
        </div>

        <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
          <div className="rounded-xl border border-primary-100 p-3">
            <p className="text-sm font-semibold text-primary-900">Datos generales</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm text-primary-800">
                <span className="font-medium">Nombres</span>
                <input
                  className="app-input"
                  value={form.first_name}
                  onChange={bindField('first_name')}
                  placeholder="Nombres"
                />
              </label>

              <label className="space-y-1 text-sm text-primary-800">
                <span className="font-medium">Apellidos</span>
                <input
                  className="app-input"
                  value={form.last_name}
                  onChange={bindField('last_name')}
                  placeholder="Apellidos"
                />
              </label>

              <label className="space-y-1 text-sm text-primary-800">
                <span className="font-medium">Tipo de documento</span>
                <select className="app-input" value={form.document_type} onChange={bindField('document_type')}>
                  {DOCUMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-sm text-primary-800">
                <span className="font-medium">Número de documento</span>
                <input
                  className="app-input"
                  value={form.document_number}
                  onChange={bindField('document_number')}
                  placeholder="Número de documento"
                />
              </label>

              <label className="space-y-1 text-sm text-primary-800">
                <span className="font-medium">Correo</span>
                <input
                  type="email"
                  className="app-input"
                  value={form.email}
                  onChange={bindField('email')}
                  placeholder="correo@dominio.com"
                />
              </label>

              <label className="flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-sm text-primary-800 md:col-span-2">
                <input
                  type="checkbox"
                  checked={Boolean(form.use_email_as_password)}
                  onChange={bindToggleField('use_email_as_password')}
                />
                <span>Usar el correo como contraseña temporal y exigir cambio en el primer ingreso.</span>
              </label>

              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 md:col-span-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={Boolean(form.send_activation_code)}
                  onChange={bindToggleField('send_activation_code')}
                />
                <span>Enviar código de activación al correo. La cuenta quedará pendiente hasta validar el código.</span>
              </label>

              <label className="space-y-1 text-sm text-primary-800">
                <span className="font-medium">Contraseña</span>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="app-input pr-12"
                    value={form.password}
                    onChange={bindField('password')}
                    placeholder={
                      form.use_email_as_password
                        ? 'Se usará el correo como contraseña temporal'
                        : 'Mínimo 8 caracteres'
                    }
                    disabled={Boolean(form.use_email_as_password)}
                  />
                  <button
                    type="button"
                    onClick={onTogglePassword}
                    disabled={Boolean(form.use_email_as_password)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-primary-700 hover:bg-primary-100"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
                  </button>
                </div>
                {form.use_email_as_password ? (
                  <span className="block text-xs text-primary-600">
                    El usuario ingresará primero con su correo y luego deberá cambiar esa clave.
                  </span>
                ) : null}
              </label>

              <label className="space-y-1 text-sm text-primary-800">
                <span className="font-medium">Rol</span>
                <select
                  className="app-input"
                  value={form.role}
                  onChange={bindField('role')}
                  disabled={!canManageRoles}
                >
                  {AVAILABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                {!canManageRoles ? (
                  <span className="block text-xs text-primary-600">No tienes permiso para gestionar roles.</span>
                ) : null}
              </label>

              <CampusMultiSelect
                campuses={campuses}
                selectedIds={form.campus_ids || []}
                onChange={(campusIds) => onFieldChange('campus_ids', campusIds)}
                loading={loadingCampuses}
                allowGlobal={canManageRoles && isRootAdmin && isAdminRole}
              />

              <label className="space-y-1 text-sm text-primary-800">
                <span className="font-medium">Teléfono</span>
                <input
                  className="app-input"
                  value={form.phone}
                  onChange={bindField('phone')}
                  placeholder="Teléfono"
                />
              </label>

              <label className="space-y-1 text-sm text-primary-800 md:col-span-2">
                <span className="font-medium">Dirección</span>
                <input
                  className="app-input"
                  value={form.address}
                  onChange={bindField('address')}
                  placeholder="Dirección"
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-primary-100 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-primary-900">Vistas y accesos</h3>
                <p className="text-xs text-primary-600">
                  Ajusta los menús del usuario. Si no los cambias, se usará el acceso normal del rol.
                </p>
              </div>
              <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary-800">
                {enabledMenuCount}/{MENU_ACCESS_GROUPS.length} menús activos
              </span>
            </div>

            {!canManagePermissions ? (
              <p className="mt-3 rounded-xl bg-primary-50 p-3 text-xs text-primary-700">
                No tienes permiso para configurar vistas personalizadas. El usuario se creará con acceso según su rol.
              </p>
            ) : loadingPermissionTemplates ? (
              <p className="mt-3 text-sm text-primary-700">Cargando configuración de vistas por rol...</p>
            ) : !permissionTemplatesReady ? (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                No se pudieron cargar las vistas base del rol. El usuario se creará con los accesos estándar del rol.
              </p>
            ) : (
              <>
                {isAdminRole ? (
                  <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                    El rol ADMIN mantiene acceso total por diseño del sistema.
                  </p>
                ) : null}

                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {accessMenuLevel === 'MAIN'
                    ? MENU_ACCESS_GROUPS.map((group) => {
                        const state = getPermissionGroupState(accessPermissions, group.permissions);
                        const checked = state === 'all';
                        const isManagementMenu = group.key === 'management';

                        return (
                          <div
                            key={group.key}
                            className={`rounded-lg border p-2 ${resolvePermissionCardClassName(state)}`}
                          >
                            <label className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => onAccessGroupChange(group, event.target.checked)}
                              />
                              <span className="text-xs font-semibold text-primary-900">
                                {group.label}
                                {state === 'partial' ? ' (parcial)' : ''}
                              </span>
                            </label>

                            {isManagementMenu ? (
                              <button
                                type="button"
                                onClick={() => onAccessMenuLevelChange('MANAGEMENT')}
                                className="mt-2 rounded-lg border border-primary-200 px-2 py-1 text-[11px] font-semibold text-primary-700 hover:bg-primary-100"
                              >
                                Ver submenú ({enabledManagementCount}/{MANAGEMENT_ACCESS_GROUPS.length})
                              </button>
                            ) : null}
                          </div>
                        );
                      })
                    : null}
                </div>

                {accessMenuLevel === 'MAIN' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onAllAccessChange(true)}
                      className="rounded-lg border border-primary-300 px-3 py-1.5 text-xs font-semibold text-primary-800"
                    >
                      Activar todos los menús
                    </button>
                    <button
                      type="button"
                      onClick={() => onAllAccessChange(false)}
                      className="rounded-lg border border-primary-300 px-3 py-1.5 text-xs font-semibold text-primary-800"
                    >
                      Quitar todos los menús
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-primary-100 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-primary-900">Submenú: Gestión académica</h4>
                        <p className="text-xs text-primary-600">
                          Selecciona vistas específicas y usa el botón para volver al menú anterior.
                        </p>
                      </div>
                      <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary-800">
                        {enabledManagementCount}/{MANAGEMENT_ACCESS_GROUPS.length} secciones activas
                      </span>
                    </div>

                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => onAccessMenuLevelChange('MAIN')}
                        className="rounded-lg border border-primary-300 px-3 py-1.5 text-xs font-semibold text-primary-800 hover:bg-primary-50"
                      >
                        Volver al menú anterior
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      {MANAGEMENT_ACCESS_GROUPS.map((group) => {
                        const state = getPermissionGroupState(accessPermissions, group.permissions);
                        const checked = state === 'all';

                        return (
                          <label
                            key={group.key}
                            className={`flex items-start gap-2 rounded-lg border p-2 ${resolvePermissionCardClassName(state)}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => onAccessGroupChange(group, event.target.checked)}
                            />
                            <span className="text-xs font-semibold text-primary-900">
                              {group.label}
                              {state === 'partial' ? ' (parcial)' : ''}
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onAllManagementAccessChange(true)}
                        className="rounded-lg border border-primary-300 px-3 py-1.5 text-xs font-semibold text-primary-800"
                      >
                        Activar todas las secciones
                      </button>
                      <button
                        type="button"
                        onClick={() => onAllManagementAccessChange(false)}
                        className="rounded-lg border border-primary-300 px-3 py-1.5 text-xs font-semibold text-primary-800"
                      >
                        Quitar secciones
                      </button>
                    </div>
                  </div>
                )}

                <p className="mt-3 text-xs text-primary-700">
                  {accessMatchesRole
                    ? 'Se usará acceso por ROL porque las vistas coinciden con la configuración base.'
                    : 'Se guardará acceso PERSONAL con las vistas seleccionadas en este formulario.'}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={creatingUser}
            className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingUser ? 'Creando...' : 'Crear usuario'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={creatingUser}
            className="rounded-xl border border-primary-200 px-4 py-2 text-sm font-semibold text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      </article>
    </div>
  );
}
