// Real per-customer database provisioning — see
// migrations/customer_databases.js for why this is a different feature
// from src/routes/database.js (the admin-only console over this panel's
// own operational DB). This module branches on this panel's own
// config.DATABASE.client, since that's the only database server this app
// necessarily has any credentials for at all:
//
//  - sqlite3 (this dev environment, and any single-file deployment):
//    "a new database" is a real, standalone .sqlite file this app
//    creates directly — no separate server, no separate user/password
//    concept, so there is nothing to fake here at all.
//  - mysql2 / pg: uses this app's own already-configured DB connection to
//    run real CREATE DATABASE / CREATE USER / GRANT statements. This only
//    succeeds if that connection's own user has the privilege to do so —
//    a real, common constraint (many hosts intentionally run their panel
//    under a low-privilege DB user), reported honestly as a real failure
//    rather than papered over with a fake success.
//
// Every identifier (database/user name) is validated against a strict
// allowlist regex AND passed through knex.raw's `??` identifier binding
// (which quotes it per-driver — backticks for MySQL, double-quotes for
// Postgres) rather than string-concatenated — belt and suspenders against
// the one thing that's structurally impossible to parameterize as a
// plain value in DDL.
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const knexLib = require('knex');
const database = require('../config/database');
const config = require('../config/config');
const logger = require('../config/logger');

const IDENTIFIER_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;

const CUSTOMER_DB_ROOT = process.env.CUSTOMER_DB_ROOT
  || path.join(config.PATHS.CONFIGS, '..', 'customer-databases');

function validateIdentifier(name, label) {
  if (!IDENTIFIER_RE.test(name)) {
    throw Object.assign(
      new Error(`${label} must start with a letter and contain only letters, numbers, and underscores (max 63 characters)`),
      { code: 'INVALID_IDENTIFIER' }
    );
  }
}

function generatePassword() {
  // 24 random bytes, base64url — no ambiguous/shell-special characters,
  // long enough to be a real credential, never persisted after this
  // function's caller hands it back to the customer once.
  return crypto.randomBytes(24).toString('base64url');
}

async function provisionSqlite(dbName, ownerId) {
  const ownerDir = path.join(CUSTOMER_DB_ROOT, String(ownerId));
  await fsPromises.mkdir(ownerDir, { recursive: true });
  const filePath = path.join(ownerDir, `${dbName}.sqlite`);

  if (fs.existsSync(filePath)) {
    throw Object.assign(new Error(`Database "${dbName}" already exists`), { code: 'ALREADY_EXISTS' });
  }

  // Opening a knex/sqlite3 connection against a non-existent path and
  // running a real statement is what actually creates a valid SQLite
  // file on disk (a 0-byte file is not a valid database) — a short-lived
  // connection just for that, then closed immediately. The customer's own
  // app connects to this file directly; this panel never needs to hold it
  // open.
  const tempConn = knexLib({ client: 'sqlite3', connection: { filename: filePath }, useNullAsDefault: true });
  try {
    await tempConn.raw('PRAGMA user_version = 1');
  } finally {
    await tempConn.destroy();
  }

  return { filePath, host: null, port: null, dbUser: null };
}

