/**
 * Drop and recreate domains, ssl_certificates, email_accounts with the schema
 * the routes actually expect. The old tables were created by an earlier migration
 * with different column names.
 */
exports.up = async function(knex) {
  // SQLite doesn't enforce FK constraints by default, so drop order is flexible.
  // Drop in dependency order anyway for clarity.
  await knex.schema.dropTableIfExists('email_forwarders');
  await knex.schema.dropTableIfExists('email_accounts');
  await knex.schema.dropTableIfExists('ssl_certificates');
  await knex.schema.dropTableIfExists('dns_records');
  await knex.schema.dropTableIfExists('domains');

  // Domains
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
    table.string('issuer', 255).defaultTo("Let's Encrypt");
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
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('email_forwarders');
  await knex.schema.dropTableIfExists('email_accounts');
  await knex.schema.dropTableIfExists('ssl_certificates');
  await knex.schema.dropTableIfExists('dns_records');
  await knex.schema.dropTableIfExists('domains');
};
