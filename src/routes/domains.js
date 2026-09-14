const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { requirePermission } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');
const phpService = require('../services/phpService');
const dnsService = require('../services/dnsService');
const mailService = require('../services/mailService');
const cronJobRunner = require('../jobs/cronJobRunner');

// Rewrites domain's zone file from its current dns_records and applies it
// (best-effort — see dnsService.syncBindZone). Called after any DNS
// record create/update/delete, mirroring ftp.js's resyncVsftpd() /
// email.js's resyncMail() pattern: the app's own dns_records rows are
// always the source of truth regardless of whether BIND is even
// installed on this host.
async function resyncDns(domainId) {
  const domain = await database('domains').where('id', domainId).first();
  if (!domain) return { activated: false, reason: 'Domain not found' };
  const records = await database('dns_records').where('domain_id', domainId).orderBy(['type', 'name']);
  return dnsService.syncBindZone(domain.domain, records);
}

// List all domains for authenticated user
router.get('/', requirePermission('domains:read'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = database('domains').orderBy('created_at', 'desc');
    if (!isAdmin) query.where('user_id', req.user.id);

    const domains = await query;

    // Attach DNS record count per domain
    const ids = domains.map(d => d.id);
    const counts = ids.length
      ? await database('dns_records').whereIn('domain_id', ids).count('id as count').groupBy('domain_id').select('domain_id')
      : [];

    const countMap = Object.fromEntries(counts.map(r => [r.domain_id, Number(r.count)]));
    const enriched = domains.map(d => ({ ...d, dns_record_count: countMap[d.id] || 0 }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    logger.error('Error listing domains:', err);
    res.status(500).json({ success: false, message: 'Failed to list domains' });
  }
});

// Get single domain
router.get('/:id', requirePermission('domains:read'),
  [param('id').isInt().withMessage('Invalid domain ID')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const domain = await database('domains').where('id', req.params.id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      const dnsRecords = await database('dns_records').where('domain_id', domain.id).orderBy('type');
      res.json({ success: true, data: { ...domain, dns_records: dnsRecords } });
    } catch (err) {
      logger.error('Error getting domain:', err);
      res.status(500).json({ success: false, message: 'Failed to get domain' });
    }
  }
);

// Add domain
router.post('/', requirePermission('domains:write'),
  [
    body('domain')
      .matches(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/)
      .withMessage('Invalid domain name'),
    body('type').isIn(['primary', 'addon', 'subdomain', 'parked']).withMessage('Invalid domain type'),
    body('document_root').optional().isString(),
    body('redirect_to').optional().isURL().withMessage('Invalid redirect URL'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { domain, type, document_root, redirect_to } = req.body;

      const existing = await database('domains').where('domain', domain).first();
      if (existing) return res.status(409).json({ success: false, message: 'Domain already exists' });

      const [id] = await database('domains').insert({
        user_id: req.user.id,
        domain,
        type,
        document_root: document_root || `/var/www/${domain}`,
        redirect_to: redirect_to || null,
        status: 'active',
        created_at: new Date(),
        updated_at: new Date()
      });

      // Create default DNS records
      const defaultRecords = [
        { domain_id: id, type: 'A',   name: domain,        value: '0.0.0.0', ttl: 3600, priority: 0 },
        { domain_id: id, type: 'A',   name: `www.${domain}`, value: '0.0.0.0', ttl: 3600, priority: 0 },
        { domain_id: id, type: 'MX',  name: domain,        value: `mail.${domain}`, ttl: 3600, priority: 10 },
        { domain_id: id, type: 'TXT', name: domain,        value: 'v=spf1 +a +mx ~all', ttl: 3600, priority: 0 },
      ];
      await database('dns_records').insert(defaultRecords.map(r => ({ ...r, created_at: new Date(), updated_at: new Date() })));
      const dnsSync = await resyncDns(id);

      logger.info(`Domain ${domain} added by ${req.user.username}${dnsSync.activated ? '' : ' (DNS zone not yet activated — see setup instructions)'}`);
      const created = await database('domains').where('id', id).first();
      res.status(201).json({ success: true, message: 'Domain added', data: created });
    } catch (err) {
      logger.error('Error adding domain:', err);
      res.status(500).json({ success: false, message: 'Failed to add domain' });
    }
  }
);

// Update domain
router.put('/:id', requirePermission('domains:write'),
  [
    param('id').isInt(),
    body('status').optional().isIn(['active', 'suspended']),
    body('document_root').optional().isString(),
    body('redirect_to').optional(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const domain = await database('domains').where('id', req.params.id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      const { status, document_root, redirect_to } = req.body;
      const updates = { updated_at: new Date() };
      if (status !== undefined) updates.status = status;
      if (document_root !== undefined) updates.document_root = document_root;
      if (redirect_to !== undefined) updates.redirect_to = redirect_to;

      await database('domains').where('id', req.params.id).update(updates);
      const updated = await database('domains').where('id', req.params.id).first();
      res.json({ success: true, message: 'Domain updated', data: updated });
    } catch (err) {
      logger.error('Error updating domain:', err);
      res.status(500).json({ success: false, message: 'Failed to update domain' });
    }
  }
);

// Assign a PHP version to a domain. Persists domains.php_version
// unconditionally (that's always real), and separately attempts a real
// php-fpm pool activation when possible — see phpService.js for exactly
// what "activated" does and doesn't mean here.
router.put('/:id/php-version', requirePermission('php:write'),
  [
    param('id').isInt(),
    body('php_version').isString().matches(/^\d+\.\d+$/).withMessage('Version must look like "8.2"')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const domain = await database('domains').where('id', req.params.id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      const { php_version } = req.body;
      const installation = await database('php_installations').where('version', php_version).first();
      if (!installation) {
        return res.status(400).json({ success: false, message: `PHP ${php_version} is not registered — see GET /api/php/versions` });
      }

      await database('domains').where('id', req.params.id).update({ php_version, updated_at: new Date() });

      const activation = await phpService.activateDomainPhpVersion(
        domain.domain, php_version, domain.document_root || `/var/www/${domain.domain}`
      );

      logger.info(`Domain ${domain.domain} PHP version set to ${php_version} by ${req.user.username}${activation.activated ? '' : ' (not yet activated: ' + activation.reason + ')'}`);

      res.json({
        success: true,
        message: activation.activated ? `PHP ${php_version} assigned and activated` : `PHP ${php_version} assigned (${activation.reason})`,
        data: { domainId: domain.id, php_version, activation }
      });
    } catch (err) {
      logger.error('Error setting domain PHP version:', err);
      res.status(500).json({ success: false, message: 'Failed to set PHP version' });
    }
  }
);

// Delete domain
router.delete('/:id', requirePermission('domains:write'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const domain = await database('domains').where('id', req.params.id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      // dns_records, email_accounts, email_forwarders, and any
      // domain-scoped cron_jobs (see
      // migrations/scheduled_cron_jobs_safe_actions.js) all CASCADE-delete
      // at the DB level when their domain_id's parent row disappears —
      // that's a plain FK cascade inside the database engine, so it runs
      // no application code at all. Left alone, that means a deleted
      // domain's real BIND zone and Postfix/Dovecot mailboxes/forwarders
      // would keep working on the real servers indefinitely (nothing ever
      // told them the accounts/records are gone), and any cron job scoped
      // to this domain would keep firing on schedule forever — its DB row
      // is gone, but cronJobRunner.js's in-memory node-cron task was never
      // told to stop; runJob() would just silently no-op every time it
      // fires (see cronJobRunner.js: `if (!job...) return;`), which
      // doesn't error but leaks a timer for the life of the process.
      // Fetch what needs that explicit cleanup before deleting — the
      // cascade removes the rows that would otherwise tell us what to
      // clean up.
      const domainCronJobs = await database('cron_jobs').where('domain_id', domain.id);

      await database('domains').where('id', req.params.id).delete();

      for (const job of domainCronJobs) {
        cronJobRunner.unregister(job.id);
      }

      await dnsService.removeZone(domain.domain).catch(err =>
        logger.warn(`DNS zone cleanup failed for deleted domain ${domain.domain}:`, err.message));

      const remainingEmailAccounts = await database('email_accounts').select('*');
      await mailService.syncMailConfig(remainingEmailAccounts).catch(err =>
        logger.warn(`Mail config resync failed after deleting domain ${domain.domain}:`, err.message));

      const remainingForwarders = await database('email_forwarders').select('*');
      await mailService.syncForwarders(remainingForwarders).catch(err =>
        logger.warn(`Forwarder resync failed after deleting domain ${domain.domain}:`, err.message));

      logger.info(`Domain ${domain.domain} deleted by ${req.user.username}`);
      res.json({ success: true, message: 'Domain deleted' });
    } catch (err) {
      logger.error('Error deleting domain:', err);
      res.status(500).json({ success: false, message: 'Failed to delete domain' });
    }
  }
);

// --- DNS Records ---

// GET /dns/setup-instructions — the one-time manual named.conf include an
// operator needs to apply for the zones this app generates to actually
// be served by BIND.
router.get('/dns/setup-instructions', requirePermission('domains:read'), async (req, res) => {
  try {
    const support = await dnsService.detectBindSupport();
    res.json({ success: true, data: { support, instructions: dnsService.getSetupInstructions() } });
  } catch (err) {
    logger.error('Error getting DNS setup instructions:', err);
    res.status(500).json({ success: false, message: 'Failed to get setup instructions' });
  }
});

router.get('/:id/dns', requirePermission('domains:read'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const domain = await database('domains').where('id', req.params.id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });
      const records = await database('dns_records').where('domain_id', req.params.id).orderBy(['type', 'name']);
      res.json({ success: true, data: records });
    } catch (err) {
      logger.error('Error listing DNS records:', err);
      res.status(500).json({ success: false, message: 'Failed to list DNS records' });
    }
  }
);

