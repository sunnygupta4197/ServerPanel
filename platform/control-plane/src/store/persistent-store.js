const crypto = require('crypto');
const { Role } = require('../../../shared/src');
const { createApplicationEntity, createDatabaseEntity, createServerEntity } = require('../domain/entities');
const { createJob } = require('../jobs/model');
const { hashPassword } = require('../auth/security');
const { createPlatformSchema } = require('../persistence/schema');
const { assertHostnameArray } = require('../../../shared/src/action-contracts');
const { assertOneOf, assertString } = require('../../../shared/src/assert');

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  return typeof value === 'string' ? JSON.parse(value) : value;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function mapUserRecord(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    email: record.email,
    passwordHash: record.password_hash,
    role: record.role,
    status: record.status,
    mfaEnabled: Boolean(record.mfa_enabled),
    createdAt: record.created_at,
    lastLoginAt: record.last_login_at
  };
}

function mapServerRecord(record) {
  return {
    id: record.id,
    type: 'server',
    name: record.name,
    provider: record.provider,
    hostname: record.hostname,
    status: record.status,
    environment: record.environment,
    tags: parseJson(record.tags, []),
    capabilities: parseJson(record.capabilities, []),
    registeredAt: record.registered_at,
    lastHeartbeatAt: record.last_heartbeat_at
  };
}

function mapJobRecord(record) {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    resourceType: record.resource_type,
    resourceId: record.resource_id,
    targetServerId: record.target_server_id,
    requestedByUserId: record.requested_by_user_id,
    input: parseJson(record.input, {}),
    output: parseJson(record.output, null),
    progress: record.progress,
    attempts: record.attempts,
    maxAttempts: record.max_attempts,
    createdAt: record.created_at,
    startedAt: record.started_at,
    completedAt: record.completed_at
  };
}

function mapAppRecord(record) {
  return {
    id: record.id,
    type: 'app',
    name: record.name,
    serverId: record.server_id,
    runtime: record.runtime,
    sourceType: record.source_type,
    status: record.status,
    domains: parseJson(record.domains, []),
    deployRoot: record.deploy_root,
    healthCheckUrl: record.health_check_url,
    createdAt: record.created_at
  };
}

function mapDatabaseRecord(record) {
  return {
    id: record.id,
    type: 'database',
    serverId: record.server_id,
    name: record.name,
    engine: record.engine,
    status: record.status,
    credentialSecretRef: record.credential_secret_ref,
    createdAt: record.created_at
  };
}

function mapCertificateRecord(record) {
  return {
    id: record.id,
    type: 'certificate',
    serverId: record.server_id,
    domains: parseJson(record.domains, []),
    provider: record.provider,
    status: record.status,
    createdAt: record.created_at
  };
}

function mapBackupRecord(record) {
  return {
    id: record.id,
    type: 'backup',
    serverId: record.server_id,
    targetResourceType: record.target_resource_type,
    targetResourceId: record.target_resource_id,
    storageProvider: record.storage_provider,
    status: record.status,
    createdAt: record.created_at
  };
}

function mapAgentRecord(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    serverId: record.server_id,
    hostname: record.hostname,
    version: record.version,
    capabilities: parseJson(record.capabilities, []),
    status: record.status,
    registeredAt: record.registered_at,
    lastHeartbeatAt: record.last_heartbeat_at
  };
}

