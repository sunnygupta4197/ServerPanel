const knex = require('knex');
const config = require('./config');
const logger = require('./logger');

// An in-memory sqlite DB only exists for the lifetime of a single
// connection — a pool of 2-10 connections would each get their own
// independent (and mostly table-less) database. Force a single connection
// so migrations and queries actually share the same in-memory DB.
const isSqliteMemory = config.DATABASE.client === 'sqlite3'
  && config.DATABASE.connection.filename === ':memory:';

// Database configuration based on environment
const dbConfig = {
  client: config.DATABASE.client,
  connection: config.DATABASE.connection,
  migrations: {
    directory: config.DATABASE.migrations.directory,
    tableName: config.DATABASE.migrations.tableName
  },
  seeds: {
    directory: config.DATABASE.seeds.directory
  },
  useNullAsDefault: true,
  pool: isSqliteMemory
    ? { min: 1, max: 1 }
    : {
        min: 2,
        max: 10,
        createTimeoutMillis: 3000,
        acquireTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 100,
        propagateCreateError: false
      },
  debug: process.env.NODE_ENV === 'development' && process.env.DB_DEBUG === 'true'
};

// Create database connection
const database = knex(dbConfig);

// Test database connection
database.raw('SELECT 1')
  .then(() => {
    logger.info('Database connection established successfully');
  })
  .catch((error) => {
    logger.error('Database connection failed:', error);
  });

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Closing database connection...');
  await database.destroy();
  process.exit(0);
});

// Export database instance
module.exports = database;