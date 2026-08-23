const { issueAgentToken } = require('../auth/security');

function createAgentService({ config, store }) {
  return {
    async register(input) {
      const agent = await store.registerAgent(input);
      const token = issueAgentToken(
        {
          agentId: agent.id,
          serverId: agent.serverId
        },
        {
          jwtSecret: config.agentJwtSecret,
          issuer: config.jwtIssuer,
          audience: config.agentJwtAudience
        }
      );

      await store.appendAuditEvent({
        actorUserId: null,
        action: 'agent.register',
        resourceType: 'server',
        resourceId: agent.serverId,
        metadata: { agentId: agent.id, hostname: agent.hostname }
      });

      return { agent, token };
    },
    async heartbeat(agentId, payload) {
      return store.updateAgentHeartbeat(agentId, payload);
    },
    async listAgents() {
      return store.listAgents();
    }
  };
}

module.exports = {
  createAgentService
};
