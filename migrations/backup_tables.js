exports.up = async function(knex) {
  if (!await knex.schema.hasTable('backups')) {
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
  }

  if (!await knex.schema.hasTable('backup_schedules')) {
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
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('backup_schedules');
  await knex.schema.dropTableIfExists('backups');
};
