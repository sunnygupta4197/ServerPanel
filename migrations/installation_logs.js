/**
 * installation_logs was referenced by src/routes/applications.js
 * (logInstallation(), GET /install/:installationId/status) but never had a
 * migration - every call to logInstallation() threw "no such table",
 * which made every application install fail immediately regardless of
 * anything else being correct.
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('installation_logs');
  if (exists) return;

  await knex.schema.createTable('installation_logs', function (table) {
    table.increments('id').primary();
    table.integer('installation_id').unsigned().notNullable()
      .references('id').inTable('installed_applications').onDelete('CASCADE');
    table.string('level', 20).notNullable().defaultTo('info');
    table.text('message').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['installation_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('installation_logs');
};
