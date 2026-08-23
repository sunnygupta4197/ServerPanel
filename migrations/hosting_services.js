/**
 * cPanel-style features: domains, DNS, SSL, email, backups
 */

exports.up = async function(knex) {
  // Domains
  if (await knex.schema.hasTable('domains')) return; // already applied under previous filename
  await knex.schema.createTable('domains', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.string('domain', 255).notNullable().unique();
    table.enum('type', ['primary', 'addon', 'subdomain', 'parked']).defaultTo('addon');
    table.string('document_root', 500);
    table.string('redirect_to', 500);
    table.enum('status', ['active', 'suspended', 'pending']).defaultTo('active');
    table.timestamps(true, true);
    table.index(['user_id']);
    table.index(['domain']);
    table.index(['status']);
  });

  // DNS records
  await knex.schema.createTable('dns_records', function(table) {
    table.increments('id').primary();
    table.integer('domain_id').unsigned().references('id').inTable('domains').onDelete('CASCADE');
    table.enum('type', ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'PTR']).notNullable();
    table.string('name', 255).notNullable();
    table.text('value').notNullable();
    table.integer('ttl').defaultTo(3600);
    table.integer('priority').defaultTo(0);
    table.timestamps(true, true);
    table.index(['domain_id']);
    table.index(['type']);
  });

  // SSL certificates
  await knex.schema.createTable('ssl_certificates', function(table) {
    table.increments('id').primary();
    table.integer('domain_id').unsigned().references('id').inTable('domains').onDelete('SET NULL').nullable();
    table.string('domain', 255).notNullable();
    table.string('issuer', 255).defaultTo('Let\'s Encrypt');
    table.enum('status', ['active', 'expired', 'pending', 'failed', 'revoked']).defaultTo('pending');
    table.enum('source', ['letsencrypt', 'manual']).defaultTo('letsencrypt');
    table.text('certificate');
    table.text('private_key');
    table.text('chain');
    table.boolean('auto_renew').defaultTo(true);
    table.timestamp('issued_at');
    table.timestamp('expires_at');
    table.timestamp('last_renewed_at');
    table.text('error_message');
    table.timestamps(true, true);
    table.index(['domain']);
    table.index(['status']);
    table.index(['expires_at']);
  });

  // Email accounts
  await knex.schema.createTable('email_accounts', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.integer('domain_id').unsigned().references('id').inTable('domains').onDelete('CASCADE');
    table.string('local_part', 64).notNullable();
    table.string('domain', 255).notNullable();
    table.string('password_hash', 255).notNullable();
    table.integer('quota_mb').defaultTo(1024);
    table.integer('used_mb').defaultTo(0);
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
    table.unique(['local_part', 'domain']);
    table.index(['domain_id']);
    table.index(['user_id']);
  });

  // Email forwarders
  await knex.schema.createTable('email_forwarders', function(table) {
    table.increments('id').primary();
    table.integer('domain_id').unsigned().references('id').inTable('domains').onDelete('CASCADE');
    table.string('source', 320).notNullable();
    table.string('destination', 320).notNullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
    table.index(['domain_id']);
    table.index(['source']);
  });

  // Backups
  await knex.schema.createTable('backups', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.enum('type', ['full', 'files', 'database', 'emails']).defaultTo('full');
    table.enum('status', ['queued', 'running', 'completed', 'failed']).defaultTo('queued');
    table.string('path', 500);
    table.bigInteger('size_bytes').defaultTo(0);
    table.text('error_message');
    table.string('job_id', 100);
    table.timestamp('started_at');
    table.timestamp('completed_at');
    table.timestamps(true, true);
    table.index(['user_id']);
    table.index(['status']);
    table.index(['type']);
  });

  // Backup schedules
  await knex.schema.createTable('backup_schedules', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.enum('type', ['full', 'files', 'database', 'emails']).defaultTo('full');
    table.enum('frequency', ['daily', 'weekly', 'monthly']).defaultTo('daily');
    table.integer('retention_days').defaultTo(7);
    table.string('destination', 500).defaultTo('local');
    table.boolean('is_active').defaultTo(true);
    table.timestamp('last_run');
    table.timestamp('next_run');
    table.timestamps(true, true);
    table.index(['user_id']);
    table.index(['is_active']);
    table.index(['next_run']);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('backup_schedules');
  await knex.schema.dropTableIfExists('backups');
  await knex.schema.dropTableIfExists('email_forwarders');
  await knex.schema.dropTableIfExists('email_accounts');
  await knex.schema.dropTableIfExists('ssl_certificates');
  await knex.schema.dropTableIfExists('dns_records');
  await knex.schema.dropTableIfExists('domains');
};
