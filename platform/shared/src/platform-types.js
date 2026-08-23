const ApplicationRuntime = Object.freeze({
  NODE: 'node',
  PYTHON: 'python',
  PHP: 'php',
  STATIC: 'static',
  DOCKER: 'docker'
});

const ApplicationSourceType = Object.freeze({
  GIT: 'git',
  ARCHIVE: 'archive',
  MANUAL: 'manual',
  REGISTRY: 'registry'
});

const ApplicationStatus = Object.freeze({
  DRAFT: 'draft',
  PROVISIONING: 'provisioning',
  DEPLOYING: 'deploying',
  RUNNING: 'running',
  DEGRADED: 'degraded',
  FAILED: 'failed',
  SUSPENDED: 'suspended'
});

const DatabaseStatus = Object.freeze({
  PROVISIONING: 'provisioning',
  READY: 'ready',
  DEGRADED: 'degraded',
  FAILED: 'failed',
  DELETING: 'deleting'
});

const ApprovalLevel = Object.freeze({
  STANDARD: 'standard',
  ELEVATED: 'elevated',
  BREAK_GLASS: 'break_glass'
});

module.exports = {
  ApplicationRuntime,
  ApplicationSourceType,
  ApplicationStatus,
  ApprovalLevel,
  DatabaseStatus
};
