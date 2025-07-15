/**
 * Initial database schema for ServerPanel Pro
 */

exports.up = async function(knex) {
  // Users table
  await knex.schema.createTable('users', function(table) {
    table.increments('id').primary();
    table.string('username', 50).notNullable().unique();
    table.string('email', 255).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.string('first_name', 100);
    table.string('last_name', 100);
    table.enum('role', ['admin', 'user', 'viewer']).defaultTo('user');
    table.json('permissions').defaultTo('[]');
    table.boolean('is_active').defaultTo(true);
    table.boolean('two_factor_enabled').defaultTo(false);
    table.string('two_factor_secret', 32);
    table.integer('failed_attempts').defaultTo(0);
    table.timestamp('lockout_until');
    table.timestamp('last_login');
    table.string('last_login_ip', 45);
    table.timestamp('last_activity');
    table.timestamp('password_changed_at');
    table.timestamps(true, true);
    
    table.index(['username']);
    table.index(['email']);
    table.index(['is_active']);
    table.index(['last_activity']);
  });

  // API Keys table
  await knex.schema.createTable('api_keys', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.string('name', 100).notNullable();
    table.string('key', 64).notNullable().unique();
    table.json('permissions').defaultTo('[]');
    table.boolean('is_active').defaultTo(true);
    table.timestamp('expires_at');
    table.timestamp('last_used');
    table.timestamps(true, true);
    
    table.index(['key']);
    table.index(['user_id']);
    table.index(['is_active']);
  });

  // Token blacklist for logout functionality
  await knex.schema.createTable('token_blacklist', function(table) {
    table.increments('id').primary();
    table.text('token').notNullable();
    table.timestamp('expires_at').notNullable();
    table.timestamps(true, true);
    
    table.index(['expires_at']);
  });

  // Login attempts tracking
  await knex.schema.createTable('login_attempts', function(table) {
    table.increments('id').primary();
    table.string('username', 50);
    table.string('ip_address', 45).notNullable();
    table.boolean('success').defaultTo(false);
    table.string('user_agent', 500);
    table.timestamp('attempted_at').defaultTo(knex.fn.now());
    
    table.index(['username']);
    table.index(['ip_address']);
    table.index(['attempted_at']);
    table.index(['success']);
  });

  // System statistics
  await knex.schema.createTable('system_stats', function(table) {
    table.increments('id').primary();
    table.timestamp('recorded_at').defaultTo(knex.fn.now());
    table.decimal('cpu_usage', 5, 2);
    table.decimal('memory_usage', 5, 2);
    table.bigInteger('memory_total');
    table.bigInteger('memory_used');
    table.bigInteger('memory_free');
    table.decimal('disk_usage', 5, 2);
    table.bigInteger('disk_total');
    table.bigInteger('disk_used');
    table.bigInteger('disk_free');
    table.decimal('load_avg_1', 8, 2);
    table.decimal('load_avg_5', 8, 2);
    table.decimal('load_avg_15', 8, 2);
    table.integer('processes_total');
    table.integer('processes_running');
    table.decimal('cpu_temperature', 5, 2);
    table.json('network_interfaces');
    
    table.index(['recorded_at']);
  });

  // Server configurations
  await knex.schema.createTable('server_configs', function(table) {
    table.increments('id').primary();
    table.string('config_key', 100).notNullable().unique();
    table.text('config_value');
    table.string('config_type', 20).defaultTo('string'); // string, json, boolean, number
    table.text('description');
    table.boolean('is_encrypted').defaultTo(false);
    table.boolean('is_system').defaultTo(false);
    table.integer('updated_by').unsigned().references('id').inTable('users');
    table.timestamps(true, true);
    
    table.index(['config_key']);
    table.index(['config_type']);
  });

  // File operations log
  await knex.schema.createTable('file_operations', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users');
    table.enum('operation', ['create', 'read', 'update', 'delete', 'upload', 'download', 'move', 'copy']);
    table.text('file_path').notNullable();
    table.text('destination_path');
    table.bigInteger('file_size');
    table.string('file_type', 100);
    table.string('ip_address', 45);
    table.boolean('success').defaultTo(true);
    table.text('error_message');
    table.timestamp('performed_at').defaultTo(knex.fn.now());
    
    table.index(['user_id']);
    table.index(['operation']);
    table.index(['performed_at']);
    table.index(['success']);
  });

  // Service management log
  await knex.schema.createTable('service_operations', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users');
    table.string('service_name', 100).notNullable();
    table.enum('operation', ['start', 'stop', 'restart', 'enable', 'disable', 'reload']);
    table.string('previous_status', 20);
    table.string('new_status', 20);
    table.boolean('success').defaultTo(true);
    table.text('error_message');
    table.string('ip_address', 45);
    table.timestamp('performed_at').defaultTo(knex.fn.now());
    
    table.index(['user_id']);
    table.index(['service_name']);
    table.index(['operation']);
    table.index(['performed_at']);
  });

  // System processes snapshot
  await knex.schema.createTable('process_snapshots', function(table) {
    table.increments('id').primary();
    table.integer('pid').notNullable();
    table.string('name', 255);
    table.text('command');
    table.decimal('cpu_usage', 8, 4);
    table.decimal('memory_usage', 8, 4);
    table.bigInteger('memory_bytes');
    table.string('user', 50);
    table.string('status', 20);
    table.integer('priority');
    table.timestamp('started_at');
    table.timestamp('recorded_at').defaultTo(knex.fn.now());
    
    table.index(['recorded_at']);
    table.index(['cpu_usage']);
    table.index(['memory_usage']);
    table.index(['user']);
  });

  // Email accounts (for email management feature)
  await knex.schema.createTable('email_accounts', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users');
    table.string('email', 255).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.string('domain', 100).notNullable();
    table.bigInteger('quota_mb').defaultTo(1024); // 1GB default
    table.bigInteger('used_mb').defaultTo(0);
    table.boolean('is_active').defaultTo(true);
    table.timestamp('last_login');
    table.timestamps(true, true);
    
    table.index(['domain']);
    table.index(['is_active']);
    table.index(['user_id']);
  });

  // Domain management
  await knex.schema.createTable('domains', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users');
    table.string('domain', 255).notNullable().unique();
    table.string('document_root', 500);
    table.boolean('ssl_enabled').defaultTo(false);
    table.string('ssl_cert_path', 500);
    table.string('ssl_key_path', 500);
    table.timestamp('ssl_expires_at');
    table.boolean('is_active').defaultTo(true);
    table.json('dns_records');
    table.timestamps(true, true);
    
    table.index(['domain']);
    table.index(['user_id']);
    table.index(['is_active']);
    table.index(['ssl_expires_at']);
  });

  // Database management
  await knex.schema.createTable('managed_databases', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users');
    table.string('database_name', 100).notNullable();
    table.string('database_type', 20).notNullable(); // mysql, postgresql, etc.
    table.string('username', 100).notNullable();
    table.string('password_hash', 255).notNullable();
    table.bigInteger('size_mb').defaultTo(0);
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
    
    table.unique(['database_name', 'database_type']);
    table.index(['user_id']);
    table.index(['database_type']);
    table.index(['is_active']);
  });

  // Backup jobs
  await knex.schema.createTable('backup_jobs', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users');
    table.string('name', 100).notNullable();
    table.enum('type', ['files', 'database', 'full']).notNullable();
    table.json('source_paths');
    table.string('destination_path', 500);
    table.string('schedule', 100); // cron format
    table.boolean('compression').defaultTo(true);
    table.boolean('encryption').defaultTo(false);
    table.integer('retention_days').defaultTo(7);
    table.boolean('is_active').defaultTo(true);
    table.timestamp('last_run');
    table.timestamp('next_run');
    table.timestamps(true, true);
    
    table.index(['user_id']);
    table.index(['type']);
    table.index(['is_active']);
    table.index(['next_run']);
  });

  // Backup executions
  await knex.schema.createTable('backup_executions', function(table) {
    table.increments('id').primary();
    table.integer('backup_job_id').unsigned().references('id').inTable('backup_jobs').onDelete('CASCADE');
    table.timestamp('started_at').defaultTo(knex.fn.now());
    table.timestamp('completed_at');
    table.enum('status', ['running', 'completed', 'failed']).defaultTo('running');
    table.bigInteger('backup_size_bytes');
    table.string('backup_file_path', 500);
    table.text('log_output');
    table.text('error_message');
    table.integer('duration_seconds');
    
    table.index(['backup_job_id']);
    table.index(['status']);
    table.index(['started_at']);
  });

  // SSL certificates
  await knex.schema.createTable('ssl_certificates', function(table) {
    table.increments('id').primary();
    table.integer('domain_id').unsigned().references('id').inTable('domains').onDelete('CASCADE');
    table.string('certificate_authority', 100); // letsencrypt, custom, etc.
    table.text('certificate_pem');
    table.text('private_key_pem');
    table.text('certificate_chain_pem');
    table.timestamp('issued_at');
    table.timestamp('expires_at');
    table.boolean('auto_renew').defaultTo(true);
    table.timestamp('last_renewal_attempt');
    table.enum('status', ['active', 'expired', 'revoked']).defaultTo('active');
    table.timestamps(true, true);
    
    table.index(['domain_id']);
    table.index(['expires_at']);
    table.index(['status']);
    table.index(['auto_renew']);
  });

  // Activity logs
  await knex.schema.createTable('activity_logs', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users');
    table.string('action', 100).notNullable();
    table.string('resource_type', 50); // user, file, service, domain, etc.
    table.string('resource_id', 100);
    table.json('details');
    table.string('ip_address', 45);
    table.string('user_agent', 500);
    table.enum('severity', ['info', 'warning', 'error']).defaultTo('info');
    table.timestamp('performed_at').defaultTo(knex.fn.now());
    
    table.index(['user_id']);
    table.index(['action']);
    table.index(['resource_type']);
    table.index(['performed_at']);
    table.index(['severity']);
  });

  // Notifications
  await knex.schema.createTable('notifications', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users');
    table.string('title', 200).notNullable();
    table.text('message').notNullable();
    table.enum('type', ['info', 'success', 'warning', 'error']).defaultTo('info');
    table.boolean('is_read').defaultTo(false);
    table.json('metadata');
    table.timestamps(true, true);
    
    table.index(['user_id']);
    table.index(['type']);
    table.index(['is_read']);
    table.index(['created_at']);
  });

  // System alerts
  await knex.schema.createTable('system_alerts', function(table) {
    table.increments('id').primary();
    table.string('alert_type', 50).notNullable(); // cpu, memory, disk, service_down, etc.
    table.enum('severity', ['low', 'medium', 'high', 'critical']).notNullable();
    table.string('title', 200).notNullable();
    table.text('description');
    table.json('data'); // metric values, service name, etc.
    table.boolean('is_resolved').defaultTo(false);
    table.timestamp('resolved_at');
    table.timestamp('triggered_at').defaultTo(knex.fn.now());
    
    table.index(['alert_type']);
    table.index(['severity']);
    table.index(['is_resolved']);
    table.index(['triggered_at']);
  });
};

exports.down = async function(knex) {
  // Drop tables in reverse order to handle foreign key constraints
  const tables = [
    'system_alerts',
    'notifications',
    'activity_logs',
    'ssl_certificates',
    'backup_executions',
    'backup_jobs',
    'managed_databases',
    'domains',
    'email_accounts',
    'process_snapshots',
    'service_operations',
    'file_operations',
    'server_configs',
    'system_stats',
    'login_attempts',
    'token_blacklist',
    'api_keys',
    'users'
  ];
  
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
};