exports.up = async function(knex) {
  if (!await knex.schema.hasTable('dns_records')) {
    await knex.schema.createTable('dns_records', function(table) {
      table.increments('id').primary();
      table.integer('domain_id').unsigned().references('id').inTable('domains').onDelete('CASCADE');
      table.enum('type', ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'PTR']).notNullable();
      table.string('name', 255).notNullable();
      table.text('value').notNullable();
      table.integer('ttl').defaultTo(3600);
      table.integer('priority').defaultTo(0);
      table.timestamps(true, true);
      table.index(['domain_id']);
      table.index(['type']);
    });
  }

  if (!await knex.schema.hasTable('email_forwarders')) {
    await knex.schema.createTable('email_forwarders', function(table) {
      table.increments('id').primary();
      table.integer('domain_id').unsigned().references('id').inTable('domains').onDelete('CASCADE');
      table.string('source', 320).notNullable();
      table.string('destination', 320).notNullable();
      table.boolean('is_active').defaultTo(true);
      table.timestamps(true, true);
      table.index(['domain_id']);
      table.index(['source']);
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('email_forwarders');
  await knex.schema.dropTableIfExists('dns_records');
};
