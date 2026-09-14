/**
 * Admin-only scheduled shell commands. Same trust model as
 * src/routes/terminal.js — a cron job is just a command that runs later —
 * so command/schedule are only ever set by an admin (enforced at the route
 * layer via requireRole('admin'), not a permission string).
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('cron_jobs');
  if (exists) return;

  await knex.schema.createTable('cron_jobs', function (table) {
    table.increments('id').primary();
    table.integer('created_by').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('name', 200).notNullable();
    table.string('schedule', 100).notNullable(); // standard cron expression
    table.text('command').notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('last_run_at');
    table.integer('last_exit_code');
    table.text('last_output'); // truncated stdout+stderr from the most recent run
    table.timestamps(true, true);

    table.index(['is_active']);
    table.index(['created_by']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('cron_jobs');
};
