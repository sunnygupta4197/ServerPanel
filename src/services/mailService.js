// Real email account management, mirroring ftpService.js's structure and
// reasoning exactly (see that file's top-of-file comment for the fuller
// version of this argument). The email_accounts table is this app's own
// source of truth — CRUD, password hashing, and maildir path assignment
// are fully real and don't depend on anything else being installed.
//
// Actually delivering/serving mail at those addresses needs a real MTA +
// IMAP/POP3 server; the pair this module integrates with is Postfix
// (delivery, via its virtual mailbox mechanism) + Dovecot (IMAP/POP3 +
// authentication, via its passwd-file passdb/userdb driver) — the
// standard combination on most Linux distros, same tier of choice as
// vsftpd was for FTP.
//
// What this module deliberately does NOT touch is Postfix's main.cf or
// Dovecot's *.conf — like vsftpd.conf/PAM for FTP, those need one-time,
// operator-applied directives pointing at the map/passwd files this
// module generates. Editing MTA config programmatically risks silently
// breaking mail delivery for a host in ways much harder to notice than a
// broken FTP login, so that setup stays manual and documented — see
// getSetupInstructions(), surfaced by the Email page whenever activation
// isn't complete yet.
const fs = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const bcrypt = require('bcryptjs');
const config = require('../config/config');
const logger = require('../config/logger');
const { generateCryptHash } = require('../utils/cryptHash');

const execFileAsync = promisify(execFile);

const MAIL_CONFIG_DIR = path.join(config.PATHS.CONFIGS, 'mail');
const VMAILBOX_SOURCE_FILE = path.join(MAIL_CONFIG_DIR, 'postfix_vmailbox');
const VDOMAINS_SOURCE_FILE = path.join(MAIL_CONFIG_DIR, 'postfix_vdomains');
const DOVECOT_PASSWD_FILE = path.join(MAIL_CONFIG_DIR, 'dovecot_users');
// Where real maildirs actually live. Configurable via MAIL_ROOT for a
// deployment that wants mail storage on a different mount than the app's
// own config dir; a sane Linux-standard default otherwise.
const MAIL_ROOT = process.env.MAIL_ROOT || (config.SYSTEM.IS_WINDOWS
  ? path.join(MAIL_CONFIG_DIR, 'vhosts')
  : '/var/mail/vhosts');

let mailSupportCache = null;

async function detectMailServerSupport() {
  if (mailSupportCache !== null) return mailSupportCache;
  if (config.SYSTEM.IS_WINDOWS) {
    mailSupportCache = { available: false, reason: 'Postfix/Dovecot integration is Linux-only' };
    return mailSupportCache;
  }
  try {
    await execFileAsync('which', ['postfix']);
  } catch {
    mailSupportCache = { available: false, reason: 'Postfix is not installed on this host' };
    return mailSupportCache;
  }
  try {
    await execFileAsync('which', ['dovecot']);
  } catch {
    mailSupportCache = { available: false, reason: 'Dovecot is not installed on this host' };
    return mailSupportCache;
  }
  try {
    await execFileAsync('which', ['postmap']);
  } catch {
    mailSupportCache = { available: false, reason: 'postfix is installed but postmap (postfix-utils) was not found' };
    return mailSupportCache;
  }
  mailSupportCache = { available: true };
  return mailSupportCache;
}

