function createJobService({ store }) {
  return {
    async listJobs() {
      return store.listJobs();
    },
    async getJob(jobId) {
      return store.getJobById(jobId);
    },
    async dispatchJob(input, actorUserId) {
      const job = await store.createJob(input);
      await store.appendJobEvent(job.id, {
        type: 'job.created',
        message: `Job ${job.type} created`,
        payload: { requestedByUserId: actorUserId }
      });
      await store.appendAuditEvent({
        actorUserId,
        action: 'job.create',
        resourceType: 'job',
        resourceId: job.id,
        metadata: {
          type: job.type,
          targetServerId: job.targetServerId
        }
      });
      return job;
    }
  };
}

module.exports = {
  createJobService
};
