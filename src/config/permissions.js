// Single source of truth for default role -> permission-set assignment.
// Previously duplicated (and inconsistent) across src/routes/auth.js,
// src/routes/users.js, and seeds/seeds_data.js — each granted a different
// permission list for the same role, so a user's actual capabilities
// depended on which endpoint created their account.
const DEFAULT_ROLE_PERMISSIONS = {
  admin: [
    'system:read', 'system:write', 'system:execute',
    'files:read', 'files:write', 'files:delete',
    'users:read', 'users:write', 'users:delete',
    'services:read', 'services:write',
    'database:read', 'database:write',
    'monitoring:read', 'monitoring:write',
    'settings:read', 'settings:write'
  ],
  user: [
    'files:read', 'files:write',
    'monitoring:read',
    'system:read'
  ],
  viewer: [
    'files:read',
    'monitoring:read',
    'system:read'
  ]
};

function getDefaultPermissions(role) {
  return DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.viewer;
}

module.exports = { DEFAULT_ROLE_PERMISSIONS, getDefaultPermissions };
