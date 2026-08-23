const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const { requirePermission } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');

// --- Email Accounts ---

router.get('/accounts', requirePermission('email:read'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = database('email_accounts')
      .join('domains', 'email_accounts.domain_id', 'domains.id')
      .select(
        'email_accounts.*',
        'domains.domain as domain_name'
      )
      .orderBy('email_accounts.created_at', 'desc');

    if (!isAdmin) query.where('email_accounts.user_id', req.user.id);

    const accounts = await query;
    const safe = accounts.map(({ password_hash, ...rest }) => rest);
    res.json({ success: true, data: safe });
  } catch (err) {
    logger.error('Error listing email accounts:', err);
    res.status(500).json({ success: false, message: 'Failed to list email accounts' });
  }
});

router.post('/accounts', requirePermission('email:write'),
  [
    body('local_part')
      .matches(/^[a-zA-Z0-9._%+-]+$/)
      .withMessage('Invalid email local part')
      .isLength({ min: 1, max: 64 }),
    body('domain_id').isInt().withMessage('Domain ID is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('quota_mb').optional().isInt({ min: 0 }).withMessage('Quota must be a non-negative integer'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { local_part, domain_id, password, quota_mb = 1024 } = req.body;

      const domain = await database('domains').where('id', domain_id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      const address = `${local_part}@${domain.domain}`;
      const existing = await database('email_accounts').where({ local_part, domain_id }).first();
      if (existing) return res.status(409).json({ success: false, message: `Email ${address} already exists` });

      const password_hash = await bcrypt.hash(password, 10);

      const [id] = await database('email_accounts').insert({
        user_id: req.user.id,
        domain_id,
        local_part,
        domain: domain.domain,
        password_hash,
        quota_mb,
        used_mb: 0,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      });

      logger.info(`Email account ${address} created by ${req.user.username}`);
      res.status(201).json({ success: true, message: 'Email account created', data: { id, address, quota_mb } });
    } catch (err) {
      logger.error('Error creating email account:', err);
      res.status(500).json({ success: false, message: 'Failed to create email account' });
    }
  }
);

router.put('/accounts/:id', requirePermission('email:write'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const account = await database('email_accounts').where('id', req.params.id).first();
      if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
      if (req.user.role !== 'admin' && account.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      const updates = { updated_at: new Date() };
      if (req.body.password) updates.password_hash = await bcrypt.hash(req.body.password, 10);
      if (req.body.quota_mb !== undefined) updates.quota_mb = req.body.quota_mb;
      if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;

      await database('email_accounts').where('id', req.params.id).update(updates);
      res.json({ success: true, message: 'Email account updated' });
    } catch (err) {
      logger.error('Error updating email account:', err);
      res.status(500).json({ success: false, message: 'Failed to update email account' });
    }
  }
);

router.delete('/accounts/:id', requirePermission('email:write'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const account = await database('email_accounts').where('id', req.params.id).first();
      if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
      if (req.user.role !== 'admin' && account.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      await database('email_accounts').where('id', req.params.id).delete();
      logger.info(`Email account ${account.local_part}@${account.domain} deleted by ${req.user.username}`);
      res.json({ success: true, message: 'Email account deleted' });
    } catch (err) {
      logger.error('Error deleting email account:', err);
      res.status(500).json({ success: false, message: 'Failed to delete email account' });
    }
  }
);

// --- Email Forwarders ---

router.get('/forwarders', requirePermission('email:read'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = database('email_forwarders')
      .join('domains', 'email_forwarders.domain_id', 'domains.id')
      .select('email_forwarders.*', 'domains.domain as domain_name')
      .orderBy('email_forwarders.created_at', 'desc');

    if (!isAdmin) query.where('domains.user_id', req.user.id);

    const forwarders = await query;
    res.json({ success: true, data: forwarders });
  } catch (err) {
    logger.error('Error listing forwarders:', err);
    res.status(500).json({ success: false, message: 'Failed to list forwarders' });
  }
});

router.post('/forwarders', requirePermission('email:write'),
  [
    body('source').isEmail().withMessage('Invalid source email address'),
    body('destination').isEmail().withMessage('Invalid destination email address'),
    body('domain_id').isInt().withMessage('Domain ID is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { source, destination, domain_id } = req.body;

      const domain = await database('domains').where('id', domain_id).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      const existing = await database('email_forwarders').where({ source, destination }).first();
      if (existing) return res.status(409).json({ success: false, message: 'Forwarder already exists' });

      const [id] = await database('email_forwarders').insert({
        domain_id,
        source,
        destination,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      });

      logger.info(`Email forwarder ${source} → ${destination} created by ${req.user.username}`);
      res.status(201).json({ success: true, message: 'Forwarder created', data: { id, source, destination } });
    } catch (err) {
      logger.error('Error creating forwarder:', err);
      res.status(500).json({ success: false, message: 'Failed to create forwarder' });
    }
  }
);

router.delete('/forwarders/:id', requirePermission('email:write'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const fwd = await database('email_forwarders').where('id', req.params.id).first();
      if (!fwd) return res.status(404).json({ success: false, message: 'Forwarder not found' });

      if (req.user.role !== 'admin') {
        const domain = await database('domains').where('id', fwd.domain_id).first();
        if (!domain || domain.user_id !== req.user.id)
          return res.status(403).json({ success: false, message: 'Access denied' });
      }

      await database('email_forwarders').where('id', req.params.id).delete();
      logger.info(`Email forwarder ${fwd.source} → ${fwd.destination} deleted by ${req.user.username}`);
      res.json({ success: true, message: 'Forwarder deleted' });
    } catch (err) {
      logger.error('Error deleting forwarder:', err);
      res.status(500).json({ success: false, message: 'Failed to delete forwarder' });
    }
  }
);

module.exports = router;
