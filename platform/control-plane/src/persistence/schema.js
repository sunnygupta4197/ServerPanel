async function ensureTable(knex, tableName, builder) {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await knex.schema.createTable(tableName, builder);
  }
}

async function createPlatformSchema(knex) {
  await ensureTable(knex, 'platform_users', (table) => {
    table.string('id').primary();
    table.string('email').notNullable().unique();
    table.string('password_hash').notNullable();
    table.string('role').notNullable();
    table.string('status').notNullable();
    table.boolean('mfa_enabled').notNullable().defaultTo(false);
    table.timestamp('last_login_at').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_teams', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_team_memberships', (table) => {
    table.string('id').primary();
    table.string('team_id').notNullable();
    table.string('user_id').notNullable();
    table.string('role').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_servers', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('provider').notNullable();
    table.string('hostname').nullable();
    table.string('status').notNullable();
    table.string('environment').notNullable();
    table.json('tags').notNullable();
    table.json('capabilities').notNullable();
    table.timestamp('registered_at').notNullable();
    table.timestamp('last_heartbeat_at').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_apps', (table) => {
    table.string('id').primary();
    table.string('server_id').notNullable();
    table.string('name').notNullable();
    table.string('runtime').notNullable();
    table.string('source_type').notNullable();
    table.string('status').notNullable();
    table.json('domains').notNullable();
    table.string('deploy_root').nullable();
    table.string('health_check_url').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_databases', (table) => {
    table.string('id').primary();
    table.string('server_id').notNullable();
    table.string('name').notNullable();
    table.string('engine').notNullable();
    table.string('status').notNullable();
    table.string('credential_secret_ref').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_jobs', (table) => {
    table.string('id').primary();
    table.string('type').notNullable();
    table.string('status').notNullable();
    table.string('resource_type').notNullable();
    table.string('resource_id').notNullable();
    table.string('target_server_id').nullable();
    table.string('requested_by_user_id').nullable();
    table.json('input').notNullable();
    table.json('output').nullable();
    table.integer('progress').notNullable().defaultTo(0);
    table.integer('attempts').notNullable().defaultTo(0);
    table.integer('max_attempts').notNullable().defaultTo(3);
    table.timestamp('created_at').notNullable();
    table.timestamp('started_at').nullable();
    table.timestamp('completed_at').nullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_job_events', (table) => {
    table.string('id').primary();
    table.string('job_id').notNullable();
    table.string('type').notNullable();
    table.text('message').notNullable();
    table.json('payload').notNullable();
    table.timestamp('created_at').notNullable();
  });

  await ensureTable(knex, 'platform_agents', (table) => {
    table.string('id').primary();
    table.string('server_id').notNullable();
    table.string('hostname').notNullable();
    table.string('version').notNullable();
    table.json('capabilities').notNullable();
    table.string('status').notNullable();
    table.timestamp('registered_at').notNullable();
    table.timestamp('last_heartbeat_at').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_agent_enrollment_tokens', (table) => {
    table.string('id').primary();
    table.string('server_id').notNullable();
    table.string('token_hash').notNullable().unique();
    table.string('created_by_user_id').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('expires_at').notNullable();
    table.timestamp('claimed_at').nullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_audit_events', (table) => {
    table.string('id').primary();
    table.string('actor_user_id').nullable();
    table.string('action').notNullable();
    table.string('resource_type').notNullable();
    table.string('resource_id').notNullable();
    table.json('metadata').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_secrets', (table) => {
    table.string('id').primary();
    table.string('scope_type').notNullable();
    table.string('scope_id').notNullable();
    table.string('kind').notNullable();
    table.text('ciphertext').notNullable();
    table.text('key_version').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_certificates', (table) => {
    table.string('id').primary();
    table.string('server_id').notNullable();
    table.json('domains').notNullable();
    table.string('provider').notNullable();
    table.string('status').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await ensureTable(knex, 'platform_backups', (table) => {
    table.string('id').primary();
    table.string('server_id').notNullable();
    table.string('target_resource_type').notNullable();
    table.string('target_resource_id').notNullable();
    table.string('storage_provider').notNullable();
    table.string('status').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });
}

module.exports = {
  createPlatformSchema
};
