const path = require('path');
const knex = require('knex');

function createDatabaseClient(config) {
  if (config.databaseClient !== 'sqlite3') {
    throw new Error(`Unsupported control-plane database client: ${config.databaseClient}`);
  }

  const filename = config.databaseFilename === ':memory:'
    ? ':memory:'
    : path.isAbsolute(config.databaseFilename)
      ? config.databaseFilename
      : path.join(process.cwd(), config.databaseFilename);

  return knex({
    client: 'sqlite3',
    connection: {
      filename
    },
    useNullAsDefault: true
  });
}

module.exports = {
  createDatabaseClient
};