async function bootstrapPersistentStore(knex, config) {
  await createPlatformSchema(knex);

  const existingOwner = await knex('platform_users')
    .where({ email: config.bootstrapAdminEmail.toLowerCase() })
    .first();

  if (existingOwner) {
    return;
  }

  const now = new Date().toISOString();
  const teamId = createId('team');
  const ownerId = createId('user');
  const server = createServerEntity({
    id: createId('srv'),
    name: 'bootstrap-server',
    provider: 'self_hosted',
    hostname: 'serverpanel.local',
    status: 'pending',
    environment: 'production',
    tags: ['bootstrap'],
    capabilities: ['agent_registration']
  });
  const job = createJob({
    id: createId('job'),
    type: 'server.register',
    resourceType: 'server',
    resourceId: server.id,
    requestedByUserId: ownerId,
    targetServerId: server.id,
    input: { reason: 'bootstrap' }
  });

  await knex('platform_teams').insert({
    id: teamId,
    name: config.bootstrapTeamName,
    created_at: now,
    updated_at: now
  });

  await knex('platform_users').insert({
    id: ownerId,
    email: config.bootstrapAdminEmail.toLowerCase(),
    password_hash: await hashPassword(config.bootstrapAdminPassword),
    role: Role.OWNER,
    status: 'active',
    mfa_enabled: false,
    last_login_at: null,
    created_at: now,
    updated_at: now
  });

  await knex('platform_team_memberships').insert({
    id: createId('membership'),
    team_id: teamId,
    user_id: ownerId,
    role: Role.OWNER,
    created_at: now,
    updated_at: now
  });

  await knex('platform_servers').insert({
    id: server.id,
    name: server.name,
    provider: server.provider,
    hostname: server.hostname,
    status: server.status,
    environment: server.environment,
    tags: JSON.stringify(server.tags),
    capabilities: JSON.stringify(server.capabilities),
    registered_at: server.registeredAt,
    last_heartbeat_at: server.lastHeartbeatAt,
    created_at: now,
    updated_at: now
  });

  await knex('platform_jobs').insert({
    id: job.id,
    type: job.type,
    status: job.status,
    resource_type: job.resourceType,
    resource_id: job.resourceId,
    target_server_id: job.targetServerId,
    requested_by_user_id: job.requestedByUserId,
    input: JSON.stringify(job.input),
    output: null,
    progress: job.progress,
    attempts: job.attempts,
    max_attempts: job.maxAttempts,
    created_at: job.createdAt,
    started_at: job.startedAt,
    completed_at: job.completedAt,
    updated_at: now
  });
}

