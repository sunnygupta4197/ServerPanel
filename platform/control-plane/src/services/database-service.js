function createDatabaseService({ store }) {
  return {
    async listDatabases() {
      return store.listDatabases();
    },
    async createDatabase(input, actorUserId) {
      const database = await store.createDatabase(input);
      await store.appendAuditEvent({
        actorUserId,
        action: 'database.create',
        resourceType: 'database',
        resourceId: database.id,
        metadata: { serverId: database.serverId, engine: database.engine }
      });
      return database;
    }
  };
}

module.exports = {
  createDatabaseService
};
