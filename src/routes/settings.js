const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { requirePermission } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');
const monitoringService = require('../services/monitoringService');

// Known, editable settings keys. PUT rejects anything not listed here, so an
// authenticated settings:write caller can only ever touch a defined set of
// app config values, not arbitrary rows in server_configs.
const SETTINGS_SCHEMA = {
  'system.name': { type: 'string' },
  'system.domain': { type: 'string' },
  'system.timezone': { type: 'string' },
  'system.language': { type: 'string' },
  'system.theme': { type: 'string' },
  'monitoring.cpu_threshold': { type: 'number', min: 0, max: 100 },
  'monitoring.memory_threshold': { type: 'number', min: 0, max: 100 },
  'monitoring.disk_threshold': { type: 'number', min: 0, max: 100 },
  'monitoring.check_interval': { type: 'number', min: 1000 },
  'security.session_timeout': { type: 'number', min: 60000 },
  'security.max_login_attempts': { type: 'number', min: 1, max: 20 },
  'security.lockout_duration': { type: 'number', min: 0 },
  'logging.retention_days': { type: 'number', min: 1, max: 3650 },
  'backup.enabled': { type: 'boolean' },
  'backup.retention_days': { type: 'number', min: 1, max: 3650 },
  'backup.schedule': { type: 'string' },
  'email.enabled': { type: 'boolean' },
  'ssl.auto_renew': { type: 'boolean' },
  'notifications.email_alerts': { type: 'boolean' },
  'ui.items_per_page': { type: 'number', min: 1, max: 500 },
  'files.max_upload_size': { type: 'number', min: 1 }
};

// Live-update targets: when one of these keys is saved, immediately apply
// it to the already-running process instead of only persisting it (it'll
// still take effect on next boot too, since config reads from the DB).
const MONITORING_THRESHOLD_KEYS = {
  'monitoring.cpu_threshold': 'cpu',
  'monitoring.memory_threshold': 'memory',
  'monitoring.disk_threshold': 'disk'
};

function coerceValue(rawValue, type) {
  switch (type) {
    case 'number':
      return Number(rawValue);
    case 'boolean':
      return rawValue === 'true' || rawValue === true;
    case 'json':
      try { return JSON.parse(rawValue); } catch { return null; }
    default:
      return rawValue;
  }
}

function serializeValue(value, type) {
  return type === 'json' ? JSON.stringify(value) : String(value);
}

// Get all settings
router.get('/', requirePermission('settings:read'), async (req, res) => {
  try {
    const rows = await database('server_configs')
      .select('config_key', 'config_value', 'config_type', 'description', 'is_system');

    const settings = {};
    rows.forEach(row => {
      settings[row.config_key] = {
        value: coerceValue(row.config_value, row.config_type),
        type: row.config_type,
        description: row.description,
        isSystem: !!row.is_system
      };
    });

    res.json({ success: true, data: settings });
  } catch (error) {
    logger.error('Error getting settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve settings'
    });
  }
});

// Update settings (bulk upsert against the known schema)
router.put('/',
  requirePermission('settings:write'),
  [
    body('settings').isObject().withMessage('settings must be an object')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { settings } = req.body;
      const keys = Object.keys(settings);

      if (keys.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No settings provided'
        });
      }

      const unknownKeys = keys.filter(key => !SETTINGS_SCHEMA[key]);
      if (unknownKeys.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Unknown setting key(s): ${unknownKeys.join(', ')}`
        });
      }

      for (const key of keys) {
        const schema = SETTINGS_SCHEMA[key];
        const rawValue = settings[key];

        if (schema.type === 'number') {
          const num = Number(rawValue);
          if (Number.isNaN(num)) {
            return res.status(400).json({ success: false, message: `${key} must be a number` });
          }
          if (schema.min !== undefined && num < schema.min) {
            return res.status(400).json({ success: false, message: `${key} must be >= ${schema.min}` });
          }
          if (schema.max !== undefined && num > schema.max) {
            return res.status(400).json({ success: false, message: `${key} must be <= ${schema.max}` });
          }
        }
      }

      const existingRows = await database('server_configs').whereIn('config_key', keys);
      const existingByKey = new Map(existingRows.map(row => [row.config_key, row]));

      for (const key of keys) {
        const schema = SETTINGS_SCHEMA[key];
        const serialized = serializeValue(settings[key], schema.type);
        const existing = existingByKey.get(key);

        if (existing) {
          await database('server_configs')
            .where('config_key', key)
            .update({
              config_value: serialized,
              updated_by: req.user.id,
              updated_at: new Date()
            });
        } else {
          await database('server_configs').insert({
            config_key: key,
            config_value: serialized,
            config_type: schema.type,
            is_system: false,
            updated_by: req.user.id,
            created_at: new Date(),
            updated_at: new Date()
          });
        }
      }

      // Apply monitoring thresholds to the already-running service immediately
      const newThresholds = {};
      let hasThresholdChange = false;
      for (const [key, shortName] of Object.entries(MONITORING_THRESHOLD_KEYS)) {
        if (Object.prototype.hasOwnProperty.call(settings, key)) {
          newThresholds[shortName] = Number(settings[key]);
          hasThresholdChange = true;
        }
      }
      if (hasThresholdChange) {
        monitoringService.updateThresholds(newThresholds);
      }

      logger.audit('settings_updated', req.user, 'settings', { keys });
      logger.info(`Settings updated by ${req.user.username}: ${keys.join(', ')}`);

      res.json({
        success: true,
        message: 'Settings updated successfully'
      });
    } catch (error) {
      logger.error('Error updating settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update settings'
      });
    }
  }
);

module.exports = router;
