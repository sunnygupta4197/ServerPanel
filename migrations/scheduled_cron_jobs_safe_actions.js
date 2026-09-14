/**
 * Extends cron_jobs to support a restricted, non-admin path: a "user"
 * account (via the cron:safe permission) can schedule one of a small,
 * fixed set of vetted read-only actions (see
 * src/services/safeCommandService.js) instead of an admin's free-text
 * shell command. command_type distinguishes the two so
 * cronJobRunner.js's runner only ever treats a row as shell-executable
 * text when it was actually created through the admin-only, free-text
 * path — a "user"-created row can never be reinterpreted as arbitrary
 * shell text, even in principle.
 */
exports.up = async function (knex) {
  const hasCommandType = await knex.schema.hasColumn('cron_jobs', 'command_type');
  if (!hasCommandType) {
    await knex.schema.alterTable('cron_jobs', function (table) {
      // Existing rows (all created through the admin-only free-text route
      // before this migration) default to 'shell', which is exactly what
      // they are.
      table.string('command_type', 20).notNullable().defaultTo('shell'); // 'shell' | 'safe_action'
      table.integer('domain_id').unsigned().references('id').inTable('domains').onDelete('CASCADE'); // only used by domain-scoped safe actions
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('cron_jobs', function (table) {
    table.dropColumn('command_type');
    table.dropColumn('domain_id');
  });
};
