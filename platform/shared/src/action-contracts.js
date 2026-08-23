const {
  assertNonEmptyArray,
  assertObject,
  assertOneOf,
  assertString
} = require('./assert');
const { AgentActionType } = require('./action-types');

const SERVICE_ACTIONS = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
const DATABASE_ENGINES = ['postgres', 'mysql'];
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[A-Za-z]{2,}$/;

function assertLinuxAbsolutePath(value, fieldName) {
  assertString(value, fieldName);

  if (!value.startsWith('/')) {
    throw new Error(`${fieldName} must be an absolute Linux path`);
  }

  if (value.includes('\0')) {
    throw new Error(`${fieldName} must not contain null bytes`);
  }

  const segments = value.split('/').filter(Boolean);
  if (segments.includes('..')) {
    throw new Error(`${fieldName} must not contain parent directory traversal segments`);
  }
}

function assertHostname(value, fieldName) {
  assertString(value, fieldName);

  if (!HOSTNAME_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a valid hostname`);
  }
}

function assertHostnameArray(values, fieldName) {
  assertNonEmptyArray(values, fieldName);

  for (let index = 0; index < values.length; index += 1) {
    assertHostname(values[index], `${fieldName}[${index}]`);
  }
}

function validateAgentAction(action) {
  assertObject(action, 'action');
  assertString(action.type, 'action.type');
  assertString(action.requestId, 'action.requestId');
  assertObject(action.payload, 'action.payload');

  const allowedTypes = Object.values(AgentActionType);
  assertOneOf(action.type, 'action.type', allowedTypes);

  switch (action.type) {
    case AgentActionType.FILE_READ:
      assertLinuxAbsolutePath(action.payload.path, 'payload.path');
      break;
    case AgentActionType.FILE_WRITE:
      assertLinuxAbsolutePath(action.payload.path, 'payload.path');
      assertString(action.payload.content, 'payload.content');
      break;
    case AgentActionType.FILE_DELETE:
      assertLinuxAbsolutePath(action.payload.path, 'payload.path');
      break;
    case AgentActionType.FILE_LIST:
      assertLinuxAbsolutePath(action.payload.path, 'payload.path');
      break;
    case AgentActionType.DIRECTORY_CREATE:
      assertLinuxAbsolutePath(action.payload.path, 'payload.path');
      break;
    case AgentActionType.SERVICE_STATUS:
      assertString(action.payload.name, 'payload.name');
      break;
    case AgentActionType.SERVICE_CONTROL:
      assertString(action.payload.name, 'payload.name');
      assertOneOf(action.payload.action, 'payload.action', SERVICE_ACTIONS);
      break;
    case AgentActionType.PROCESS_RESTART:
      assertString(action.payload.appId, 'payload.appId');
      break;
    case AgentActionType.DATABASE_PROVISION:
      assertString(action.payload.databaseName, 'payload.databaseName');
      assertString(action.payload.username, 'payload.username');
      assertOneOf(action.payload.engine, 'payload.engine', DATABASE_ENGINES);
      break;
    case AgentActionType.DATABASE_BACKUP:
    case AgentActionType.DATABASE_RESTORE:
      assertString(action.payload.databaseId, 'payload.databaseId');
      break;
    case AgentActionType.CERTIFICATE_ISSUE:
      assertHostnameArray(action.payload.domains, 'payload.domains');
      break;
    case AgentActionType.PROXY_RENDER:
      assertString(action.payload.siteId, 'payload.siteId');
      break;
    case AgentActionType.APP_DEPLOY:
      assertString(action.payload.appId, 'payload.appId');
      break;
    case AgentActionType.APP_HEALTHCHECK:
      assertString(action.payload.appId, 'payload.appId');
      break;
    case AgentActionType.METRICS_COLLECT:
      break;
    default:
      throw new Error(`Unsupported action type: ${action.type}`);
  }

  return true;
}

module.exports = {
  DATABASE_ENGINES,
  SERVICE_ACTIONS,
  assertHostname,
  assertHostnameArray,
  assertLinuxAbsolutePath,
  validateAgentAction
};
