import { buildDocumentValue, parseDocumentValue } from '../../utils/document';
import { AVAILABLE_ROLES, DEFAULT_CREATE_ROLE, INITIAL_CREDENTIAL_FORM } from './constants';

export const sortUnique = (items = []) =>
  Array.from(new Set((Array.isArray(items) ? items : []).filter(Boolean))).sort();

export const arraysEqual = (left = [], right = []) => {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
};

export const getPermissionGroupState = (currentPermissions = [], requiredPermissions = []) => {
  const matched = requiredPermissions.filter((code) => currentPermissions.includes(code)).length;
  if (matched <= 0) return 'none';
  if (matched >= requiredPermissions.length) return 'all';
  return 'partial';
};

export const getPrimaryRole = (roles = []) => {
  if (!Array.isArray(roles) || roles.length === 0) return '';
  return AVAILABLE_ROLES.find((role) => roles.includes(role)) || roles[0] || '';
};

export const createCredentialForm = (targetUser = {}) => {
  const parsedDocument = parseDocumentValue(targetUser.document_number);

  return {
    ...INITIAL_CREDENTIAL_FORM,
    first_name: targetUser.first_name || '',
    last_name: targetUser.last_name || '',
    email: targetUser.email || '',
    document_type: parsedDocument.document_type,
    document_number: parsedDocument.document_number,
    phone: targetUser.phone || '',
    address: targetUser.address || '',
    role: getPrimaryRole(targetUser.roles),
    campus_ids: (targetUser.campus_ids || (targetUser.base_campus_id ? [targetUser.base_campus_id] : []))
      .map(Number)
      .filter(Number.isFinite),
  };
};

export const createNewUserForm = (role = DEFAULT_CREATE_ROLE, campusIds = []) => ({
  ...INITIAL_CREDENTIAL_FORM,
  role,
  campus_ids: campusIds.map(Number).filter(Number.isFinite),
});

export const buildUserExportRows = (users = []) =>
  users.map((item) => ({
    id: item.id,
    usuario: `${item.first_name || ''} ${item.last_name || ''}`.trim(),
    documento: item.document_number || '',
    correo: item.email || '',
	    sedes:
	      (item.campus_names || []).join(' | ') ||
	      item.base_campus_name ||
	      (getPrimaryRole(item.roles) === 'ADMIN' ? 'Todas las sedes' : 'Sin sede'),
	    activo: item.activation_required ? 'PENDIENTE' : item.is_active ? 'SI' : 'NO',
    roles: (item.roles || []).join(' | '),
    creado_en: item.created_at ? new Date(item.created_at).toLocaleString() : '',
  }));

export const updatePermissions = (currentPermissions = [], permissionCodes = [], enabled) => {
  const nextPermissions = new Set(currentPermissions);

  for (const code of permissionCodes) {
    if (enabled) nextPermissions.add(code);
    else nextPermissions.delete(code);
  }

  return Array.from(nextPermissions).sort();
};

export const buildCredentialUpdateState = ({
  credentialForm,
  editingCredentialUser,
  canManageStatus,
  canManageRoles,
  isRootAdmin,
}) => {
  const normalizedFirstName = credentialForm.first_name.trim();
  const normalizedLastName = credentialForm.last_name.trim();
  const normalizedEmail = credentialForm.email.trim().toLowerCase();
  const normalizedPhone = credentialForm.phone.trim();
  const normalizedAddress = credentialForm.address.trim();
  const normalizedDocumentNumber = credentialForm.document_number.trim();
  const password = credentialForm.password;
  const currentRole = getPrimaryRole(editingCredentialUser.roles);
  const nextRole = (credentialForm.role || '').trim() || currentRole;
  const nextDocumentValue = normalizedDocumentNumber
    ? buildDocumentValue(credentialForm.document_type, normalizedDocumentNumber)
    : '';
  const roleChanged = canManageRoles && isRootAdmin && Boolean(nextRole) && nextRole !== currentRole;
  const payload = {};

  if (canManageStatus) {
    if (normalizedFirstName !== (editingCredentialUser.first_name || '').trim()) {
      payload.first_name = normalizedFirstName;
    }
    if (normalizedLastName !== (editingCredentialUser.last_name || '').trim()) {
      payload.last_name = normalizedLastName;
    }
    if (normalizedEmail && normalizedEmail !== (editingCredentialUser.email || '').trim().toLowerCase()) {
      payload.email = normalizedEmail;
    }
    if (password) {
      payload.password = password;
    }
    if (nextDocumentValue && nextDocumentValue !== (editingCredentialUser.document_number || '').trim()) {
      payload.document_number = nextDocumentValue;
    }
    if (normalizedPhone !== (editingCredentialUser.phone || '').trim()) {
      payload.phone = normalizedPhone || null;
    }
    if (normalizedAddress !== (editingCredentialUser.address || '').trim()) {
      payload.address = normalizedAddress || null;
    }
  }

  return {
    payload,
    normalizedFirstName,
    normalizedLastName,
    currentRole,
    nextRole,
    roleChanged,
  };
};

export const getCredentialSaveSuccessMessage = ({ accessChanged, roleChanged, campusesChanged }) => {
  if (campusesChanged) {
    return 'Datos, accesos y sedes autorizadas actualizados.';
  }
  if (accessChanged && roleChanged) {
    return 'Datos, rol y accesos actualizados.';
  }
  if (accessChanged) {
    return 'Accesos personalizados actualizados.';
  }
  if (roleChanged) {
    return 'Acceso, datos y rol actualizados.';
  }
  return 'Acceso y datos actualizados.';
};
