/**
 * Real Postfix + Dovecot activation for email_accounts, mirroring
 * ftp_accounts' vsftpd_crypt_hash/activated columns (see
 * migrations/ftp_accounts.js and src/services/ftpService.js) — before
 * this, email_accounts was pure bookkeeping with no path to an actual
 * mailbox. See src/services/mailService.js.
 *
 * mail_crypt_hash: SHA-512-crypt (same `openssl passwd -6` format as FTP),
 * which Dovecot's passdb accepts directly as {SHA512-CRYPT} — computed
 * once at password-set time, durably stored, since Dovecot needs a
 * re-loadable credential to rebuild its passwd-file on every account
 * change, not the plaintext this app only ever sees transiently.
 *
 * maildir: the real per-account mail storage path this app creates and
 * points Postfix/Dovecot at (<mail root>/<domain>/<local_part>/) — also
 * what quotaEnforcer.js measures real usage against, once wired up.
 *
 * activated: true once real Postfix/Dovecot config sync succeeded for
 * this account, same meaning as ftp_accounts.activated.
 */
exports.up = async function (knex) {
  const hasCryptHash = await knex.schema.hasColumn('email_accounts', 'mail_crypt_hash');
  if (!hasCryptHash) {
    await knex.schema.alterTable('email_accounts', function (table) {
      table.string('mail_crypt_hash', 255);
      table.string('maildir', 500);
      table.boolean('activated').notNullable().defaultTo(false);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('email_accounts', function (table) {
    table.dropColumn('mail_crypt_hash');
    table.dropColumn('maildir');
    table.dropColumn('activated');
  });
};