router.post('/:id/dns', requirePermission('domains:write'),
  [
    param('id').isInt(),
    body('type').isIn(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'PTR']),
    body('name').isString().notEmpty(),
    body('value').isString().notEmpty(),
    body('ttl').optional().isInt({ min: 60, max: 86400 }),
    body('priority').optional().isInt({ min: 0, max: 65535 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const domain = await database('domains').where('id', req.params.id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      const { type, name, value, ttl = 3600, priority = 0 } = req.body;
      const [recId] = await database('dns_records').insert({
        domain_id: domain.id, type, name, value, ttl, priority,
        created_at: new Date(), updated_at: new Date()
      });

      const dnsSync = await resyncDns(domain.id);
      const record = await database('dns_records').where('id', recId).first();
      res.status(201).json({
        success: true,
        message: dnsSync.activated ? 'DNS record added and zone reloaded' : `DNS record added (${dnsSync.reason || 'zone not activated'})`,
        data: record
      });
    } catch (err) {
      logger.error('Error adding DNS record:', err);
      res.status(500).json({ success: false, message: 'Failed to add DNS record' });
    }
  }
);

router.put('/:id/dns/:recordId', requirePermission('domains:write'),
  [param('id').isInt(), param('recordId').isInt()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const domain = await database('domains').where('id', req.params.id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      const { value, ttl, priority } = req.body;
      const updates = { updated_at: new Date() };
      if (value !== undefined) updates.value = value;
      if (ttl !== undefined) updates.ttl = ttl;
      if (priority !== undefined) updates.priority = priority;

      await database('dns_records').where({ id: req.params.recordId, domain_id: req.params.id }).update(updates);
      const dnsSync = await resyncDns(domain.id);
      const record = await database('dns_records').where('id', req.params.recordId).first();
      res.json({
        success: true,
        message: dnsSync.activated ? 'DNS record updated and zone reloaded' : `DNS record updated (${dnsSync.reason || 'zone not activated'})`,
        data: record
      });
    } catch (err) {
      logger.error('Error updating DNS record:', err);
      res.status(500).json({ success: false, message: 'Failed to update DNS record' });
    }
  }
);

router.delete('/:id/dns/:recordId', requirePermission('domains:write'),
  [param('id').isInt(), param('recordId').isInt()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const domain = await database('domains').where('id', req.params.id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      await database('dns_records').where({ id: req.params.recordId, domain_id: req.params.id }).delete();
      await resyncDns(domain.id);
      res.json({ success: true, message: 'DNS record deleted' });
    } catch (err) {
      logger.error('Error deleting DNS record:', err);
      res.status(500).json({ success: false, message: 'Failed to delete DNS record' });
    }
  }
);

module.exports = router;
