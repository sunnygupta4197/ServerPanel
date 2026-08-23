const { AgentActionType, ApprovalLevel } = require('../../../shared/src');

const ACTION_POLICY = Object.freeze({
  [AgentActionType.FILE_READ]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.STANDARD,
    allowedRoots: ['/var/www', '/etc/nginx', '/etc/apache2', '/opt/serverpanel/apps']
  },
  [AgentActionType.FILE_WRITE]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.ELEVATED,
    allowedRoots: ['/var/www', '/etc/nginx', '/etc/apache2', '/opt/serverpanel/apps']
  },
  [AgentActionType.FILE_DELETE]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.ELEVATED,
    allowedRoots: ['/var/www', '/opt/serverpanel/apps']
  },
  [AgentActionType.FILE_LIST]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.STANDARD,
    allowedRoots: ['/var/www', '/etc/nginx', '/etc/apache2', '/opt/serverpanel/apps']
  },
  [AgentActionType.DIRECTORY_CREATE]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.ELEVATED,
    allowedRoots: ['/var/www', '/opt/serverpanel/apps']
  },
  [AgentActionType.SERVICE_STATUS]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.STANDARD,
    allowListSource: 'managed_services'
  },
  [AgentActionType.SERVICE_CONTROL]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.ELEVATED,
    allowListSource: 'managed_services'
  },
  [AgentActionType.PROCESS_RESTART]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.ELEVATED,
    allowListSource: 'managed_processes'
  },
  [AgentActionType.DATABASE_PROVISION]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.ELEVATED,
    allowListSource: 'managed_database_engines'
  },
  [AgentActionType.DATABASE_BACKUP]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.STANDARD,
    allowListSource: 'managed_databases'
  },
  [AgentActionType.DATABASE_RESTORE]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.ELEVATED,
    allowListSource: 'managed_databases'
  },
  [AgentActionType.CERTIFICATE_ISSUE]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.STANDARD
  },
  [AgentActionType.APP_DEPLOY]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.STANDARD
  },
  [AgentActionType.APP_HEALTHCHECK]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.STANDARD
  },
  [AgentActionType.PROXY_RENDER]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.ELEVATED
  },
  [AgentActionType.METRICS_COLLECT]: {
    requiresServerAgent: true,
    approval: ApprovalLevel.STANDARD
  }
});

function getActionPolicy(actionType) {
  const policy = ACTION_POLICY[actionType];
  if (!policy) {
    throw new Error(`No action policy registered for ${actionType}`);
  }

  return policy;
}

function assertActionPolicyCoverage() {
  const declaredActions = Object.values(AgentActionType);
  const missingActions = declaredActions.filter((actionType) => !ACTION_POLICY[actionType]);

  if (missingActions.length > 0) {
    throw new Error(`Missing action policies for: ${missingActions.join(', ')}`);
  }

  return true;
}

module.exports = {
  ACTION_POLICY,
  assertActionPolicyCoverage,
  getActionPolicy
};
