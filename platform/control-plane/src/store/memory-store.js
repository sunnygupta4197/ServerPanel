const crypto = require('crypto');
const { Role } = require('../../../shared/src');
const { createServerEntity } = require('../domain/entities');
const { createJob } = require('../jobs/model');
const { hashPassword } = require('../auth/security');

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function createMemoryStore(config) {
  const passwordHash = await hashPassword(config.bootstrapAdminPassword);
  const now = new Date().toISOString();

  const team = {
    id: createId('team'),
    name: config.bootstrapTeamName,
    createdAt: now
  };

  const owner = {
    id: createId('user'),
    email: config.bootstrapAdminEmail.toLowerCase(),
    passwordHash,
    role: Role.OWNER,
    status: 'active',
    mfaEnabled: false,
    createdAt: now,
    lastLoginAt: null
  };

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
    requestedByUserId: owner.id,
    targetServerId: server.id,
    input: { reason: 'bootstrap' }
  });

  const state = {
    teams: [team],
    users: [owner],
    servers: [server],
    jobs: [job],
    auditEvents: []
  };

  return {
    async findUserByEmail(email) {
      return state.users.find((user) => user.email === String(email).toLowerCase()) || null;
    },
    async updateUserLastLogin(userId) {
      const user = state.users.find((item) => item.id === userId);
      if (user) {
        user.lastLoginAt = new Date().toISOString();
      }
      return user || null;
    },
    async listUsers() {
      return state.users.map((user) => ({ ...user }));
    },
    async listServers() {
      return state.servers.map((item) => ({ ...item }));
    },
    async createServer(serverInput) {
      const serverEntity = createServerEntity({
        id: createId('srv'),
        ...serverInput
      });
      state.servers.push(serverEntity);
      return { ...serverEntity };
    },
    async listJobs() {
      return state.jobs.map((item) => ({ ...item }));
    },
    async appendAuditEvent(event) {
      const auditEvent = {
        id: createId('audit'),
        createdAt: new Date().toISOString(),
        ...event
      };
      state.auditEvents.push(auditEvent);
      return auditEvent;
    }
  };
}

module.exports = {
  createMemoryStore
};