async function createPersistentStore({ knex, config }) {
  await bootstrapPersistentStore(knex, config);

  return {
    async close() {
      await knex.destroy();
    },
    async findUserByEmail(email) {
      const record = await knex('platform_users')
        .where({ email: String(email).toLowerCase() })
        .first();
      return mapUserRecord(record);
    },
    async updateUserLastLogin(userId) {
      const timestamp = new Date().toISOString();
      await knex('platform_users')
        .where({ id: userId })
        .update({
          last_login_at: timestamp,
          updated_at: timestamp
        });

      const record = await knex('platform_users').where({ id: userId }).first();
      return mapUserRecord(record);
    },
    async listUsers() {
      const records = await knex('platform_users').select('*').orderBy('created_at', 'asc');
      return records.map(mapUserRecord);
    },
    async listServers() {
      const records = await knex('platform_servers').select('*').orderBy('registered_at', 'asc');
      return records.map(mapServerRecord);
    },
    async getServerById(serverId) {
      const record = await knex('platform_servers').where({ id: serverId }).first();
      return record ? mapServerRecord(record) : null;
    },
    async createServer(serverInput) {
      const server = createServerEntity({
        id: createId('srv'),
        ...serverInput
      });
      const now = new Date().toISOString();

      await knex('platform_servers').insert({
        id: server.id,
        name: server.name,
        provider: server.provider,
        hostname: server.hostname,
        status: server.status,
        environment: server.environment,
        tags: JSON.stringify(server.tags || []),
        capabilities: JSON.stringify(server.capabilities || []),
        registered_at: server.registeredAt,
        last_heartbeat_at: server.lastHeartbeatAt,
        created_at: now,
        updated_at: now
      });

      return server;
    },
    async createAgentEnrollmentToken({ serverId, createdByUserId, expiresAt }) {
      const server = await knex('platform_servers').where({ id: serverId }).first();
      if (!server) {
        throw new Error('Server not found');
      }

      const plaintextToken = `enroll_${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      await knex('platform_agent_enrollment_tokens').insert({
        id: createId('enroll'),
        server_id: serverId,
        token_hash: hashToken(plaintextToken),
        created_by_user_id: createdByUserId,
        created_at: createdAt,
        expires_at: expiresAt,
        claimed_at: null,
        updated_at: createdAt
      });

      return {
        token: plaintextToken,
        expiresAt,
        serverId
      };
    },
    async registerAgent({ enrollmentToken, hostname, version, capabilities }) {
      const now = new Date().toISOString();
      const tokenRecord = await knex('platform_agent_enrollment_tokens')
        .where({ token_hash: hashToken(enrollmentToken) })
        .first();

      if (!tokenRecord) {
        throw new Error('Invalid enrollment token');
      }

      if (tokenRecord.claimed_at) {
        throw new Error('Enrollment token already used');
      }

      if (new Date(tokenRecord.expires_at) < new Date()) {
        throw new Error('Enrollment token expired');
      }

      const agentId = createId('agent');
      await knex('platform_agents').insert({
        id: agentId,
        server_id: tokenRecord.server_id,
        hostname,
        version: version || 'unknown',
        capabilities: JSON.stringify(capabilities || []),
        status: 'active',
        registered_at: now,
        last_heartbeat_at: now,
        created_at: now,
        updated_at: now
      });

      await knex('platform_agent_enrollment_tokens')
        .where({ id: tokenRecord.id })
        .update({
          claimed_at: now,
          updated_at: now
        });

      const agent = await knex('platform_agents').where({ id: agentId }).first();
      return mapAgentRecord(agent);
    },
    async listAgents() {
      const records = await knex('platform_agents').select('*').orderBy('registered_at', 'asc');
      return records.map(mapAgentRecord);
    },
    async updateAgentHeartbeat(agentId, payload) {
      const now = new Date().toISOString();
      await knex('platform_agents')
        .where({ id: agentId })
        .update({
          last_heartbeat_at: now,
          version: payload.version || knex.ref('version'),
          capabilities: payload.capabilities ? JSON.stringify(payload.capabilities) : knex.ref('capabilities'),
          updated_at: now
        });

      const record = await knex('platform_agents').where({ id: agentId }).first();
      return mapAgentRecord(record);
    },
    async listApps() {
      const records = await knex('platform_apps').select('*').orderBy('created_at', 'asc');
      return records.map(mapAppRecord);
    },
    async createApp(appInput) {
      const app = createApplicationEntity({
        id: createId('app'),
        ...appInput
      });
      const now = new Date().toISOString();

      await knex('platform_apps').insert({
        id: app.id,
        server_id: app.serverId,
        name: app.name,
        runtime: app.runtime,
        source_type: app.sourceType,
        status: app.status,
        domains: JSON.stringify(app.domains || []),
        deploy_root: app.deployRoot,
        health_check_url: app.healthCheckUrl,
        created_at: app.createdAt,
        updated_at: now
      });

      return app;
    },
    async listDatabases() {
      const records = await knex('platform_databases').select('*').orderBy('created_at', 'asc');
      return records.map(mapDatabaseRecord);
    },
    async createDatabase(databaseInput) {
      const database = createDatabaseEntity({
        id: createId('db'),
        ...databaseInput
      });
      const now = new Date().toISOString();

      await knex('platform_databases').insert({
        id: database.id,
        server_id: database.serverId,
        name: database.name,
        engine: database.engine,
        status: database.status,
        credential_secret_ref: database.credentialSecretRef,
        created_at: database.createdAt,
        updated_at: now
      });

      return database;
    },
    async listCertificates() {
      const records = await knex('platform_certificates').select('*').orderBy('created_at', 'asc');
      return records.map(mapCertificateRecord);
    },
    async createCertificate(input) {
      assertString(input.serverId, 'certificate.serverId');
      assertHostnameArray(input.domains, 'certificate.domains');
      const provider = input.provider || 'letsencrypt';
      const now = new Date().toISOString();
      const certificate = {
        id: createId('cert'),
        type: 'certificate',
        serverId: input.serverId,
        domains: input.domains,
        provider,
        status: 'pending',
        createdAt: now
      };

      await knex('platform_certificates').insert({
        id: certificate.id,
        server_id: certificate.serverId,
        domains: JSON.stringify(certificate.domains),
        provider: certificate.provider,
        status: certificate.status,
        created_at: certificate.createdAt,
        updated_at: now
      });

      return certificate;
    },
    async listBackups() {
      const records = await knex('platform_backups').select('*').orderBy('created_at', 'asc');
      return records.map(mapBackupRecord);
    },
    async createBackup(input) {
      assertString(input.serverId, 'backup.serverId');
      assertString(input.targetResourceType, 'backup.targetResourceType');
      assertString(input.targetResourceId, 'backup.targetResourceId');
      const allowedStorageProviders = ['local', 's3', 'gcs', 'azure'];
      assertOneOf(input.storageProvider || 'local', 'backup.storageProvider', allowedStorageProviders);
      const now = new Date().toISOString();
      const backup = {
        id: createId('backup'),
        type: 'backup',
        serverId: input.serverId,
        targetResourceType: input.targetResourceType,
        targetResourceId: input.targetResourceId,
        storageProvider: input.storageProvider || 'local',
        status: 'queued',
        createdAt: now
      };

      await knex('platform_backups').insert({
        id: backup.id,
        server_id: backup.serverId,
        target_resource_type: backup.targetResourceType,
        target_resource_id: backup.targetResourceId,
        storage_provider: backup.storageProvider,
        status: backup.status,
        created_at: backup.createdAt,
        updated_at: now
      });

      return backup;
    },
    async listJobs() {
      const records = await knex('platform_jobs').select('*').orderBy('created_at', 'asc');
      return records.map(mapJobRecord);
    },
    async getJobById(jobId) {
      const record = await knex('platform_jobs').where({ id: jobId }).first();
      return record ? mapJobRecord(record) : null;
    },
    async createJob(jobInput) {
      const job = createJob({
        id: createId('job'),
        ...jobInput
      });
      const now = new Date().toISOString();

      await knex('platform_jobs').insert({
        id: job.id,
        type: job.type,
        status: job.status,
        resource_type: job.resourceType,
        resource_id: job.resourceId,
        target_server_id: job.targetServerId,
        requested_by_user_id: job.requestedByUserId,
        input: JSON.stringify(job.input || {}),
        output: null,
        progress: job.progress,
        attempts: job.attempts,
        max_attempts: job.maxAttempts,
        created_at: job.createdAt,
        started_at: job.startedAt,
        completed_at: job.completedAt,
        updated_at: now
      });

      return job;
    },
    async appendJobEvent(jobId, event) {
      const createdAt = new Date().toISOString();
      await knex('platform_job_events').insert({
        id: createId('jobevt'),
        job_id: jobId,
        type: event.type,
        message: event.message,
        payload: JSON.stringify(event.payload || {}),
        created_at: createdAt
      });
    },
    async appendAuditEvent(event) {
      const auditEvent = {
        id: createId('audit'),
        createdAt: new Date().toISOString(),
        ...event
      };

      await knex('platform_audit_events').insert({
        id: auditEvent.id,
        actor_user_id: auditEvent.actorUserId || null,
        action: auditEvent.action,
        resource_type: auditEvent.resourceType,
        resource_id: auditEvent.resourceId,
        metadata: JSON.stringify(auditEvent.metadata || {}),
        created_at: auditEvent.createdAt,
        updated_at: auditEvent.createdAt
      });

      return auditEvent;
    }
  };
}

module.exports = {
  createPersistentStore
};
