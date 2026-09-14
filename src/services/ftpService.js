// Real FTP account management. The ftp_accounts table is this app's own
// source of truth for "which accounts exist, what can they access" —
// account CRUD, password hashing, and home-directory scoping are fully
// real and don't depend on anything else being installed (matching, and
// going slightly further than, how email accounts already work in this
// codebase).
//
// Actually serving those accounts over the FTP protocol needs a real FTP
// daemon; the only one this module attempts to integrate with is vsftpd
// (the standard choice on most Linux distros), using its virtual-user
// mechanism: a PAM-checked Berkeley DB of username/hashed-password pairs,
// plus a per-user config file (user_config_dir) that pins each virtual
// user's local_root. Both of those are safe for this app to generate and
// rewrite on every account change.
//
// What this module deliberately does NOT touch is vsftpd.conf or PAM
// config (/etc/pam.d/*) — vsftpd has to be told, once, by the operator,
// to actually use virtual users and to point pam_userdb at the db file
// this module writes, with crypt=sha512 (matching the hash format
// generated below). Editing PAM config programmatically is exactly the
// kind of mistake that can lock a host out of authentication entirely, so
// that one-time setup stays manual and documented — see the exported
// getSetupInstructions(), surfaced by the FTP page whenever activation
// isn't complete yet.
const fs = require('fs').promises;
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const bcrypt = require('bcryptjs');
const config = require('../config/config');
const logger = require('../config/logger');

const execFileAsync = promisify(execFile);

const FTP_CONFIG_DIR = path.join(config.PATHS.CONFIGS, 'ftp');
const USER_CONF_DIR = path.join(FTP_CONFIG_DIR, 'vsftpd_user_conf');
const CREDENTIALS_SOURCE_FILE = path.join(FTP_CONFIG_DIR, 'vsftpd_virtual_users.txt');
const CREDENTIALS_DB_FILE = path.join(FTP_CONFIG_DIR, 'vsftpd_virtual_users.db');
const PAM_SERVICE_NAME = 'vsftpd_virtual';

let vsftpdAvailabilityCache = null;

async function detectVsftpdSupport() {
  if (vsftpdAvailabilityCache !== null) return vsftpdAvailabilityCache;
  if (config.SYSTEM.IS_WINDOWS) {
    vsftpdAvailabilityCache = { available: false, reason: 'vsftpd integration is Linux-only' };
    return vsftpdAvailabilityCache;
  }
  try {
    await execFileAsync('which', ['vsftpd']);
  } catch {
    vsftpdAvailabilityCache = { available: false, reason: 'vsftpd is not installed on this host' };
    return vsftpdAvailabilityCache;
  }
  // The db_load utility's name varies by distro/Berkeley DB version
  // (db_load, db5.3_load, db4.8_load, ...) — try the plain name first,
  // which is what most distros symlink to whichever version they ship.
  for (const bin of ['db_load', 'db5.3_load', 'db4.8_load']) {
    try {
      await execFileAsync('which', [bin]);
      vsftpdAvailabilityCache = { available: true, dbLoadBin: bin };
      return vsftpdAvailabilityCache;
    } catch { /* try next */ }
  }
  vsftpdAvailabilityCache = { available: false, reason: 'vsftpd is installed but db_load (db-util) was not found' };
  return vsftpdAvailabilityCache;
}

// Two independent hashes are stored per account, for two independent
// purposes: bcrypt for this app's own record-keeping (matches every other
// password in the codebase), and a SHA-512-crypt hash (glibc crypt(3)
// format) for real vsftpd/PAM activation, since pam_userdb needs a
// durable, re-loadable credential to rebuild its Berkeley DB on every
// account change — not the plaintext, which this app only ever sees
// transiently at set-time and never persists.
async function hashPassword(password) {
  return bcrypt.hash(password, config.BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateCryptHash(password) {
  return new Promise((resolve, reject) => {
    const child = spawn('openssl', ['passwd', '-6', '-stdin']);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`openssl exited ${code}: ${stderr.slice(0, 300)}`));
    });
    child.stdin.write(password);
    child.stdin.end();
  });
}

// Computes the vsftpd_crypt_hash to store alongside the account's bcrypt
// hash. Returns null (not a throw) when vsftpd support isn't present at
// all, since there's then no point spending an openssl invocation on a
// hash nothing will ever read.
async function computeVsftpdCryptHash(password) {
  const support = await detectVsftpdSupport();
  if (!support.available) return null;
  try {
    return await generateCryptHash(password);
  } catch (error) {
    logger.warn('FTP: could not generate a vsftpd-compatible password hash:', error.message);
    return null;
  }
}

