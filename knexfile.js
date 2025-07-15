// knexfile.js - Database configuration for Knex migrations
const path = require('path');

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
      max: 10
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
    useNullAsDefault: true
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