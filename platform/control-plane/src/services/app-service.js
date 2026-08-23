function createAppService({ store }) {
  return {
    async listApps() {
      return store.listApps();
    },
    async createApp(input, actorUserId) {
      const app = await store.createApp(input);
      await store.appendAuditEvent({
        actorUserId,
        action: 'app.create',
        resourceType: 'app',
        resourceId: app.id,
        metadata: { serverId: app.serverId, runtime: app.runtime }
      });
      return app;
    }
  };
}

module.exports = {
  createAppService
};
