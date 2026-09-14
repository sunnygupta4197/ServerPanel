// Single source of truth for default role -> permission-set assignment.
// Previously duplicated (and inconsistent) across src/routes/auth.js,
// src/routes/users.js, and seeds/seeds_data.js — each granted a different
// permission list for the same role, so a user's actual capabilities
// depended on which endpoint created their account.
// Every `requirePermission('x:y')` call across src/routes/*.js must have a
// matching entry here for user/viewer roles, or that whole route file is
// silently 403-only-for-admin — this file previously omitted domains, ssl,
// email, backups, and apps entirely, which meant every ownership/IDOR check
// added to those routes was unreachable for any non-admin account. Keep
// this list in sync with the routes' requirePermission() calls.
const DEFAULT_ROLE_PERMISSIONS = {
  admin: [
    'system:read', 'system:write', 'system:execute',
    'files:read', 'files:write', 'files:delete',
    'users:read', 'users:write', 'users:delete',
    'services:read', 'services:write',
    'database:read', 'database:write',
    'monitoring:read', 'monitoring:write',
    'settings:read', 'settings:write',
    'domains:read', 'domains:write',
    'ssl:read', 'ssl:write',
    'email:read', 'email:write',
    'backups:read', 'backups:write',
    'apps:read', 'apps:install', 'apps:uninstall', 'apps:update', 'apps:configure',
    'ftp:read', 'ftp:write',
    'php:read', 'php:write',
    'terminal:safe', 'cron:safe',
    'sites:read', 'sites:write'
  ],
  // A "user" here is a hosting customer managing their own account, not an
  // operator of the panel host itself — no system:write, services:*, or
  // database:* (that route is an internal admin console over the panel's
  // own operational DB, not a customer-facing feature).
  user: [
    'files:read', 'files:write',
    'monitoring:read',
    'system:read',
    'domains:read', 'domains:write',
    'ssl:read', 'ssl:write',
    'email:read', 'email:write',
    'backups:read', 'backups:write',
    'apps:read', 'apps:install', 'apps:uninstall',
    'ftp:read', 'ftp:write',
    'php:read', 'php:write',
    'terminal:safe', 'cron:safe',
    'sites:read', 'sites:write'
  ],
  viewer: [
    'files:read',
    'monitoring:read',
    'system:read',
    'domains:read',
    'ssl:read',
    'email:read',
    'backups:read',
    'apps:read',
    'ftp:read',
    'php:read',
    // Read-only diagnostics fit viewer's read-only nature; cron:safe
    // (scheduling something to run later) does not — that stays a
    // "user"/admin-only action.
    'terminal:safe',
    // sites:read only — previewing a template renders HTML in memory and
    // never touches the filesystem, so it's as read-only as it looks;
    // sites:write (actually publishing to a document root) is withheld,
    // same reasoning as cron:safe above.
    'sites:read'
  ]
};

function getDefaultPermissions(role) {
  return DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.viewer;
}

// admin holds the full superset of every permission string the app grants,
// so it doubles as the "what permission strings actually exist" list —
// used to validate an arbitrary permissions array (e.g. when an admin sets
// a user's permissions directly) instead of a separately hand-maintained
// allow-list that drifts from this one.
function getAllPermissions() {
  return DEFAULT_ROLE_PERMISSIONS.admin;
}

module.exports = { DEFAULT_ROLE_PERMISSIONS, getDefaultPermissions, getAllPermissions };
