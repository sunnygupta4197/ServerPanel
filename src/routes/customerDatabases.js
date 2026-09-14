const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { requirePermission } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');
const config = require('../config/config');
const customerDatabaseService = require('../services/customerDatabaseService');

// Real per-customer database provisioning — see
// migrations/customer_databases.js's comment for why this is a separate
// feature from /api/database (the admin-only console over this panel's
// own operational DB). customerdb:read/write are their own permission
// pair specifically so a "user" role reaches this without ever touching
// the internal console — see src/config/permissions.js.

router.get('/', requirePermission('customerdb:read'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = database('customer_databases').orderBy('created_at', 'desc');
    if (!isAdmin) query.where('user_id', req.user.id);
    const rows = await query;
    res.json({ success: true, data: rows, engine: config.DATABASE.client });
  } catch (err) {
    logger.error('Error listing customer databases:', err);
    res.status(500).json({ success: false, message: 'Failed to list databases' });
  }
});

router.post('/',
  requirePermission('customerdb:write'),
  [
    body('dbName').matches(/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/).withMessage('Database name must start with a letter and contain only letters, numbers, and underscores (max 63 characters)'),
    body('domainId').optional().isInt()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      let domainId = null;
      if (req.body.domainId) {
        const domain = await database('domains').where('id', req.body.domainId).first();
        if (!domain) return res.status(404).json({ success: false, message: 'Domain not found' });
        if (req.user.role !== 'admin' && domain.user_id !== req.user.id) {
          return res.status(403).json({ success: false, message: 'Access denied' });
        }
        domainId = domain.id;
      }

      // Real provisioning happens before any DB row is written — unlike
      // FTP/mail/DNS's "always save the app-side record, activation is
      // best-effort", a customer database has no meaningful half-succeeded
      // state: if CREATE DATABASE itself fails (e.g. this app's own DB
      // user lacks the privilege), there is nothing to record as
      // "created", so the caller gets a real error instead of a row that
      // claims success.
      let provisioned;
      try {
        provisioned = await customerDatabaseService.createDatabase({
          dbName: req.body.dbName,
          ownerId: req.user.id
        });
      } catch (provisionError) {
        if (provisionError.code === 'ALREADY_EXISTS') {
          return res.status(409).json({ success: false, message: provisionError.message });
        }
        if (provisionError.code === 'INVALID_IDENTIFIER' || provisionError.code === 'UNSUPPORTED_CLIENT') {
          return res.status(400).json({ success: false, message: provisionError.message });
        }
        logger.error('Error provisioning customer database:', provisionError);
        return res.status(500).json({
          success: false,
          message: `Failed to create database: ${provisionError.message}`
        });
      }

      const [id] = await database('customer_databases').insert({
        user_id: req.user.id,
        domain_id: domainId,
        engine: provisioned.engine,
        db_name: provisioned.dbName,
        db_user: provisioned.dbUser,
        host: provisioned.host,
        port: provisioned.port,
        file_path: provisioned.filePath,
        status: 'active',
        created_at: new Date(),
        updated_at: new Date()
      });

      logger.audit('customer_database_created', req.user, 'customer_databases', {
        id, dbName: provisioned.dbName, engine: provisioned.engine
      });

      const created = await database('customer_databases').where('id', id).first();
      res.status(201).json({
        success: true,
        message: provisioned.password
          ? 'Database created — save this password now, it will not be shown again'
          : 'Database created',
        data: {
          ...created,
          // password is present only for mysql2/pg — sqlite has no such
          // concept — and only ever in this one response.
          password: provisioned.password || undefined
        }
      });
    } catch (err) {
      logger.error('Error creating customer database:', err);
      res.status(500).json({ success: false, message: 'Failed to create database' });
    }
  }
);

router.delete('/:id', requirePermission('customerdb:write'), [param('id').isInt()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const record = await database('customer_databases').where('id', req.params.id).first();
    if (!record) return res.status(404).json({ success: false, message: 'Database not found' });
    if (req.user.role !== 'admin' && record.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    try {
      await customerDatabaseService.dropDatabase(record);
    } catch (dropError) {
      logger.error(`Error dropping customer database ${record.db_name}:`, dropError);
      return res.status(500).json({ success: false, message: `Failed to drop database: ${dropError.message}` });
    }

    await database('customer_databases').where('id', req.params.id).delete();
    logger.audit('customer_database_deleted', req.user, 'customer_databases', { id: record.id, dbName: record.db_name });
    res.json({ success: true, message: 'Database deleted' });
  } catch (err) {
    logger.error('Error deleting customer database:', err);
    res.status(500).json({ success: false, message: 'Failed to delete database' });
  }
});

module.exports = router;
