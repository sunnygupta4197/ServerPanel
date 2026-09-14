/**
 * ftp_accounts.quota_mb and email_accounts.quota_mb have existed since
 * those tables were created but nothing ever measured real usage against
 * either — see src/jobs/quotaEnforcer.js, which is what actually reads/
 * writes these columns. used_mb is a real, periodically-recomputed
 * directory size (bytes on disk walked and summed — home_dir for FTP,
 * the account's maildir for email — not an estimate); over_quota is what
 * ftpService.syncVsftpdConfig() / mailService's config sync now check
 * before including an account in the active credentials db, so exceeding
 * quota has a real consequence (the account stops being able to log in)
 * rather than just changing a number nobody enforces.
 *
 * email_accounts already had used_mb (added, like quota_mb, back when the
 * table was created) but — like quota_mb — nothing ever wrote to it
 * either; it only starts meaning something once mailService.js gives each
 * account a real maildir to measure.
 */
exports.up = async function (knex) {
  const hasFtpUsage = await knex.schema.hasColumn('ftp_accounts', 'used_mb');
  if (!hasFtpUsage) {
    await knex.schema.alterTable('ftp_accounts', function (table) {
      table.integer('used_mb').defaultTo(0);
      table.boolean('over_quota').notNullable().defaultTo(false);
      table.timestamp('usage_checked_at');
    });
  }

  const hasEmailOverQuota = await knex.schema.hasColumn('email_accounts', 'over_quota');
  if (!hasEmailOverQuota) {
    await knex.schema.alterTable('email_accounts', function (table) {
      table.boolean('over_quota').notNullable().defaultTo(false);
      table.timestamp('usage_checked_at');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('ftp_accounts', function (table) {
    table.dropColumn('used_mb');
    table.dropColumn('over_quota');
    table.dropColumn('usage_checked_at');
  });
  await knex.schema.alterTable('email_accounts', function (table) {
    table.dropColumn('over_quota');
    table.dropColumn('usage_checked_at');
  });
};
