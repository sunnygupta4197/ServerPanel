const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { requirePermission } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');

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

      logger.info(`Domain ${domain} added by ${req.user.username}`);
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

// Delete domain
router.delete('/:id', requirePermission('domains:write'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const domain = await database('domains').where('id', req.params.id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      await database('domains').where('id', req.params.id).delete();
      logger.info(`Domain ${domain.domain} deleted by ${req.user.username}`);
      res.json({ success: true, message: 'Domain deleted' });
    } catch (err) {
      logger.error('Error deleting domain:', err);
      res.status(500).json({ success: false, message: 'Failed to delete domain' });
    }
  }
);

// --- DNS Records ---

router.get('/:id/dns', requirePermission('domains:read'),
  [param('id').isInt()],
  async (req, res) => {
    try {
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

      const record = await database('dns_records').where('id', recId).first();
      res.status(201).json({ success: true, message: 'DNS record added', data: record });
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
      const record = await database('dns_records').where('id', req.params.recordId).first();
      res.json({ success: true, message: 'DNS record updated', data: record });
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
      const domain = await database('domains').where('id', req.params.id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      await database('dns_records').where({ id: req.params.recordId, domain_id: req.params.id }).delete();
      res.json({ success: true, message: 'DNS record deleted' });
    } catch (err) {
      logger.error('Error deleting DNS record:', err);
      res.status(500).json({ success: false, message: 'Failed to delete DNS record' });
    }
  }
);

module.exports = router;
