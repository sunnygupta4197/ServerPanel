// Real quota enforcement for FTP (and, once mailService.js gives each
// account a real maildir, email) accounts. This codebase has no OS-level
// disk quota to lean on (that needs root + a specific filesystem mount
// option this app can't safely automate), so the practical substitute —
// the same one most panels without kernel quota support use — is: measure
// real usage on a schedule, and if an account is over its quota_mb, stop
// including it in the credentials the FTP/mail daemon actually serves.
// Falling back under quota (deleting files) re-includes it on the next
// tick, with no manual re-activation needed.
const cron = require('node-cron');
const database = require('../config/database');
const logger = require('../config/logger');
const { getDirectorySizeMb } = require('../utils/directorySize');
const ftpService = require('../services/ftpService');
const mailService = require('../services/mailService');

async function checkFtpQuotas() {
  const accounts = await database('ftp_accounts').where('is_active', true);
  let anyChanged = false;

  for (const account of accounts) {
    const usedMb = await getDirectorySizeMb(account.home_dir);
    const overQuota = account.quota_mb > 0 && usedMb > account.quota_mb;

    if (usedMb !== account.used_mb || overQuota !== !!account.over_quota) {
      anyChanged = true;
    }

    await database('ftp_accounts').where('id', account.id).update({
      used_mb: usedMb,
      over_quota: overQuota,
      usage_checked_at: new Date()
    });

    if (overQuota && !account.over_quota) {
      logger.warn(`FTP account ${account.username} is over quota (${usedMb}MB / ${account.quota_mb}MB) — will be excluded from the active FTP credentials on next sync`);
    }
  }

  // Only re-sync vsftpd if an over_quota flag actually flipped — running
  // db_load on every single tick regardless of whether anything changed
  // would be pointless I/O on a host with vsftpd actually configured.
  if (anyChanged) {
    const refreshed = await database('ftp_accounts').select('*');
    await ftpService.syncVsftpdConfig(refreshed).catch(err =>
      logger.warn('Quota enforcer: vsftpd resync after quota check failed:', err.message));
  }
}

// Same real-measurement/real-consequence pattern as checkFtpQuotas, using
// each account's maildir (see mailService.maildirFor) once one has
// actually been assigned — an account created before
// email_accounts_mail_server_integration.js's migration has maildir:
// null, and gets skipped (0 usage) until it's next updated, rather than
// crashing on a missing path.
async function checkEmailQuotas() {
  const accounts = await database('email_accounts').where('is_active', true);
  let anyChanged = false;

  for (const account of accounts) {
    if (!account.maildir) continue;
    const usedMb = await getDirectorySizeMb(account.maildir);
    const overQuota = account.quota_mb > 0 && usedMb > account.quota_mb;

    if (usedMb !== account.used_mb || overQuota !== !!account.over_quota) {
      anyChanged = true;
    }

    await database('email_accounts').where('id', account.id).update({
      used_mb: usedMb,
      over_quota: overQuota,
      usage_checked_at: new Date()
    });

    if (overQuota && !account.over_quota) {
      logger.warn(`Email account ${account.local_part}@${account.domain} is over quota (${usedMb}MB / ${account.quota_mb}MB) — will be excluded from the active mail credentials on next sync`);
    }
  }

  if (anyChanged) {
    const refreshed = await database('email_accounts').select('*');
    await mailService.syncMailConfig(refreshed).catch(err =>
      logger.warn('Quota enforcer: mail config resync after quota check failed:', err.message));
  }
}

function start() {
  // Every 15 minutes — frequent enough that an account going over quota
  // doesn't stay wrongly-active for long, infrequent enough that walking
  // every account's directory tree isn't a constant background cost.
  cron.schedule('*/15 * * * *', async () => {
    try {
      await checkFtpQuotas();
      await checkEmailQuotas();
    } catch (error) {
      logger.error('Quota enforcer tick failed:', error);
    }
  });

  logger.info('Quota enforcer started (checking FTP and email account usage every 15 minutes)');
}

module.exports = { start, checkFtpQuotas, checkEmailQuotas };
