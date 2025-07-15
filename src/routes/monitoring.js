const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/authMiddleware');
const { body, query, validationResult } = require('express-validator');
const logger = require('../config/logger');
const database = require('../config/database');
const monitoringService = require('../services/monitoringService');

// Get real-time monitoring data
router.get('/stats', requirePermission('monitoring:read'), async (req, res) => {
  try {
    const stats = await monitoringService.collectSystemMetrics();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting monitoring stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve monitoring data'
    });
  }
});

// Get historical data
router.get('/history', 
  requirePermission('monitoring:read'),
  [
    query('startDate').isISO8601().withMessage('Start date must be valid ISO date'),
    query('endDate').isISO8601().withMessage('End date must be valid ISO date'),
    query('aggregation').optional().isIn(['raw', 'minute', 'hour', 'day']).withMessage('Invalid aggregation type')
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

      const { startDate, endDate, aggregation = 'hour' } = req.query;
      
      const data = await monitoringService.getHistoricalMetrics(
        new Date(startDate),
        new Date(endDate),
        aggregation
      );

      res.json({
        success: true,
        data: {
          metrics: data,
          period: { startDate, endDate },
          aggregation
        }
      });
    } catch (error) {
      logger.error('Error getting historical monitoring data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve historical data'
      });
    }
  }
);

// Get system alerts
router.get('/alerts', requirePermission('monitoring:read'), async (req, res) => {
  try {
    const { page = 1, limit = 50, severity } = req.query;
    const offset = (page - 1) * limit;

    let query = database('system_alerts')
      .select('*')
      .orderBy('triggered_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (severity) {
      query = query.where('severity', severity);
    }

    const alerts = await query;
    
    // Get total count
    let countQuery = database('system_alerts').count('id as count');
    if (severity) {
      countQuery = countQuery.where('severity', severity);
    }
    const [{ count }] = await countQuery;

    res.json({
      success: true,
      data: {
        alerts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(count),
          pages: Math.ceil(count / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Error getting alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve alerts'
    });
  }
});

// Resolve alert
router.post('/alerts/:id/resolve', requirePermission('monitoring:write'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const alert = await database('system_alerts')
      .where('id', id)
      .first();

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    await database('system_alerts')
      .where('id', id)
      .update({
        is_resolved: true,
        resolved_at: new Date(),
        resolved_by: req.user.id
      });

    logger.info(`Alert ${id} resolved by user ${req.user.username}`);

    res.json({
      success: true,
      message: 'Alert resolved successfully'
    });
  } catch (error) {
    logger.error('Error resolving alert:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve alert'
    });
  }
});

// Get system health summary
router.get('/health', requirePermission('monitoring:read'), async (req, res) => {
  try {
    const health = await monitoringService.getHealthSummary();
    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    logger.error('Error getting health summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve health summary'
    });
  }
});

// Get monitoring configuration
router.get('/config', requirePermission('monitoring:read'), async (req, res) => {
  try {
    const config = monitoringService.getConfiguration();
    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    logger.error('Error getting monitoring config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve monitoring configuration'
    });
  }
});

// Update monitoring configuration
router.put('/config', 
  requirePermission('monitoring:write'),
  [
    body('thresholds').optional().isObject().withMessage('Thresholds must be an object'),
    body('thresholds.cpu').optional().isFloat({ min: 0, max: 100 }).withMessage('CPU threshold must be 0-100'),
    body('thresholds.memory').optional().isFloat({ min: 0, max: 100 }).withMessage('Memory threshold must be 0-100'),
    body('thresholds.disk').optional().isFloat({ min: 0, max: 100 }).withMessage('Disk threshold must be 0-100'),
    body('thresholds.load').optional().isFloat({ min: 0 }).withMessage('Load threshold must be positive'),
    body('alertsEnabled').optional().isBoolean().withMessage('Alerts enabled must be boolean'),
    body('interval').optional().isInt({ min: 5000 }).withMessage('Interval must be at least 5000ms')
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

      const { thresholds, alertsEnabled, interval } = req.body;
      
      if (thresholds) {
        monitoringService.updateThresholds(thresholds);
      }

      // Update configuration in database
      const updates = [];
      
      if (thresholds) {
        Object.keys(thresholds).forEach(key => {
          updates.push({
            config_key: `monitoring.${key}_threshold`,
            config_value: thresholds[key].toString(),
            updated_by: req.user.id,
            updated_at: new Date()
          });
        });
      }

      if (alertsEnabled !== undefined) {
        updates.push({
          config_key: 'monitoring.alerts_enabled',
          config_value: alertsEnabled.toString(),
          updated_by: req.user.id,
          updated_at: new Date()
        });
      }

      if (interval !== undefined) {
        updates.push({
          config_key: 'monitoring.check_interval',
          config_value: interval.toString(),
          updated_by: req.user.id,
          updated_at: new Date()
        });
      }

      for (const update of updates) {
        await database('server_configs')
          .where('config_key', update.config_key)
          .update(update);
      }

      logger.info(`Monitoring configuration updated by user ${req.user.username}`);

      res.json({
        success: true,
        message: 'Monitoring configuration updated successfully'
      });
    } catch (error) {
      logger.error('Error updating monitoring config:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update monitoring configuration'
      });
    }
  }
);

