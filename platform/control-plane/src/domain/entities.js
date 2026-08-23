const {
  ApplicationRuntime,
  ApplicationSourceType,
  ApplicationStatus,
  DatabaseStatus,
  ResourceType,
  ServerProvider,
  ServerStatus
} = require('../../../shared/src');
const {
  DATABASE_ENGINES,
  assertHostnameArray
} = require('../../../shared/src/action-contracts');
const {
  assertArray,
  assertObject,
  assertOneOf,
  assertString
} = require('../../../shared/src/assert');

function createServerEntity(input) {
  assertObject(input, 'server');
  assertString(input.id, 'server.id');
  assertString(input.name, 'server.name');
  assertOneOf(input.provider, 'server.provider', Object.values(ServerProvider));
  assertOneOf(input.status || ServerStatus.PENDING, 'server.status', Object.values(ServerStatus));

  return {
    id: input.id,
    type: ResourceType.SERVER,
    name: input.name,
    provider: input.provider,
    hostname: input.hostname || null,
    status: input.status || ServerStatus.PENDING,
    environment: input.environment || 'production',
    tags: input.tags || [],
    capabilities: input.capabilities || [],
    registeredAt: input.registeredAt || new Date().toISOString(),
    lastHeartbeatAt: input.lastHeartbeatAt || null
  };
}

function createApplicationEntity(input) {
  assertObject(input, 'application');
  assertString(input.id, 'application.id');
  assertString(input.name, 'application.name');
  assertString(input.serverId, 'application.serverId');
  assertOneOf(input.runtime || ApplicationRuntime.NODE, 'application.runtime', Object.values(ApplicationRuntime));
  assertOneOf(input.sourceType || ApplicationSourceType.GIT, 'application.sourceType', Object.values(ApplicationSourceType));
  assertOneOf(input.status || ApplicationStatus.DRAFT, 'application.status', Object.values(ApplicationStatus));

  const domains = input.domains || [];
  assertArray(domains, 'application.domains');
  if (domains.length > 0) {
    assertHostnameArray(domains, 'application.domains');
  }

  return {
    id: input.id,
    type: ResourceType.APP,
    name: input.name,
    serverId: input.serverId,
    runtime: input.runtime || ApplicationRuntime.NODE,
    sourceType: input.sourceType || ApplicationSourceType.GIT,
    status: input.status || ApplicationStatus.DRAFT,
    domains,
    deployRoot: input.deployRoot || null,
    healthCheckUrl: input.healthCheckUrl || null,
    createdAt: input.createdAt || new Date().toISOString()
  };
}

function createDatabaseEntity(input) {
  assertObject(input, 'database');
  assertString(input.id, 'database.id');
  assertString(input.serverId, 'database.serverId');
  assertString(input.name, 'database.name');
  assertOneOf(input.engine || DATABASE_ENGINES[0], 'database.engine', DATABASE_ENGINES);
  assertOneOf(input.status || DatabaseStatus.PROVISIONING, 'database.status', Object.values(DatabaseStatus));

  return {
    id: input.id,
    type: ResourceType.DATABASE,
    serverId: input.serverId,
    name: input.name,
    engine: input.engine || DATABASE_ENGINES[0],
    status: input.status || DatabaseStatus.PROVISIONING,
    credentialSecretRef: input.credentialSecretRef || null,
    createdAt: input.createdAt || new Date().toISOString()
  };
}

module.exports = {
  createApplicationEntity,
  createDatabaseEntity,
  createServerEntity
};
