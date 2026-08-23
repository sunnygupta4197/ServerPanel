function createServerService({ config, store }) {
  return {
    async listServers() {
      return store.listServers();
    },
    async createServer(input, actorUserId) {
      const server = await store.createServer(input);
      await store.appendAuditEvent({
        actorUserId,
        action: 'server.create',
        resourceType: 'server',
        resourceId: server.id,
        metadata: { provider: server.provider, hostname: server.hostname }
      });
      return server;
    },
    async issueEnrollmentToken(serverId, actorUserId) {
      const expiresAt = new Date(Date.now() + config.enrollmentTokenTtlMinutes * 60 * 1000).toISOString();
      const token = await store.createAgentEnrollmentToken({
        serverId,
        createdByUserId: actorUserId,
        expiresAt
      });

      await store.appendAuditEvent({
        actorUserId,
        action: 'server.issue_enrollment_token',
        resourceType: 'server',
        resourceId: serverId,
        metadata: { expiresAt }
      });

      return token;
    }
  };
}

module.exports = {
  createServerService
};