// Start monitoring service
router.post('/start', requirePermission('monitoring:write'), async (req, res) => {
  try {
    if (monitoringService.isRunning) {
      return res.json({
        success: true,
        message: 'Monitoring service is already running'
      });
    }

    monitoringService.start();
    
    logger.info(`Monitoring service started by user ${req.user.username}`);

    res.json({
      success: true,
      message: 'Monitoring service started successfully'
    });
  } catch (error) {
    logger.error('Error starting monitoring service:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start monitoring service'
    });
  }
});

// Stop monitoring service
router.post('/stop', requirePermission('monitoring:write'), async (req, res) => {
  try {
    if (!monitoringService.isRunning) {
      return res.json({
        success: true,
        message: 'Monitoring service is not running'
      });
    }

    monitoringService.stop();
    
    logger.info(`Monitoring service stopped by user ${req.user.username}`);

    res.json({
      success: true,
      message: 'Monitoring service stopped successfully'
    });
  } catch (error) {
    logger.error('Error stopping monitoring service:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop monitoring service'
    });
  }
});

// Export metrics (Prometheus format)
router.get('/metrics', requirePermission('monitoring:read'), async (req, res) => {
  try {
    const { format = 'prometheus' } = req.query;
    
    const metrics = await monitoringService.exportMetrics(format);
    
    if (format === 'prometheus') {
      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    } else {
      res.json({
        success: true,
        data: metrics
      });
    }
  } catch (error) {
    logger.error('Error exporting metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export metrics'
    });
  }
});

// Get process snapshots
router.get('/processes', requirePermission('monitoring:read'), async (req, res) => {
  try {
    const { limit = 100, sortBy = 'cpu_usage', order = 'desc' } = req.query;
    
    const processes = await database('process_snapshots')
      .select('*')
      .orderBy(sortBy, order)
      .limit(limit)
      .where('recorded_at', '>', new Date(Date.now() - 5 * 60 * 1000)); // Last 5 minutes

    res.json({
      success: true,
      data: {
        processes,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error getting process snapshots:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve process snapshots'
    });
  }
});

// Get network statistics
router.get('/network', requirePermission('monitoring:read'), async (req, res) => {
  try {
    const { timeRange = '1h' } = req.query;
    
    let timeFilter;
    switch (timeRange) {
      case '1h':
        timeFilter = new Date(Date.now() - 60 * 60 * 1000);
        break;
      case '24h':
        timeFilter = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        timeFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      default:
        timeFilter = new Date(Date.now() - 60 * 60 * 1000);
    }
    
    const networkStats = await database('system_stats')
      .select('recorded_at', 'network_interfaces')
      .where('recorded_at', '>', timeFilter)
      .orderBy('recorded_at', 'desc');

    const processedStats = networkStats.map(stat => ({
      timestamp: stat.recorded_at,
      interfaces: JSON.parse(stat.network_interfaces || '[]')
    }));

    res.json({
      success: true,
      data: {
        stats: processedStats,
        timeRange,
        count: processedStats.length
      }
    });
  } catch (error) {
    logger.error('Error getting network statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve network statistics'
    });
  }
});

