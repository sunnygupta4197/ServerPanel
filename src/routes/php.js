const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { requirePermission, requireRole } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');
const phpService = require('../services/phpService');

// List registered/detected PHP versions — a "user" needs to see this to
// pick a version for their own domain (php:read is granted to all roles).
router.get('/versions', requirePermission('php:read'), async (req, res) => {
  try {
    const versions = await database('php_installations').orderBy('version', 'asc');
    res.json({ success: true, data: versions });
  } catch (err) {
    logger.error('Error listing PHP versions:', err);
    res.status(500).json({ success: false, message: 'Failed to list PHP versions' });
  }
});

// Re-scans the host for installed PHP binaries (Linux only — see
// phpService.js) and upserts the results. Admin-only: this is host-level
// system inventory, not a per-domain customer setting.
router.post('/versions/detect', requireRole('admin'), async (req, res) => {
  try {
    const detected = await phpService.refreshDetectedVersions();
    res.json({ success: true, message: `Detected ${detected.length} PHP installation(s)`, data: detected });
  } catch (err) {
    logger.error('Error detecting PHP versions:', err);
    res.status(500).json({ success: false, message: 'Failed to detect PHP versions' });
  }
});

// Manually register a PHP installation — the only path on Windows, where
// there's no reliable standard layout to auto-detect. Admin-only: pointing
// the app at an arbitrary binary path is server-admin territory.
router.post('/versions',
  requireRole('admin'),
  [
    body('version').isString().matches(/^\d+\.\d+$/).withMessage('Version must look like "8.2"'),
    body('binary_path').isString().isLength({ min: 1, max: 500 }),
    body('fpm_socket').optional().isString().isLength({ max: 500 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { version, binary_path, fpm_socket } = req.body;
      const existing = await database('php_installations').where('version', version).first();
      if (existing) return res.status(409).json({ success: false, message: `PHP ${version} is already registered` });

      const [id] = await database('php_installations').insert({
        version, binary_path, fpm_socket: fpm_socket || null,
        is_detected: false,
        created_at: new Date(), updated_at: new Date()
      });

      const created = await database('php_installations').where('id', id).first();
      logger.info(`PHP ${version} manually registered by ${req.user.username}`);
      res.status(201).json({ success: true, message: 'PHP version registered', data: created });
    } catch (err) {
      logger.error('Error registering PHP version:', err);
      res.status(500).json({ success: false, message: 'Failed to register PHP version' });
    }
  }
);

router.delete('/versions/:id', requireRole('admin'), [param('id').isInt()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const installation = await database('php_installations').where('id', req.params.id).first();
    if (!installation) return res.status(404).json({ success: false, message: 'PHP version not found' });

    const inUse = await database('domains').where('php_version', installation.version).first();
    if (inUse) {
      return res.status(409).json({ success: false, message: `PHP ${installation.version} is still assigned to domain "${inUse.domain}" — reassign it first` });
    }

    await database('php_installations').where('id', req.params.id).del();
    res.json({ success: true, message: 'PHP version removed' });
  } catch (err) {
    logger.error('Error removing PHP version:', err);
    res.status(500).json({ success: false, message: 'Failed to remove PHP version' });
  }
});

module.exports = router;
