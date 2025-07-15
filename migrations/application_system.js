/**
 * Application Management System Database Schema
 */

exports.up = async function(knex) {
  // Installed applications table
  await knex.schema.createTable('installed_applications', function(table) {
    table.increments('id').primary();
    table.string('app_id', 100).notNullable(); // Application identifier from catalog
    table.string('name', 200).notNullable(); // Application name
    table.string('version', 50); // Installed version
    table.string('install_path', 500).notNullable(); // Installation directory
    table.string('domain', 255); // Associated domain
    table.text('config'); // JSON configuration
    table.enum('status', ['installing', 'installed', 'failed', 'updating', 'uninstalling']).defaultTo('installing');
    table.integer('progress').defaultTo(0); // Installation progress (0-100)
    table.text('error_message'); // Error message if installation failed
    table.integer('installed_by').unsigned().references('id').inTable('users');
    table.timestamp('installed_at').defaultTo(knex.fn.now());
    table.timestamp('completed_at'); // When installation completed
    table.timestamp('last_updated'); // Last update check
    table.timestamps(true, true);
    
    table.index(['app_id']);
    table.index(['status']);
    table.index(['installed_by']);
    table.index(['domain']);
  });

  // Application catalog cache (for offline browsing)
  await knex.schema.createTable('application_catalog', function(table) {
    table.string('app_id', 100).primary();
    table.string('name', 200).notNullable();
    table.text('description');
    table.string('category', 50);
    table.string('version', 50);
    table.json('requirements'); // System requirements
    table.string('download_url', 500);
    table.string('install_script', 200);
    table.string('icon', 200);
    table.json('tags'); // Search tags
    table.string('size', 20); // Download size
    table.string('license', 50);
  });
}