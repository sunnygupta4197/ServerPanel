/**
 * system_alerts and notifications were missing columns the code already
 * tried to write: monitoring.js's POST /alerts / POST /alerts/:id/resolve
 * wrote created_by/resolved_by, and socketHandlers.js's ack_alert/
 * ack_notification handlers wrote acknowledged_by/acknowledged_at and
 * read_at — none of which existed, so every one of those writes silently
 * failed (caught and logged) and the acknowledge/audit-trail features were
 * completely non-functional.
 */
exports.up = async function (knex) {
  const hasCreatedBy = await knex.schema.hasColumn('system_alerts', 'created_by');
  if (!hasCreatedBy) {
    await knex.schema.alterTable('system_alerts', (table) => {
      table.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      table.integer('resolved_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      table.integer('acknowledged_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('acknowledged_at');
    });
  }

  const hasReadAt = await knex.schema.hasColumn('notifications', 'read_at');
  if (!hasReadAt) {
    await knex.schema.alterTable('notifications', (table) => {
      table.timestamp('read_at');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('system_alerts', (table) => {
    table.dropColumn('created_by');
    table.dropColumn('resolved_by');
    table.dropColumn('acknowledged_by');
    table.dropColumn('acknowledged_at');
  });
  await knex.schema.alterTable('notifications', (table) => {
    table.dropColumn('read_at');
  });
};
