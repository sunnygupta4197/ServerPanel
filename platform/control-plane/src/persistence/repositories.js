function createServerRepository(knex) {
  return {
    async save(server) {
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
        last_heartbeat_at: server.lastHeartbeatAt
      }).onConflict('id').merge();

      return server;
    }
  };
}

function createJobRepository(knex) {
  return {
    async save(job) {
      await knex('platform_jobs').insert({
        id: job.id,
        type: job.type,
        status: job.status,
        resource_type: job.resourceType,
        resource_id: job.resourceId,
        target_server_id: job.targetServerId,
        requested_by_user_id: job.requestedByUserId,
        input: JSON.stringify(job.input || {}),
        output: job.output ? JSON.stringify(job.output) : null,
        progress: job.progress,
        attempts: job.attempts,
        max_attempts: job.maxAttempts,
        created_at: job.createdAt,
        started_at: job.startedAt,
        completed_at: job.completedAt
      }).onConflict('id').merge();

      return job;
    }
  };
}

module.exports = {
  createJobRepository,
  createServerRepository
};
