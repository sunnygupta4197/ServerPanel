/**
 * server_configs.updated_by referenced users with no ON DELETE behavior
 * specified at all — harmless as long as SQLite foreign key enforcement
 * was off (see src/config/database.js), which it always was until this
 * same batch of fixes turned it on. Once real enforcement is on, "no
 * ON DELETE clause" means SQLite's default (NO ACTION, checked
 * immediately) — which made DELETE /api/users/:id start throwing a real
 * foreign key constraint error for any user who had ever saved a setting
 * via PUT /api/settings, a regression caught live-testing that same fix.
 *
 * This is a pure audit/log reference (who last changed a setting), not
 * an ownership relationship — the same reasoning system_alerts_metadata.js
 * and site_publisher_pages.js already apply to their own created_by/
 * resolved_by/published_by columns. SET NULL keeps the setting and its
 * value; only the "who" reference is cleared for a deleted user.
 *
 * SQLite can't ALTER a column's constraint in place — dropping and
 * re-adding the column is the only way to change it, but a plain drop
 * silently destroys every existing row's value in that column, which a
 * first pass at this migration did (caught live: inserted a real
 * updated_by value, ran the migration, the value was gone). Captured
 * here before the drop and restored by id afterward, so upgrading a
 * database that already has real server_configs rows doesn't lose which
 * user last touched each one.
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('server_configs', 'updated_by');
  if (hasColumn) {
    const existing = await knex('server_configs').whereNotNull('updated_by').select('id', 'updated_by');
    await knex.schema.alterTable('server_configs', function (table) {
      table.dropColumn('updated_by');
    });
    await knex.schema.alterTable('server_configs', function (table) {
      table.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    });
    for (const row of existing) {
      await knex('server_configs').where('id', row.id).update({ updated_by: row.updated_by });
    }
  } else {
    await knex.schema.alterTable('server_configs', function (table) {
      table.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('server_configs', function (table) {
    table.dropColumn('updated_by');
  });
  await knex.schema.alterTable('server_configs', function (table) {
    table.integer('updated_by').unsigned().references('id').inTable('users');
  });
};
