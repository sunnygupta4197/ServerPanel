const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { requirePermission } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');
const mailService = require('../services/mailService');
const quotaEnforcer = require('../jobs/quotaEnforcer');

function sanitize(account) {
  const { password_hash, mail_crypt_hash, ...safe } = account;
  return safe;
}

async function resyncMail() {
  const accounts = await database('email_accounts').select('*');
  const result = await mailService.syncMailConfig(accounts);
  await Promise.all(accounts.map(a =>
    database('email_accounts').where('id', a.id).update({ activated: !!result.activated })
  ));
  return result;
}

// Forwarders are a separate Postfix mechanism (virtual_alias_maps) from
// mailboxes (virtual_mailbox_maps) — see mailService.syncForwarders — so
// this is a separate resync, not folded into resyncMail() above, even
// though both ultimately touch the same Postfix installation.
async function resyncForwarders() {
  const forwarders = await database('email_forwarders').select('*');
  return mailService.syncForwarders(forwarders);
}

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
    res.json({ success: true, data: accounts.map(sanitize) });
  } catch (err) {
    logger.error('Error listing email accounts:', err);
    res.status(500).json({ success: false, message: 'Failed to list email accounts' });
  }
});

// GET /setup-instructions — the one-time manual Postfix/Dovecot config an
// operator needs to apply for real accounts to actually receive/serve mail.
router.get('/setup-instructions', requirePermission('email:read'), async (req, res) => {
  try {
    const support = await mailService.detectMailServerSupport();
    res.json({ success: true, data: { support, instructions: mailService.getSetupInstructions() } });
  } catch (err) {
    logger.error('Error getting mail setup instructions:', err);
    res.status(500).json({ success: false, message: 'Failed to get setup instructions' });
  }
});

// POST /accounts/check-quotas — on-demand equivalent of quotaEnforcer's
// 15-minute email pass. Admin-only, same reasoning as ftp.js's version.
router.post('/accounts/check-quotas', requirePermission('email:write'), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Access denied' });
  try {
    await quotaEnforcer.checkEmailQuotas();
    res.json({ success: true, message: 'Quota check complete' });
  } catch (err) {
    logger.error('Error running on-demand email quota check:', err);
    res.status(500).json({ success: false, message: 'Failed to check quotas' });
  }
});

router.post('/accounts', requirePermission('email:write'),
  [
    body('local_part')
      .matches(/^[a-zA-Z0-9._%+-]+$/)
      .withMessage('Invalid email local part')
      .isLength({ min: 1, max: 64 }),
    body('domain_id').isInt().withMessage('Domain ID is required'),
    body('password').isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
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

      const password_hash = await mailService.hashPassword(password);
      const mail_crypt_hash = await mailService.computeMailCryptHash(password);

      const [id] = await database('email_accounts').insert({
        user_id: req.user.id,
        domain_id,
        local_part,
        domain: domain.domain,
        password_hash,
        mail_crypt_hash,
        maildir: mailService.maildirFor({ domain: domain.domain, local_part }),
        quota_mb,
        used_mb: 0,
        is_active: true,
        activated: false,
        created_at: new Date(),
        updated_at: new Date()
      });

      const syncResult = await resyncMail();
      const created = await database('email_accounts').where('id', id).first();

      logger.info(`Email account ${address} created by ${req.user.username}${syncResult.activated ? '' : ' (not yet activated on the mail server — see setup instructions)'}`);

      res.status(201).json({
        success: true,
        message: syncResult.activated
          ? 'Email account created and activated on the mail server'
          : `Email account created (not yet activated on the mail server: ${syncResult.reason || 'see setup instructions'})`,
        data: sanitize(created)
      });
    } catch (err) {
      logger.error('Error creating email account:', err);
      res.status(500).json({ success: false, message: 'Failed to create email account' });
    }
  }
);

router.put('/accounts/:id', requirePermission('email:write'),
  [
    param('id').isInt(),
    body('password').optional().isString().isLength({ min: 8 }).withMessage('Password must be a string of at least 8 characters')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const account = await database('email_accounts').where('id', req.params.id).first();
      if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
      if (req.user.role !== 'admin' && account.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      const updates = { updated_at: new Date() };
      if (req.body.password) {
        updates.password_hash = await mailService.hashPassword(req.body.password);
        updates.mail_crypt_hash = await mailService.computeMailCryptHash(req.body.password);
      }
      if (req.body.quota_mb !== undefined) updates.quota_mb = req.body.quota_mb;
      if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;

      await database('email_accounts').where('id', req.params.id).update(updates);
      const syncResult = await resyncMail();
      const updated = await database('email_accounts').where('id', req.params.id).first();

      res.json({
        success: true,
        message: syncResult.activated ? 'Email account updated' : `Email account updated (${syncResult.reason || 'not activated on the mail server'})`,
        data: sanitize(updated)
      });
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
      await resyncMail();
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

      const syncResult = await resyncForwarders();

      logger.info(`Email forwarder ${source} → ${destination} created by ${req.user.username}${syncResult.activated ? '' : ' (not yet activated on the mail server — see setup instructions)'}`);
      res.status(201).json({
        success: true,
        message: syncResult.activated
          ? 'Forwarder created and activated on the mail server'
          : `Forwarder created (not yet activated on the mail server: ${syncResult.reason || 'see setup instructions'})`,
        data: { id, source, destination }
      });
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
      await resyncForwarders();
      logger.info(`Email forwarder ${fwd.source} → ${fwd.destination} deleted by ${req.user.username}`);
      res.json({ success: true, message: 'Forwarder deleted' });
    } catch (err) {
      logger.error('Error deleting forwarder:', err);
      res.status(500).json({ success: false, message: 'Failed to delete forwarder' });
    }
  }
);

module.exports = router;
