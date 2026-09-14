/**
 * FTP account records. This table is the application's own source of
 * truth for "which FTP accounts exist and what should they be able to
 * access" — real activation against an actual FTP daemon (vsftpd, the
 * only one this app attempts to integrate with) is best-effort, matching
 * the pattern applications.js's generateVhostConfig() already uses for
 * nginx/Apache: write real config where the daemon and its expected
 * convention are detected, never hard-fail the account record if they
 * aren't. See src/services/ftpService.js.
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('ftp_accounts');
  if (exists) return;

  await knex.schema.createTable('ftp_accounts', function (table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('domain_id').unsigned().references('id').inTable('domains').onDelete('SET NULL');
    table.string('username', 100).notNullable().unique();
    table.string('password_hash', 255).notNullable(); // app-side bcrypt hash, this app's own auth
    // Separate SHA-512-crypt hash (glibc crypt(3) format, via `openssl
    // passwd -6`) for real vsftpd/PAM virtual-user activation — bcrypt
    // isn't a format PAM's pam_userdb module can verify against, and
    // pam_userdb needs a durably stored, re-loadable hash to rebuild its
    // Berkeley DB on every account change, not just the plaintext this
    // app only ever sees transiently at set-time. See ftpService.js.
    table.string('vsftpd_crypt_hash', 255);
    table.string('home_dir', 500).notNullable();
    table.integer('quota_mb').defaultTo(1024);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.boolean('activated').notNullable().defaultTo(false); // true once real vsftpd integration succeeded
    table.timestamps(true, true);

    table.index(['user_id']);
    table.index(['domain_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('ftp_accounts');
};