async function hashPassword(password) {
  return bcrypt.hash(password, config.BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Mirrors ftpService.computeVsftpdCryptHash — returns null (not a throw)
// when mail server support isn't present, since there's then no point
// spending an openssl invocation on a hash nothing will read.
async function computeMailCryptHash(password) {
  const support = await detectMailServerSupport();
  if (!support.available) return null;
  try {
    return await generateCryptHash(password);
  } catch (error) {
    logger.warn('Mail: could not generate a Dovecot-compatible password hash:', error.message);
    return null;
  }
}

function maildirFor(account) {
  return path.join(MAIL_ROOT, account.domain, account.local_part);
}

// Rewrites the full Postfix virtual maps + Dovecot passwd-file from the
// current DB state, and ensures every active account has a real maildir
// on disk. Called after any create/update/delete/toggle, same trigger
// pattern as ftpService.syncVsftpdConfig.
async function syncMailConfig(accounts) {
  const support = await detectMailServerSupport();
  if (!support.available) {
    return { activated: false, reason: support.reason };
  }

  // over_quota exclusion mirrors ftpService's — see quotaEnforcer.js.
  const activeAccounts = accounts.filter(a => a.is_active && a.mail_crypt_hash && !a.over_quota);
  const skipped = accounts.filter(a => a.is_active && !a.mail_crypt_hash).map(a => `${a.local_part}@${a.domain}`);
  const overQuota = accounts.filter(a => a.is_active && a.over_quota).map(a => `${a.local_part}@${a.domain}`);

  try {
    await fs.mkdir(MAIL_CONFIG_DIR, { recursive: true });
    await fs.mkdir(MAIL_ROOT, { recursive: true });

    // Postfix virtual_mailbox_maps: "user@domain  domain/local_part/"
    const vmailboxLines = activeAccounts.map(a => `${a.local_part}@${a.domain}\t${a.domain}/${a.local_part}/`);
    await fs.writeFile(VMAILBOX_SOURCE_FILE, vmailboxLines.join('\n') + (vmailboxLines.length ? '\n' : ''));
    await execFileAsync('postmap', [VMAILBOX_SOURCE_FILE]);

    // Postfix virtual_mailbox_domains: one domain per line, deduplicated.
    const domains = [...new Set(activeAccounts.map(a => a.domain))];
    await fs.writeFile(VDOMAINS_SOURCE_FILE, domains.map(d => `${d}\tOK`).join('\n') + (domains.length ? '\n' : ''));
    await execFileAsync('postmap', [VDOMAINS_SOURCE_FILE]);

    // Dovecot passwd-file passdb/userdb: "user@domain:{SHA512-CRYPT}hash::::::userdb_mail=maildir:MAILDIR"
    const dovecotLines = activeAccounts.map(a =>
      `${a.local_part}@${a.domain}:{SHA512-CRYPT}${a.mail_crypt_hash}::::::userdb_mail=maildir:${maildirFor(a)}`
    );
    await fs.writeFile(DOVECOT_PASSWD_FILE, dovecotLines.join('\n') + (dovecotLines.length ? '\n' : ''), { mode: 0o600 });

    // Real maildirs — created (not deleted on removal/deactivation, same
    // as FTP home directories: losing mail because an account was toggled
    // off is a much worse failure mode than a little orphaned disk usage).
    for (const account of activeAccounts) {
      await fs.mkdir(maildirFor(account), { recursive: true });
    }

    return { activated: true, skipped, overQuota };
  } catch (error) {
    logger.warn('Mail: Postfix/Dovecot config sync failed, account still saved in the app:', error.message);
    return { activated: false, reason: `mail config sync failed: ${error.message}` };
  }
}

// One-time manual configuration an operator needs to apply to Postfix's
// main.cf and Dovecot's conf.d for the files this module generates to
// actually take effect — intentionally never applied automatically (see
// the top-of-file comment).
function getSetupInstructions() {
  return {
    postfixMainCfLines: [
      `virtual_mailbox_domains = hash:${VDOMAINS_SOURCE_FILE}`,
      `virtual_mailbox_maps = hash:${VMAILBOX_SOURCE_FILE}`,
      `virtual_mailbox_base = ${MAIL_ROOT}`,
      'virtual_uid_maps = static:5000',
      'virtual_gid_maps = static:5000'
    ],
    dovecotConfLines: [
      'passdb {',
      '  driver = passwd-file',
      `  args = ${DOVECOT_PASSWD_FILE}`,
      '}',
      'userdb {',
      '  driver = passwd-file',
      `  args = ${DOVECOT_PASSWD_FILE}`,
      '}',
      `mail_location = maildir:${MAIL_ROOT}/%d/%n`
    ],
    note: 'This is a starting point, not a verified guarantee — the virtual UID/GID, exact Dovecot conf.d file to place this in, and mail_location convention can differ across distro/Postfix/Dovecot versions. Confirm against your system, then test with a real mail client (or `openssl s_client`/`swaks`) after applying it.'
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  computeMailCryptHash,
  detectMailServerSupport,
  syncMailConfig,
  getSetupInstructions,
  maildirFor,
  MAIL_ROOT
};
