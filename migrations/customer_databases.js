/**
 * Real per-customer database provisioning — what cPanel actually means by
 * "MySQL Databases": a hosting customer creates a brand-new database (+,
 * for a real DB server, a scoped DB user/grant) for their own web app to
 * connect to. This is NOT the same thing as /api/database (see
 * src/config/permissions.js's comment on the 'database' permission
 * family) — that route is an admin-only console introspecting this
 * panel's OWN operational database; a "user" role has never had access
 * to it, and rightly so, because it was never meant to be this feature.
 *
 * No password is ever stored here (see customerDatabaseService.js): for
 * mysql2/pg, the DB server itself is the authority on the password, and
 * this app has no reason to durably hold a copy of a credential it will
 * never need to present again after the one time it hands it back to the
 * customer at creation.
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('customer_databases');
  if (exists) return;

  await knex.schema.createTable('customer_databases', function (table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('domain_id').unsigned().references('id').inTable('domains').onDelete('SET NULL');
    table.string('engine', 20).notNullable(); // 'sqlite3' | 'mysql2' | 'pg' — whatever this panel's own DB_CLIENT is
    table.string('db_name', 100).notNullable();
    table.string('db_user', 100); // null for sqlite3 (file-based, no server-side user concept)
    table.string('host', 255);
    table.integer('port');
    table.string('file_path', 500); // sqlite3 only
    table.enum('status', ['active', 'failed']).notNullable().defaultTo('active');
    table.text('error_message');
    table.timestamps(true, true);

    table.unique(['engine', 'db_name']);
    table.index(['user_id']);
    table.index(['domain_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('customer_databases');
};