// Get disk usage over time
router.get('/disk', requirePermission('monitoring:read'), async (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;
    
    let timeFilter;
    switch (timeRange) {
      case '1h':
        timeFilter = new Date(Date.now() - 60 * 60 * 1000);
        break;
      case '24h':
        timeFilter = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        timeFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      default:
        timeFilter = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }
    
    const diskStats = await database('system_stats')
      .select('recorded_at', 'disk_usage', 'disk_total', 'disk_used', 'disk_free')
      .where('recorded_at', '>', timeFilter)
      .orderBy('recorded_at', 'desc');

    res.json({
      success: true,
      data: {
        stats: diskStats,
        timeRange,
        count: diskStats.length
      }
    });
  } catch (error) {
    logger.error('Error getting disk statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve disk statistics'
    });
  }
});

// Cleanup old monitoring data
router.post('/cleanup', requirePermission('monitoring:write'), async (req, res) => {
  try {
    const result = await monitoringService.cleanupOldData();
    
    logger.info(`Monitoring data cleanup triggered by user ${req.user.username}`);

    res.json({
      success: true,
      message: 'Monitoring data cleanup completed',
      data: result
    });
  } catch (error) {
    logger.error('Error cleaning up monitoring data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup monitoring data'
    });
  }
});

// Get monitoring service status
router.get('/status', requirePermission('monitoring:read'), async (req, res) => {
  try {
    const status = {
      isRunning: monitoringService.isRunning,
      uptime: monitoringService.isRunning ? Date.now() - monitoringService.startTime : 0,
      configuration: monitoringService.getConfiguration(),
      lastCollection: monitoringService.lastCollection,
      errorCount: monitoringService.errorCount || 0
    };

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Error getting monitoring status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve monitoring status'
    });
  }
});

// Create custom alert
router.post('/alerts', 
  requirePermission('monitoring:write'),
  [
    body('title').isLength({ min: 1, max: 255 }).withMessage('Title is required and must be less than 255 characters'),
    body('description').isLength({ min: 1, max: 1000 }).withMessage('Description is required and must be less than 1000 characters'),
    body('severity').isIn(['info', 'warning', 'error', 'critical']).withMessage('Invalid severity level'),
    body('alert_type').isLength({ min: 1, max: 50 }).withMessage('Alert type is required')
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

      const { title, description, severity, alert_type, data } = req.body;
      
      const [alertId] = await database('system_alerts').insert({
        alert_type,
        severity,
        title,
        description,
        data: JSON.stringify(data || {}),
        is_resolved: false,
        triggered_at: new Date(),
        created_by: req.user.id
      });

      logger.info(`Custom alert created by user ${req.user.username}: ${title}`);

      res.status(201).json({
        success: true,
        message: 'Alert created successfully',
        data: { id: alertId }
      });
    } catch (error) {
      logger.error('Error creating custom alert:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create alert'
      });
    }
  }
);

// Get alert statistics
router.get('/alerts/stats', requirePermission('monitoring:read'), async (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;
    
    let timeFilter;
    switch (timeRange) {
      case '1h':
        timeFilter = new Date(Date.now() - 60 * 60 * 1000);
        break;
      case '24h':
        timeFilter = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        timeFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        timeFilter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        timeFilter = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }

    const stats = await database('system_alerts')
      .select('severity')
      .count('id as count')
      .where('triggered_at', '>', timeFilter)
      .groupBy('severity');

    const typeStats = await database('system_alerts')
      .select('alert_type')
      .count('id as count')
      .where('triggered_at', '>', timeFilter)
      .groupBy('alert_type')
      .orderBy('count', 'desc');

    const totalAlerts = await database('system_alerts')
      .count('id as count')
      .where('triggered_at', '>', timeFilter)
      .first();

    const resolvedAlerts = await database('system_alerts')
      .count('id as count')
      .where('triggered_at', '>', timeFilter)
      .where('is_resolved', true)
      .first();

    res.json({
      success: true,
      data: {
        severityStats: stats,
        typeStats: typeStats,
        totalAlerts: totalAlerts.count,
        resolvedAlerts: resolvedAlerts.count,
        unresolvedAlerts: totalAlerts.count - resolvedAlerts.count,
        timeRange
      }
    });
  } catch (error) {
    logger.error('Error getting alert statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve alert statistics'
    });
  }
});

module.exports = router;