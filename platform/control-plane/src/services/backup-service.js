function createBackupService({ store }) {
  return {
    async listBackups() {
      return store.listBackups();
    },
    async createBackup(input, actorUserId) {
      const backup = await store.createBackup(input);
      await store.appendAuditEvent({
        actorUserId,
        action: 'backup.create',
        resourceType: 'backup',
        resourceId: backup.id,
        metadata: { serverId: backup.serverId, resourceType: backup.targetResourceType }
      });
      return backup;
    }
  };
}

module.exports = {
  createBackupService
};
