/**
 * Three more "no ON DELETE clause at all" user_id/installed_by FKs found
 * by auditing every FK in the schema after server_configs_fk_fix.js
 * fixed the first one — same root cause (harmless while SQLite FK
 * enforcement was off, a real DELETE /api/users/:id failure once
 * src/config/database.js turned it on), but these three are far more
 * reachable: activity_logs and notifications are written on nearly
 * every request in this app (almost every user has at least one row in
 * each), so left alone this would have made deleting most real users
 * fail outright, not just an edge case like server_configs was.
 *
 * activity_logs.user_id -> SET NULL: this is the audit trail — what
 * happened has value independent of whether the actor's account still
 * exists, same reasoning as system_alerts_metadata's created_by/
 * resolved_by/acknowledged_by. The log entry survives; only "who"
 * clears.
 *
 * notifications.user_id -> CASCADE: unlike an audit log, a notification
 * is a personal inbox item with no independent value once its owner is
 * gone — nobody can read it, nothing points at it. Deleting it instead
 * of leaving an orphaned, ownerless row is the correct cleanup here.
 *
 * installed_applications.installed_by -> SET NULL: same reasoning as
 * activity_logs — "an app was installed, with this config, at this
 * path" stays meaningful and the row (and its installation_logs
 * children, which CASCADE off installed_applications itself, not off
 * users) should survive; only the "who installed it" reference clears.
 *
 * SQLite can't ALTER a column's constraint in place — dropping and
 * re-adding the column is the only way to change it, but a plain drop
 * silently destroys every existing row's value in that column (caught
 * live testing server_configs_fk_fix.js's first version, which had this
 * exact bug). Every affected column's existing values are captured
 * before the drop and restored by id afterward, so upgrading a database
 * that already has real activity_logs/notifications/installed_applications
 * rows doesn't lose who they belonged to.
 */
async function replaceColumnPreservingData(knex, table, column, buildColumn) {
  const hasColumn = await knex.schema.hasColumn(table, column);
  if (!hasColumn) {
    await knex.schema.alterTable(table, (t) => buildColumn(t));
    return;
  }

  const existing = await knex(table).whereNotNull(column).select('id', column);
  await knex.schema.alterTable(table, (t) => t.dropColumn(column));
  await knex.schema.alterTable(table, (t) => buildColumn(t));
  for (const row of existing) {
    await knex(table).where('id', row.id).update({ [column]: row[column] });
  }
}

exports.up = async function (knex) {
  await replaceColumnPreservingData(knex, 'activity_logs', 'user_id', (t) =>
    t.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL'));

  await replaceColumnPreservingData(knex, 'notifications', 'user_id', (t) =>
    t.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE'));

  const hasInstalledApplications = await knex.schema.hasTable('installed_applications');
  if (hasInstalledApplications) {
    await replaceColumnPreservingData(knex, 'installed_applications', 'installed_by', (t) =>
      t.integer('installed_by').unsigned().references('id').inTable('users').onDelete('SET NULL'));
  }
};

exports.down = async function (knex) {
  await knex.schema
    .alterTable('activity_logs', (t) => t.dropColumn('user_id'))
    .alterTable('notifications', (t) => t.dropColumn('user_id'))
    .alterTable('installed_applications', (t) => t.dropColumn('installed_by'));

  await knex.schema
    .alterTable('activity_logs', (t) => t.integer('user_id').unsigned().references('id').inTable('users'))
    .alterTable('notifications', (t) => t.integer('user_id').unsigned().references('id').inTable('users'))
    .alterTable('installed_applications', (t) => t.integer('installed_by').unsigned().references('id').inTable('users'));
};