// MySQL DDL auto-commits statement-by-statement (no transaction can wrap
// it); Postgres CAN run CREATE DATABASE/USER/GRANT in one transaction,
// but CREATE DATABASE specifically can't run inside a multi-statement
// transaction block on Postgres either — so neither engine gives this a
// real all-or-nothing primitive to lean on. If CREATE DATABASE succeeds
// but a later statement (CREATE USER, GRANT, FLUSH PRIVILEGES) fails —
// wrong password character, a leftover user from a previous failed
// attempt, a privilege gap that only bites on the second statement — the
// database would otherwise be left behind on the real server with no
// customer_databases row pointing at it and no password ever issued to
// anyone. best-effort cleanup here, then rethrow the original error, so
// a caller sees the real failure reason and the server is left as close
// to its pre-attempt state as this app can manage without a real
// transaction to rely on.
async function provisionServerDatabase(dbName, dbUser, password) {
  const client = config.DATABASE.client;
  const isMysql = client === 'mysql2' || client === 'mysql';

  if (!isMysql && client !== 'pg') {
    throw Object.assign(new Error(`Unsupported database client: ${client}`), { code: 'UNSUPPORTED_CLIENT' });
  }

  let databaseCreated = false;
  try {
    if (isMysql) {
      // MySQL's CREATE USER/GRANT ... TO syntax quotes the 'user'@'host'
      // pair as string literals, NOT backtick-quoted identifiers — using
      // knex's `??` (identifier) binding here instead of `?` (value)
      // would emit invalid SQL (backtick-quoted `%`), so dbUser/host are
      // bound as regular values while dbName (a genuine identifier
      // position) stays `??`.
      await database.raw('CREATE DATABASE ??', [dbName]);
      databaseCreated = true;
      await database.raw('CREATE USER ?@? IDENTIFIED BY ?', [dbUser, '%', password]);
      await database.raw('GRANT ALL PRIVILEGES ON ??.* TO ?@?', [dbName, dbUser, '%']);
      await database.raw('FLUSH PRIVILEGES');
    } else {
      await database.raw('CREATE DATABASE ??', [dbName]);
      databaseCreated = true;
      await database.raw('CREATE USER ?? WITH PASSWORD ?', [dbUser, password]);
      await database.raw('GRANT ALL PRIVILEGES ON DATABASE ?? TO ??', [dbName, dbUser]);
    }
  } catch (error) {
    if (databaseCreated) {
      await database.raw('DROP DATABASE IF EXISTS ??', [dbName]).catch(cleanupError =>
        logger.error(`Customer DB: provisioning failed AND cleanup of orphaned database "${dbName}" also failed — it may still exist on the server with no app-side record:`, cleanupError.message));
      if (isMysql) {
        await database.raw('DROP USER IF EXISTS ?@?', [dbUser, '%']).catch(() => {});
      } else {
        await database.raw('DROP USER IF EXISTS ??', [dbUser]).catch(() => {});
      }
    }
    throw error;
  }

  return {
    host: config.DATABASE.connection.host,
    port: config.DATABASE.connection.port,
    dbUser
  };
}

// Returns { engine, dbName, dbUser, password, host, port, filePath }.
// `password` is present only for mysql2/pg (sqlite has no such concept)
// and is the ONLY time it's ever available — the caller must hand it to
// the customer in this same response and never expects to retrieve it
// again, same as ftpService's plaintext-at-set-time-only handling.
async function createDatabase({ dbName, dbUserOverride, ownerId }) {
  validateIdentifier(dbName, 'Database name');
  const client = config.DATABASE.client;

  if (client === 'sqlite3') {
    const result = await provisionSqlite(dbName, ownerId);
    return { engine: client, dbName, dbUser: null, password: null, host: null, port: null, filePath: result.filePath };
  }

  const dbUser = dbUserOverride || `u_${dbName}`.slice(0, 32);
  validateIdentifier(dbUser, 'Database user');
  const password = generatePassword();

  const result = await provisionServerDatabase(dbName, dbUser, password);
  return { engine: client, dbName, dbUser, password, host: result.host, port: result.port, filePath: null };
}

async function dropDatabase(record) {
  if (record.engine === 'sqlite3') {
    if (record.file_path) await fsPromises.unlink(record.file_path).catch(err =>
      logger.warn(`Customer DB: could not remove sqlite file ${record.file_path}:`, err.message));
    return;
  }

  const isMysql = record.engine === 'mysql2' || record.engine === 'mysql';
  if (isMysql) {
    await database.raw('DROP DATABASE IF EXISTS ??', [record.db_name]);
    if (record.db_user) await database.raw('DROP USER IF EXISTS ?@?', [record.db_user, '%']).catch(() => {});
  } else if (record.engine === 'pg') {
    await database.raw('DROP DATABASE IF EXISTS ??', [record.db_name]);
    if (record.db_user) await database.raw('DROP USER IF EXISTS ??', [record.db_user]).catch(() => {});
  }
}

module.exports = { createDatabase, dropDatabase, validateIdentifier, CUSTOMER_DB_ROOT };
