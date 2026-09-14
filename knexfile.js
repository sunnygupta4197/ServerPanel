// knexfile.js - Database configuration for Knex migrations
const path = require('path');

// SQLite doesn't enforce foreign keys by default — see the matching fix
// and full reasoning in src/config/database.js, which the app's own
// runtime and the jest suite both actually use (this file's `development`/
// `testing` configs only matter for the standalone `npx knex ...` CLI, a
// manual/dev convenience — but keeping this consistent means a migration
// run by hand behaves identically to one run by the app itself, rather
// than silently differing on whether ON DELETE CASCADE/SET NULL actually
// fire).
function enableSqliteForeignKeys(conn, done) {
  conn.run('PRAGMA foreign_keys = ON', (err) => done(err, conn));
}

module.exports = {
  development: {
    client: process.env.DB_CLIENT || 'sqlite3',
    connection: {
      filename: process.env.DB_FILE || path.join(__dirname, 'data', 'serverpanel.db')
    },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: path.join(__dirname, 'seeds')
    },
    useNullAsDefault: true,
    debug: process.env.DB_DEBUG === 'true',
    pool: {
      min: 2,
      max: 10,
      afterCreate: (process.env.DB_CLIENT || 'sqlite3') === 'sqlite3' ? enableSqliteForeignKeys : undefined
    }
  },

  testing: {
    client: 'sqlite3',
    connection: {
      filename: ':memory:'
    },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: path.join(__dirname, 'seeds')
    },
    useNullAsDefault: true,
    // min:1/max:1 matters here independently of the FK fix — an
    // in-memory sqlite DB only exists for the lifetime of a single
    // connection, so a bigger pool would give migrations and queries
    // each their own, mostly table-less, database (same reasoning
    // src/config/database.js already applies to its own `:memory:` case).
    pool: {
      min: 1,
      max: 1,
      afterCreate: enableSqliteForeignKeys
    }
  },

  production: {
    client: process.env.DB_CLIENT || 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'serverpanel',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'serverpanel',
      charset: 'utf8mb4',
      timezone: 'UTC'
    },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: path.join(__dirname, 'seeds')
    },
    pool: {
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      acquireTimeoutMillis: 30000,
      createTimeoutMillis: 3000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 100
    }
  },

  // PostgreSQL configuration
  postgres: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'serverpanel',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'serverpanel'
    },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: path.join(__dirname, 'seeds')
    },
    pool: {
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 10
    }
  }
};