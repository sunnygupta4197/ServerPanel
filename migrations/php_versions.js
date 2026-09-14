/**
 * PHP version registry + per-domain assignment. php_installations holds
 * what's actually available on this host — auto-populated by scanning
 * for versioned PHP binaries on Linux (see src/services/phpService.js;
 * there's no reliable equivalent auto-detection on Windows, where install
 * layouts vary too much, so entries there are admin-registered manually
 * through the same table). domains.php_version is a plain string label
 * match against php_installations.version, not a strict foreign key,
 * since a domain can be assigned a version before that version is
 * (re)detected on the host — the UI is expected to only offer versions
 * that currently exist in php_installations, but the column itself
 * doesn't hard-enforce that.
 */
exports.up = async function (knex) {
  const hasInstallations = await knex.schema.hasTable('php_installations');
  if (!hasInstallations) {
    await knex.schema.createTable('php_installations', function (table) {
      table.increments('id').primary();
      table.string('version', 20).notNullable().unique(); // e.g. "8.2"
      table.string('binary_path', 500).notNullable();
      table.string('fpm_socket', 500); // Linux php-fpm unix socket, if applicable
      table.boolean('is_detected').notNullable().defaultTo(false); // auto-discovered vs manually registered
      table.timestamps(true, true);
    });
  }

  const hasPhpVersionColumn = await knex.schema.hasColumn('domains', 'php_version');
  if (!hasPhpVersionColumn) {
    await knex.schema.alterTable('domains', function (table) {
      table.string('php_version', 20);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('domains', function (table) {
    table.dropColumn('php_version');
  });
  await knex.schema.dropTableIfExists('php_installations');
};
