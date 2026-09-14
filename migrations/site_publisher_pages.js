/**
 * Tracks what a domain currently has published via the Site Publisher
 * (src/services/sitePublisherService.js, src/routes/sitePublisher.js) — a
 * fixed set of static HTML templates (Coming Soon, Under Construction,
 * Business, Personal, Maintenance) a domain owner can fill in and publish
 * to their document root without needing Terminal/File Manager access.
 *
 * One row per (domain_id, filename): re-publishing the same filename
 * updates the row in place (upsert) rather than growing history — this
 * mirrors what the file on disk actually is (the current published page),
 * not an audit log (that's activity_logs/logger.audit, as with every
 * other write path in this codebase).
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('site_publisher_pages');
  if (!exists) {
    await knex.schema.createTable('site_publisher_pages', function (table) {
      table.increments('id').primary();
      table.integer('domain_id').unsigned().notNullable().references('id').inTable('domains').onDelete('CASCADE');
      table.string('template_key', 50).notNullable();
      table.string('filename', 100).notNullable().defaultTo('index.html');
      table.text('field_values').notNullable(); // JSON — the form values used to render the published page, so re-opening the editor can prefill them
      table.integer('published_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('published_at').notNullable();
      table.timestamps(true, true);
      table.unique(['domain_id', 'filename']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('site_publisher_pages');
};
