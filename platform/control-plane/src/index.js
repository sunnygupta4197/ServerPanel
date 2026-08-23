const { createServerEntity, createApplicationEntity, createDatabaseEntity } = require('./domain/entities');
const { createJob, transitionJob } = require('./jobs/model');
const { ACTION_POLICY, assertActionPolicyCoverage, getActionPolicy } = require('./security/action-policy');
const { createPlatformSchema } = require('./persistence/schema');
const { createJobRepository, createServerRepository } = require('./persistence/repositories');
const { hashPassword, issueAgentToken, issueAccessToken, verifyAgentToken, verifyAccessToken, verifyPassword } = require('./auth/security');
const { getPermissionsForRole, hasPermission, requirePermission } = require('./auth/rbac');
const { createControlPlaneApp } = require('./http/app');
const { buildControlPlane, startControlPlane } = require('./server');

assertActionPolicyCoverage();

module.exports = {
  ACTION_POLICY,
  assertActionPolicyCoverage,
  createApplicationEntity,
  createDatabaseEntity,
  createJob,
  createJobRepository,
  createPlatformSchema,
  createServerEntity,
  createServerRepository,
  createControlPlaneApp,
  getActionPolicy,
  getPermissionsForRole,
  hasPermission,
  hashPassword,
  issueAgentToken,
  issueAccessToken,
  requirePermission,
  buildControlPlane,
  startControlPlane,
  transitionJob,
  verifyAgentToken,
  verifyAccessToken,
  verifyPassword
};
