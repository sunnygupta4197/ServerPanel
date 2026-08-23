const { Permission, Role, ROLE_PERMISSIONS } = require('../../../shared/src');
const { assertArray, assertOneOf, assertString } = require('../../../shared/src/assert');

function getPermissionsForRole(role) {
  assertOneOf(role, 'role', Object.values(Role));
  return ROLE_PERMISSIONS[role];
}

function hasPermission(grantedPermissions, requiredPermission) {
  assertArray(grantedPermissions, 'grantedPermissions');
  assertString(requiredPermission, 'requiredPermission');

  if (!Object.values(Permission).includes(requiredPermission)) {
    throw new Error(`Unknown permission: ${requiredPermission}`);
  }

  return grantedPermissions.includes(requiredPermission);
}

function requirePermission(grantedPermissions, requiredPermission) {
  if (!hasPermission(grantedPermissions, requiredPermission)) {
    throw new Error(`Missing required permission: ${requiredPermission}`);
  }

  return true;
}

module.exports = {
  getPermissionsForRole,
  hasPermission,
  requirePermission
};