// Rewrites the full credentials db + every active account's user_conf
// file from the current DB state. Called after any create/update/delete/
// toggle so vsftpd (if actually configured to use these files) always
// reflects the current account list. Uses each account's already-stored
// vsftpd_crypt_hash — never needs the plaintext again after set-time, so
// an unrelated account's password change doesn't require re-touching
// every other account's credential.
async function syncVsftpdConfig(accounts) {
  const support = await detectVsftpdSupport();
  if (!support.available) {
    return { activated: false, reason: support.reason };
  }

  const activeAccounts = accounts.filter(a => a.is_active && a.vsftpd_crypt_hash);
  const skipped = accounts.filter(a => a.is_active && !a.vsftpd_crypt_hash).map(a => a.username);

  try {
    await fs.mkdir(USER_CONF_DIR, { recursive: true });

    // vsftpd's db_load expects alternating username/value lines.
    const lines = [];
    for (const account of activeAccounts) {
      lines.push(account.username, account.vsftpd_crypt_hash);
    }
    await fs.writeFile(CREDENTIALS_SOURCE_FILE, lines.join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 });

    await execFileAsync(support.dbLoadBin, [
      '-T', '-t', 'hash', '-f', CREDENTIALS_SOURCE_FILE, CREDENTIALS_DB_FILE
    ]);
    await fs.chmod(CREDENTIALS_DB_FILE, 0o600).catch(() => {});

    // One user_conf file per active account, pinning its chroot/home.
    const existingConfFiles = await fs.readdir(USER_CONF_DIR).catch(() => []);
    const activeUsernames = new Set(activeAccounts.map(a => a.username));
    for (const file of existingConfFiles) {
      if (!activeUsernames.has(file)) await fs.unlink(path.join(USER_CONF_DIR, file)).catch(() => {});
    }
    for (const account of activeAccounts) {
      const confLines = [
        `local_root=${account.home_dir}`,
        'write_enable=YES',
        'chroot_local_user=YES'
      ];
      await fs.writeFile(path.join(USER_CONF_DIR, account.username), confLines.join('\n') + '\n');
    }

    return { activated: true, skipped };
  } catch (error) {
    logger.warn('FTP: vsftpd config sync failed, account still saved in the app:', error.message);
    return { activated: false, reason: `vsftpd config sync failed: ${error.message}` };
  } finally {
    // The credentials source file only needs to exist for the moment
    // db_load reads it — don't leave it sitting on disk any longer.
    await fs.unlink(CREDENTIALS_SOURCE_FILE).catch(() => {});
  }
}

// One-time manual configuration an operator needs to apply to vsftpd.conf
// and PAM for the files this module generates to actually take effect —
// intentionally never applied automatically (see the top-of-file comment).
function getSetupInstructions() {
  return {
    vsftpdConfLines: [
      'guest_enable=YES',
      'virtual_use_local_privs=YES',
      `user_config_dir=${USER_CONF_DIR}`,
      `pam_service_name=${PAM_SERVICE_NAME}`
    ],
    pamServiceFile: `/etc/pam.d/${PAM_SERVICE_NAME}`,
    pamServiceFileContents: [
      `auth required pam_userdb.so db=${CREDENTIALS_DB_FILE.replace(/\.db$/, '')} crypt=sha512`,
      `account required pam_userdb.so db=${CREDENTIALS_DB_FILE.replace(/\.db$/, '')} crypt=sha512`
    ],
    // pam_userdb's `db=` path convention (with vs. without the .db suffix)
    // and its exact crypt-comparison behavior can differ across
    // distro/Berkeley DB/PAM versions in ways this app has no way to
    // detect or verify from here — this is a best-effort starting point
    // for the operator's one-time setup, not a guarantee it works
    // unmodified on every system. Test with a real FTP client after
    // applying it.
    note: 'This is a starting point, not a verified guarantee — confirm the db= path convention and crypt mode match your system\'s PAM/Berkeley DB version, then test with a real FTP client.'
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  computeVsftpdCryptHash,
  detectVsftpdSupport,
  syncVsftpdConfig,
  getSetupInstructions,
  FTP_CONFIG_DIR
};
