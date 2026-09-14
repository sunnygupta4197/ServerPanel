// Real auto-renewal for Let's Encrypt certificates. Until this file
// existed, ssl_certificates.auto_renew was a boolean nobody ever read
// again after issuance — set it to true and the certificate would still
// silently expire, identically to auto_renew: false. This is what
// actually makes that column do something: a daily tick re-issues any
// active, ACME-sourced certificate within RENEW_WITHIN_DAYS of expiring,
// using the exact same acmeService.issueCertificate() path POST
// /ssl/issue already uses, so a renewal is byte-for-byte the same kind of
// issuance as the original — same HTTP-01 validation, same requirement
// that the domain still resolves to this server.
//
// Manually uploaded certificates (source: 'manual') are never touched
// here — there is no ACME account behind them to renew against, and
// auto_renew on one of those was always meaningless.
const cron = require('node-cron');
const crypto = require('crypto');
const database = require('../config/database');
const logger = require('../config/logger');
const acmeService = require('../services/acmeService');

const RENEW_WITHIN_DAYS = 30;

async function renewCertificate(cert) {
  const domain = cert.domain_id ? await database('domains').where('id', cert.domain_id).first() : null;
  const owner = domain ? await database('users').where('id', domain.user_id).first() : null;

  if (!owner?.email) {
    logger.warn(`SSL auto-renew: skipping ${cert.domain} (cert #${cert.id}) — no domain owner/email on record to use for the ACME account`);
    await database('ssl_certificates').where('id', cert.id).update({
      error_message: 'Auto-renew skipped: no domain owner email on record',
      updated_at: new Date()
    });
    return;
  }

  try {
    const { certificate, privateKey } = await acmeService.issueCertificate({
      domain: cert.domain,
      email: owner.email
    });

    const x509 = new crypto.X509Certificate(certificate);
    const issued = new Date(x509.validFrom);
    const expires = new Date(x509.validTo);

    await database('ssl_certificates').where('id', cert.id).update({
      status: 'active',
      certificate,
      private_key: privateKey,
      issued_at: issued,
      expires_at: expires,
      last_renewed_at: issued,
      error_message: null,
      updated_at: new Date()
    });

    logger.info(`SSL auto-renewed ${cert.domain} (cert #${cert.id}), now expires ${expires.toISOString()}`);
  } catch (error) {
    // A failed renewal leaves the existing (still-active, just-not-renewed)
    // certificate and private key untouched — only error_message records
    // the attempt, so a domain that's temporarily unreachable doesn't lose
    // its current working certificate over one bad renewal tick.
    await database('ssl_certificates').where('id', cert.id).update({
      error_message: `Auto-renew failed: ${error.message}`,
      updated_at: new Date()
    });
    logger.error(`SSL auto-renew failed for ${cert.domain} (cert #${cert.id}):`, error);
  }
}

async function runTick() {
  const cutoff = new Date(Date.now() + RENEW_WITHIN_DAYS * 24 * 60 * 60 * 1000);
  const due = await database('ssl_certificates')
    .where('status', 'active')
    .where('source', 'letsencrypt')
    .where('auto_renew', true)
    .where('expires_at', '<=', cutoff);

  for (const cert of due) {
    await renewCertificate(cert);
  }
}

// Guards against a second, un-trackable, un-stoppable cron.schedule()
// task if start() is ever called twice in the same process (e.g. tests
// that construct more than one ServerPanelApp instance) — see
// backupScheduler.js's identical guard for the fuller reasoning.
let started = false;

function start() {
  if (started) return;
  started = true;

  // Once a day is plenty for a 30-day renewal window — Let's Encrypt's own
  // client recommendation is "check twice a day", but this panel issues
  // one domain per certificate with no shared rate-limit pressure across
  // instances, so a daily tick is a reasonable, conservative default.
  cron.schedule('0 3 * * *', async () => {
    try {
      await runTick();
    } catch (error) {
      logger.error('SSL renewal scheduler tick failed:', error);
    }
  });

  logger.info('SSL renewal scheduler started (checking daily for certificates due within 30 days)');
}

module.exports = { start, runTick, renewCertificate };
