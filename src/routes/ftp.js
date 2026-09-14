const express = require('express');
const router = express.Router();
const path = require('path');
const { body, param, validationResult } = require('express-validator');
const { requirePermission } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');
const config = require('../config/config');
const ftpService = require('../services/ftpService');
const quotaEnforcer = require('../jobs/quotaEnforcer');
const { isPathSafe, isCriticalSystemPath } = require('./files');

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,99}$/;

function isHomeDirSafe(resolvedPath) {
  return isPathSafe(resolvedPath) && !isCriticalSystemPath(resolvedPath);
}

async function resyncVsftpd() {
  const accounts = await database('ftp_accounts').select('*');
  const result = await ftpService.syncVsftpdConfig(accounts);
  await Promise.all(accounts.map(a =>
    database('ftp_accounts').where('id', a.id).update({ activated: !!result.activated })
  ));
  return result;
}

function sanitize(account) {
  const { password_hash, vsftpd_crypt_hash, ...safe } = account;
  return safe;
}

// GET /accounts
router.get('/accounts', requirePermission('ftp:read'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = database('ftp_accounts')
      .leftJoin('domains', 'domains.id', 'ftp_accounts.domain_id')
      .select('ftp_accounts.*', 'domains.domain as domain_name')
      .orderBy('ftp_accounts.created_at', 'desc');
    if (!isAdmin) query.where('ftp_accounts.user_id', req.user.id);

    const accounts = await query;
    res.json({ success: true, data: accounts.map(sanitize) });
  } catch (err) {
    logger.error('Error listing FTP accounts:', err);
    res.status(500).json({ success: false, message: 'Failed to list FTP accounts' });
  }
});

// GET /setup-instructions — the one-time manual vsftpd/PAM config an
// operator needs to apply for real accounts to actually work over FTP.
router.get('/setup-instructions', requirePermission('ftp:read'), async (req, res) => {
  try {
    const support = await ftpService.detectVsftpdSupport();
    res.json({ success: true, data: { support, instructions: ftpService.getSetupInstructions() } });
  } catch (err) {
    logger.error('Error getting FTP setup instructions:', err);
    res.status(500).json({ success: false, message: 'Failed to get setup instructions' });
  }
});

// POST /accounts/check-quotas — runs the same real usage check
// quotaEnforcer.js does on its 15-minute schedule, on demand. Admin-only
// since it walks every account's directory tree (a real, potentially
// non-trivial I/O cost) rather than being scoped to one caller's own
// accounts.
router.post('/accounts/check-quotas', requirePermission('ftp:write'), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Access denied' });
  try {
    await quotaEnforcer.checkFtpQuotas();
    res.json({ success: true, message: 'Quota check complete' });
  } catch (err) {
    logger.error('Error running on-demand quota check:', err);
    res.status(500).json({ success: false, message: 'Failed to check quotas' });
  }
});

// POST /accounts
router.post('/accounts',
  requirePermission('ftp:write'),
  [
    body('username').matches(USERNAME_RE).withMessage('Username must be 3-100 characters: letters, numbers, dots, hyphens, underscores'),
    body('password').isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('domain_id').optional().isInt(),
    body('home_dir').optional().isString().isLength({ max: 500 }),
    body('quota_mb').optional().isInt({ min: 0 }).withMessage('Quota must be a non-negative integer')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { username, password, domain_id, quota_mb = 1024 } = req.body;

      const existing = await database('ftp_accounts').where('username', username).first();
      if (existing) return res.status(409).json({ success: false, message: `FTP account ${username} already exists` });

      let domain = null;
      if (domain_id) {
        domain = await database('domains').where('id', domain_id).first();
        if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
        if (req.user.role !== 'admin' && domain.user_id !== req.user.id) {
          return res.status(403).json({ success: false, message: 'Access denied' });
        }
      }

      const requestedHomeDir = req.body.home_dir
        || (domain ? domain.document_root : path.join(config.SYSTEM.WEB_ROOT || '/var/www', username));
      const resolvedHomeDir = path.resolve(requestedHomeDir);

      if (!isHomeDirSafe(resolvedHomeDir)) {
        return res.status(403).json({ success: false, message: 'Home directory is not allowed' });
      }

      const password_hash = await ftpService.hashPassword(password);
      const vsftpd_crypt_hash = await ftpService.computeVsftpdCryptHash(password);

      const [id] = await database('ftp_accounts').insert({
        user_id: req.user.id,
        domain_id: domain_id || null,
        username,
        password_hash,
        vsftpd_crypt_hash,
        home_dir: resolvedHomeDir,
        quota_mb,
        is_active: true,
        activated: false,
        created_at: new Date(),
        updated_at: new Date()
      });

      const syncResult = await resyncVsftpd();
      const created = await database('ftp_accounts').where('id', id).first();

      logger.info(`FTP account ${username} created by ${req.user.username}${syncResult.activated ? '' : ' (not yet activated on the FTP server — see setup instructions)'}`);

      res.status(201).json({
        success: true,
        message: syncResult.activated
          ? 'FTP account created and activated on the FTP server'
          : `FTP account created (not yet activated on the FTP server: ${syncResult.reason || 'see setup instructions'})`,
        data: sanitize(created)
      });
    } catch (err) {
      logger.error('Error creating FTP account:', err);
      res.status(500).json({ success: false, message: 'Failed to create FTP account' });
    }
  }
);

// PUT /accounts/:id
router.put('/accounts/:id',
  requirePermission('ftp:write'),
  [
    param('id').isInt(),
    body('password').optional().isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('quota_mb').optional().isInt({ min: 0 }),
    body('is_active').optional().isBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const account = await database('ftp_accounts').where('id', req.params.id).first();
      if (!account) return res.status(404).json({ success: false, message: 'FTP account not found' });
      if (req.user.role !== 'admin' && account.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const updates = { updated_at: new Date() };
      if (req.body.password) {
        updates.password_hash = await ftpService.hashPassword(req.body.password);
        updates.vsftpd_crypt_hash = await ftpService.computeVsftpdCryptHash(req.body.password);
      }
      if (req.body.quota_mb !== undefined) updates.quota_mb = req.body.quota_mb;
      if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;

      await database('ftp_accounts').where('id', req.params.id).update(updates);
      const syncResult = await resyncVsftpd();
      const updated = await database('ftp_accounts').where('id', req.params.id).first();

      res.json({
        success: true,
        message: syncResult.activated ? 'FTP account updated' : `FTP account updated (${syncResult.reason || 'not activated on the FTP server'})`,
        data: sanitize(updated)
      });
    } catch (err) {
      logger.error('Error updating FTP account:', err);
      res.status(500).json({ success: false, message: 'Failed to update FTP account' });
    }
  }
);

// DELETE /accounts/:id
router.delete('/accounts/:id', requirePermission('ftp:write'), [param('id').isInt()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const account = await database('ftp_accounts').where('id', req.params.id).first();
    if (!account) return res.status(404).json({ success: false, message: 'FTP account not found' });
    if (req.user.role !== 'admin' && account.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await database('ftp_accounts').where('id', req.params.id).delete();
    await resyncVsftpd();

    logger.info(`FTP account ${account.username} deleted by ${req.user.username}`);
    res.json({ success: true, message: 'FTP account deleted' });
  } catch (err) {
    logger.error('Error deleting FTP account:', err);
    res.status(500).json({ success: false, message: 'Failed to delete FTP account' });
  }
});

module.exports = router;
