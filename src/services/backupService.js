const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const tar = require('tar');
const config = require('../config/config');
const database = require('../config/database');
const logger = require('../config/logger');

const FILES_ENTRY = 'files';
const DB_SQL_ENTRY = 'database.sql';
const DB_SQLITE_ENTRY = 'database.sqlite';
const EMAILS_ENTRY = 'emails.json';

function getDbInfo() {
  const client = database.client.config.client;
  const conn = database.client.config.connection;
  return { client, conn };
}

async function dumpDatabaseTo(stagingDir) {
  const { client, conn } = getDbInfo();

  if (client === 'sqlite3') {
    await fs.copyFile(conn.filename, path.join(stagingDir, DB_SQLITE_ENTRY));
    return;
  }

  const isPg = client === 'pg';
  const bin = isPg ? 'pg_dump' : 'mysqldump';
  const args = isPg
    ? ['-h', String(conn.host), '-p', String(conn.port), '-U', conn.user, conn.database]
    : ['-h', String(conn.host), '-P', String(conn.port), '-u', conn.user, conn.database];
  const env = { ...process.env, [isPg ? 'PGPASSWORD' : 'MYSQL_PWD']: conn.password };
  const outPath = path.join(stagingDir, DB_SQL_ENTRY);

  await new Promise((resolve, reject) => {
    const out = fsSync.createWriteStream(outPath);
    const child = spawn(bin, args, { env });
    let stderr = '';
    child.stdout.pipe(out);
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      code === 0 ? resolve() : reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

async function dumpEmailsTo(stagingDir) {
  const accounts = await database('email_accounts').select('*');
  const forwarders = await database('email_forwarders').select('*');
  await fs.writeFile(path.join(stagingDir, EMAILS_ENTRY), JSON.stringify({ accounts, forwarders }, null, 2));
}

async function copyFilesTo(stagingDir) {
  const webRoot = config.SYSTEM.WEB_ROOT;
  try {
    await fs.access(webRoot);
  } catch {
    logger.warn(`Backup: web root ${webRoot} does not exist, skipping files`);
    return;
  }
  await fs.cp(webRoot, path.join(stagingDir, FILES_ENTRY), { recursive: true });
}

async function stageBackup(type, stagingDir, onProgress) {
  await fs.mkdir(stagingDir, { recursive: true });
  const includesDb = type === 'full' || type === 'database';
  const includesEmails = type === 'full' || type === 'emails';
  const includesFiles = type === 'full' || type === 'files';

  if (includesDb) {
    onProgress?.(20, 'Dumping database');
    await dumpDatabaseTo(stagingDir);
  }
  if (includesEmails) {
    onProgress?.(40, 'Exporting email accounts and forwarders');
    await dumpEmailsTo(stagingDir);
  }
  if (includesFiles) {
    onProgress?.(55, `Copying site files from ${config.SYSTEM.WEB_ROOT}`);
    await copyFilesTo(stagingDir);
  }
}

// Creates a real .tar.gz backup at config.PATHS.BACKUPS/<name>.tar.gz.
// Builds a staging directory first (so a "full" backup can combine a DB
// dump, an email export, and a copy of the web root under one archive
// with predictable entry names), tars it, then gzips the tar — done as
// two separate steps because appending more tar entries to an
// already-gzip-finalized stream isn't reliable.
async function createBackup({ type, name, onProgress }) {
  const stagingDir = path.join(config.SYSTEM.TEMP_DIR, `spbackup-${crypto.randomBytes(6).toString('hex')}`);
  const rawTarPath = `${stagingDir}.tar`;
  await fs.mkdir(config.PATHS.BACKUPS, { recursive: true });
  const finalPath = path.join(config.PATHS.BACKUPS, `${name}.tar.gz`);

  try {
    onProgress?.(5, 'Preparing backup');
    await stageBackup(type, stagingDir, onProgress);

    const entries = await fs.readdir(stagingDir);
    if (entries.length === 0) {
      throw new Error('Nothing to back up — no matching data found for this backup type');
    }

    onProgress?.(75, 'Archiving');
    await tar.create({ file: rawTarPath, cwd: stagingDir }, entries);

    onProgress?.(90, 'Compressing archive');
    await pipeline(
      fsSync.createReadStream(rawTarPath),
      zlib.createGzip({ level: 9 }),
      fsSync.createWriteStream(finalPath)
    );

    const stats = await fs.stat(finalPath);
    return { path: finalPath, size: stats.size };
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(rawTarPath, { force: true }).catch(() => {});
  }
}

// Restores a live sqlite connection from another sqlite file without ever
// closing the shared knex pool (every route holds a reference to that same
// object) — ATTACHes the backup file and copies table-by-table inside a
// single transaction so the whole sequence stays pinned to one connection.
async function restoreSqliteFrom(sourcePath) {
  const alias = `restore_${Date.now()}`;
  await database.transaction(async (trx) => {
    await trx.raw(`ATTACH DATABASE ? AS ${alias}`, [sourcePath]);
    try {
      const tables = await trx.raw(
        `SELECT name FROM ${alias}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'`
      );
      for (const { name } of tables) {
        await trx.raw(`DELETE FROM "${name}"`);
        await trx.raw(`INSERT INTO "${name}" SELECT * FROM ${alias}."${name}"`);
      }
    } finally {
      await trx.raw(`DETACH DATABASE ${alias}`).catch(() => {});
    }
  });
}

async function restoreSqlDumpFrom(dumpPath) {
  const { client, conn } = getDbInfo();
  if (client !== 'mysql' && client !== 'mysql2' && client !== 'pg') {
    throw new Error(`Cannot restore a SQL dump into a ${client} database`);
  }

  const isPg = client === 'pg';
  const bin = isPg ? 'psql' : 'mysql';
  const args = isPg
    ? ['-h', String(conn.host), '-p', String(conn.port), '-U', conn.user, conn.database]
    : ['-h', String(conn.host), '-P', String(conn.port), '-u', conn.user, conn.database];
  const env = { ...process.env, [isPg ? 'PGPASSWORD' : 'MYSQL_PWD']: conn.password };

  await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      code === 0 ? resolve() : reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
    fsSync.createReadStream(dumpPath).pipe(child.stdin);
  });
}

async function restoreEmailsFrom(jsonPath) {
  const { accounts = [], forwarders = [] } = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  await database.transaction(async (trx) => {
    await trx('email_forwarders').del();
    await trx('email_accounts').del();
    if (accounts.length) await trx('email_accounts').insert(accounts);
    if (forwarders.length) await trx('email_forwarders').insert(forwarders);
  });
}

async function restoreBackup({ archivePath, onProgress }) {
  const extractDir = `${archivePath}.restore-${crypto.randomBytes(6).toString('hex')}`;
  const rawTarPath = `${extractDir}.tar`;

  try {
    onProgress?.(10, 'Decompressing archive');
    await pipeline(
      fsSync.createReadStream(archivePath),
      zlib.createGunzip(),
      fsSync.createWriteStream(rawTarPath)
    );

    onProgress?.(30, 'Extracting archive');
    await fs.mkdir(extractDir, { recursive: true });
    await tar.extract({ file: rawTarPath, cwd: extractDir });

    const entries = await fs.readdir(extractDir);

    if (entries.includes(DB_SQLITE_ENTRY)) {
      onProgress?.(50, 'Restoring SQLite database');
      await restoreSqliteFrom(path.join(extractDir, DB_SQLITE_ENTRY));
    } else if (entries.includes(DB_SQL_ENTRY)) {
      onProgress?.(50, 'Restoring database');
      await restoreSqlDumpFrom(path.join(extractDir, DB_SQL_ENTRY));
    }

    if (entries.includes(EMAILS_ENTRY)) {
      onProgress?.(70, 'Restoring email accounts and forwarders');
      await restoreEmailsFrom(path.join(extractDir, EMAILS_ENTRY));
    }

    if (entries.includes(FILES_ENTRY)) {
      // Layers the backed-up files on top of what's there now (existing
      // files are overwritten, but files created since the backup that
      // aren't in it are left in place, not deleted).
      onProgress?.(85, 'Restoring site files');
      await fs.mkdir(config.SYSTEM.WEB_ROOT, { recursive: true });
      await fs.cp(path.join(extractDir, FILES_ENTRY), config.SYSTEM.WEB_ROOT, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(rawTarPath, { force: true }).catch(() => {});
  }
}

function computeNextRun(frequency) {
  const d = new Date();
  if (frequency === 'daily') d.setDate(d.getDate() + 1);
  else if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  d.setHours(2, 0, 0, 0);
  return d;
}

module.exports = { createBackup, restoreBackup, computeNextRun };
