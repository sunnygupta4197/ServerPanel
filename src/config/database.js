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

// SQLite does NOT enforce foreign keys by default — it has to be turned
// on per-connection with `PRAGMA foreign_keys = ON`, and nothing here
// ever did that. Every migration in this codebase declares real
// onDelete('CASCADE')/onDelete('SET NULL') behavior (dns_records,
// email_accounts, ftp_accounts, customer_databases, ... all reference
// domains/users this way) — on MySQL/Postgres those are enforced by the
// engine itself and always worked; on sqlite3 (this app's own default
// DB_CLIENT) they were silent no-ops the entire time. Deleting a domain
// or user left every "cascaded" row sitting in the database exactly as
// it was, orphaned, pointing at a parent that no longer existed —
// invisible in most list views only because they happen to INNER JOIN
// against the now-missing parent, not because the rows were actually
// gone. `pool.afterCreate` runs this pragma on every new sqlite3
// connection the pool opens, which is the standard, correct way to
// enable it for node-sqlite3 (the pragma is per-connection, not
// persisted in the database file itself).
if (dbConfig.client === 'sqlite3') {
  dbConfig.pool.afterCreate = (conn, done) => {
    conn.run('PRAGMA foreign_keys = ON', (err) => done(err, conn));
  };
}

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