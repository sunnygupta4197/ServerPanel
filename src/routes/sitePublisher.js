const express = require('express');
const router = express.Router();
const path = require('path');
const { body, query, validationResult } = require('express-validator');
const { requirePermission } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');
const sitePublisherService = require('../services/sitePublisherService');
const { isPathSafe, isCriticalSystemPath } = require('./files');

// cPanel-style Site Publisher: pick a fixed template, fill in a few
// fields, publish straight to a domain's document root. sites:read covers
// browsing templates, previewing rendered HTML (pure in-memory render, no
// filesystem write — see sitePublisherService.render), and checking what's
// currently published; sites:write is the only path that actually writes
// a file, gated the same way every other domain-content write in this
// codebase is (requirePermission + an explicit ownership check against
// domain.user_id, not just "logged in").

router.get('/templates', requirePermission('sites:read'), (req, res) => {
  res.json({
    success: true,
    data: {
      templates: sitePublisherService.listTemplates(),
      fields: sitePublisherService.fieldsSchema()
    }
  });
});

router.post('/preview',
  requirePermission('sites:read'),
  [
    body('templateKey').isString().isLength({ min: 1, max: 50 }),
    body('fields').isObject()
  ],
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { values, errors: fieldErrors } = sitePublisherService.validateFields(req.body.templateKey, req.body.fields);
      if (fieldErrors.length) return res.status(400).json({ success: false, message: 'Validation failed', errors: fieldErrors });

      const html = sitePublisherService.render(req.body.templateKey, values);
      res.json({ success: true, data: { html } });
    } catch (error) {
      if (error.code === 'UNKNOWN_TEMPLATE') return res.status(400).json({ success: false, message: error.message });
      logger.error('Error rendering site publisher preview:', error);
      res.status(500).json({ success: false, message: 'Failed to render preview' });
    }
  }
);

router.get('/status',
  requirePermission('sites:read'),
  [query('domainId').isInt()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const domain = await database('domains').where('id', req.query.domainId).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const published = await database('site_publisher_pages').where('domain_id', domain.id).first();
      res.json({
        success: true,
        data: published ? { ...published, field_values: JSON.parse(published.field_values || '{}') } : null
      });
    } catch (error) {
      logger.error('Error getting site publisher status:', error);
      res.status(500).json({ success: false, message: 'Failed to get status' });
    }
  }
);

router.post('/publish',
  requirePermission('sites:write'),
  [
    body('domainId').isInt(),
    body('templateKey').isString().isLength({ min: 1, max: 50 }),
    body('fields').isObject(),
    body('filename').optional().isString().isLength({ max: 100 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const domain = await database('domains').where('id', req.body.domainId).first();
      if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
      if (req.user.role !== 'admin' && domain.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      if (!domain.document_root) {
        return res.status(400).json({ success: false, message: 'This domain has no document root configured' });
      }

      const { values, errors: fieldErrors } = sitePublisherService.validateFields(req.body.templateKey, req.body.fields);
      if (fieldErrors.length) return res.status(400).json({ success: false, message: 'Validation failed', errors: fieldErrors });

      const filename = sitePublisherService.sanitizeFilename(req.body.filename);
      if (!filename) {
        return res.status(400).json({ success: false, message: 'Invalid filename — must be a plain name ending in .html' });
      }

      const resolvedRoot = path.resolve(domain.document_root);
      if (!isPathSafe(resolvedRoot) || isCriticalSystemPath(resolvedRoot)) {
        return res.status(403).json({ success: false, message: "This domain's document root is not allowed" });
      }

      const html = sitePublisherService.render(req.body.templateKey, values);
      await sitePublisherService.publishToDocumentRoot(resolvedRoot, filename, html);

      const now = new Date();
      const existing = await database('site_publisher_pages').where({ domain_id: domain.id, filename }).first();
      const row = {
        domain_id: domain.id,
        template_key: req.body.templateKey,
        filename,
        field_values: JSON.stringify(values),
        published_by: req.user.id,
        published_at: now,
        updated_at: now
      };
      if (existing) {
        await database('site_publisher_pages').where('id', existing.id).update(row);
      } else {
        await database('site_publisher_pages').insert({ ...row, created_at: now });
      }

      logger.audit('site_published', req.user, 'site_publisher', {
        domainId: domain.id, domain: domain.domain, templateKey: req.body.templateKey, filename
      });

      res.json({ success: true, message: `Published to ${domain.domain}/${filename}`, data: { html } });
    } catch (error) {
      if (error.code === 'UNKNOWN_TEMPLATE' || error.code === 'UNSAFE_PATH') {
        return res.status(400).json({ success: false, message: error.message });
      }
      logger.error('Error publishing site:', error);
      res.status(500).json({ success: false, message: 'Failed to publish site' });
    }
  }
);

module.exports = router;
