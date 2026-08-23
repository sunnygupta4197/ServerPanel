const EventEmitter = require('events');
const cron = require('node-cron');
const { SystemService: systemService } = require('./systemService');
const database = require('../config/database');
const logger = require('../config/logger');
const config = require('../config/config');
const { cleanExpiredTokens } = require('../middleware/authMiddleware');

class MonitoringService extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.interval = null;
    this.alertThresholds = {
      cpu: config.MONITORING.CPU_THRESHOLD,
      memory: config.MONITORING.MEMORY_THRESHOLD,
      disk: config.MONITORING.DISK_THRESHOLD,
      load: config.MONITORING.LOAD_THRESHOLD
    };
    this.alertCooldowns = new Map(); // Prevent alert spam
    this.retentionDays = config.MONITORING.RETENTION_DAYS || 30;
  }

  // Start monitoring service
  start() {
    if (this.isRunning) {
      logger.warn('Monitoring service is already running');
      return;
    }

    logger.info('Starting monitoring service...');
    this.isRunning = true;

    // Start real-time monitoring
    this.startRealTimeMonitoring();

    // Schedule data cleanup
    this.scheduleCleanup();

    // Schedule alert checks
    this.scheduleAlertChecks();

    logger.info('Monitoring service started successfully');
    this.emit('started');
  }

  // Stop monitoring service
  stop() {
    if (!this.isRunning) {
      logger.warn('Monitoring service is not running');
      return;
    }

    logger.info('Stopping monitoring service...');
    this.isRunning = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Stop scheduled tasks
    cron.getTasks().forEach(task => task.destroy());

    logger.info('Monitoring service stopped');
    this.emit('stopped');
  }

  // Start real-time system monitoring
  startRealTimeMonitoring() {
    const intervalMs = config.MONITORING.INTERVAL || 30000; // 30 seconds default

    this.interval = setInterval(async () => {
      try {
        await this.collectSystemMetrics();
      } catch (error) {
        logger.error('Error collecting system metrics:', error);
        this.emit('error', error);
      }
    }, intervalMs);

    logger.info(`Real-time monitoring started with ${intervalMs}ms interval`);
  }

  // Collect and store system metrics
  async collectSystemMetrics() {
    try {
      const stats = await systemService.getSystemStats();

      // getSystemStats() is the fast path and deliberately omits process/network
      // enumeration — fetch those separately for storage, tolerating failure.
      const [processInfo, networkInfo] = await Promise.all([
        systemService.getProcesses().catch(error => {
          logger.warn('Could not get process info for metrics:', error.message);
          return { total: 0, running: 0, processes: [] };
        }),
        systemService.getNetworkInterfaces().catch(error => {
          logger.warn('Could not get network info for metrics:', error.message);
          return { interfaces: [] };
        })
      ]);

      // Store in database
      await this.storeMetrics(stats, processInfo, networkInfo);

      // Check for alerts
      await this.checkAlerts(stats);

      // Emit real-time data
      this.emit('systemStats', stats);

      return stats;
    } catch (error) {
      logger.error('Error collecting system metrics:', error);
      throw error;
    }
  }

  // Store metrics in database
  async storeMetrics(stats, processInfo, networkInfo) {
    try {
      const metrics = {
        recorded_at: new Date(),
        cpu_usage: stats.cpu.usage,
        memory_usage: stats.memory.usage,
        memory_total: stats.memory.total,
        memory_used: stats.memory.used,
        memory_free: stats.memory.free,
        disk_usage: 0, // Will be calculated from storage info
        disk_total: 0,
        disk_used: 0,
        disk_free: 0,
        load_avg_1: stats.loadAverage[0],
        load_avg_5: stats.loadAverage[1],
        load_avg_15: stats.loadAverage[2],
        processes_total: processInfo.total,
        processes_running: processInfo.running,
        cpu_temperature: stats.cpu.temperature,
        network_interfaces: JSON.stringify(networkInfo.interfaces)
      };

      // Calculate disk usage from storage info
      try {
        const storage = await systemService.getStorageInfo();
        if (storage.filesystems && storage.filesystems.length > 0) {
          const rootFs = storage.filesystems.find(fs => fs.mount === '/' || fs.mount === 'C:') || storage.filesystems[0];
          if (rootFs) {
            metrics.disk_usage = rootFs.use;
            metrics.disk_total = rootFs.size;
            metrics.disk_used = rootFs.used;
            metrics.disk_free = rootFs.available;
          }
        }
      } catch (error) {
        logger.warn('Could not get disk usage:', error.message);
      }

      await database('system_stats').insert(metrics);

      // Store process snapshots (top 10 processes)
      await this.storeProcessSnapshots(processInfo.processes);
      
    } catch (error) {
      logger.error('Error storing metrics:', error);
      throw error;
    }
  }

  // Store process snapshots
  async storeProcessSnapshots(processes) {
    try {
      const snapshots = processes.slice(0, 10).map(proc => ({
        pid: proc.pid,
        name: proc.name,
        command: proc.command,
        cpu_usage: proc.cpu,
        memory_usage: proc.memory,
        memory_bytes: proc.memory * 1024 * 1024, // Approximate
        user: proc.user,
        status: proc.state,
        priority: proc.priority,
        started_at: proc.started ? new Date(proc.started) : null,
        recorded_at: new Date()
      }));

      if (snapshots.length > 0) {
        await database('process_snapshots').insert(snapshots);
      }
    } catch (error) {
      logger.error('Error storing process snapshots:', error);
    }
  }

  // Check for alert conditions
  async checkAlerts(stats) {
    const alerts = [];

    // CPU usage alert
    if (stats.cpu.usage > this.alertThresholds.cpu) {
      const alert = {
        alert_type: 'high_cpu_usage',
        // system_alerts.severity is a DB-level CHECK/enum restricted to
        // low/medium/high/critical - 'warning' silently fails the insert.
        severity: stats.cpu.usage > 90 ? 'critical' : 'medium',
        title: 'High CPU Usage Detected',
        description: `CPU usage is ${stats.cpu.usage}% (threshold: ${this.alertThresholds.cpu}%)`,
        data: JSON.stringify({
          cpu_usage: stats.cpu.usage,
          threshold: this.alertThresholds.cpu,
          cores: stats.cpu.cores
        })
      };
      alerts.push(alert);
    }

    // Memory usage alert
    if (stats.memory.usage > this.alertThresholds.memory) {
      const alert = {
        alert_type: 'high_memory_usage',
        severity: stats.memory.usage > 95 ? 'critical' : 'medium',
        title: 'High Memory Usage Detected',
        description: `Memory usage is ${stats.memory.usage}% (threshold: ${this.alertThresholds.memory}%)`,
        data: JSON.stringify({
          memory_usage: stats.memory.usage,
          threshold: this.alertThresholds.memory,
          total: stats.memory.total,
          used: stats.memory.used
        })
      };
      alerts.push(alert);
    }

    // Load average alert
    const loadPerCore = stats.loadAverage[0] / require('os').cpus().length;
    if (loadPerCore > this.alertThresholds.load) {
      const alert = {
        alert_type: 'high_system_load',
        severity: loadPerCore > 3 ? 'critical' : 'medium',
        title: 'High System Load Detected',
        description: `System load is ${stats.loadAverage[0].toFixed(2)} (${loadPerCore.toFixed(2)} per core)`,
        data: JSON.stringify({
          load_1min: stats.loadAverage[0],
          load_5min: stats.loadAverage[1],
          load_15min: stats.loadAverage[2],
          load_per_core: loadPerCore,
          threshold: this.alertThresholds.load
        })
      };
      alerts.push(alert);
    }

    // Process alerts for each alert
    for (const alert of alerts) {
      await this.processAlert(alert);
    }
  }

  // Process individual alert
  async processAlert(alert) {
    try {
      // Check cooldown to prevent spam
      const cooldownKey = `${alert.alert_type}_${alert.severity}`;
      const lastAlert = this.alertCooldowns.get(cooldownKey);
      const cooldownPeriod = 5 * 60 * 1000; // 5 minutes

      if (lastAlert && (Date.now() - lastAlert) < cooldownPeriod) {
        return; // Skip this alert due to cooldown
      }

      // Store alert in database
      const [alertId] = await database('system_alerts').insert({
        alert_type: alert.alert_type,
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        data: alert.data,
        is_resolved: false,
        triggered_at: new Date()
      });

      // Update cooldown
      this.alertCooldowns.set(cooldownKey, Date.now());

      // Emit alert event
      this.emit('alert', { id: alertId, ...alert });

      // Send notifications if enabled
      if (config.MONITORING.ALERTS_ENABLED) {
        await this.sendAlertNotifications(alert);
      }

      logger.warn(`System alert triggered: ${alert.title}`, alert);

    } catch (error) {
      logger.error('Error processing alert:', error);
    }
  }

  // Send alert notifications
  async sendAlertNotifications(alert) {
    try {
      // Create notification for admins
      const adminUsers = await database('users')
        .where('role', 'admin')
        .where('is_active', true);

      const notifications = adminUsers.map(user => ({
        user_id: user.id,
        title: alert.title,
        message: alert.description,
        type: alert.severity === 'critical' ? 'error' : 'warning',
        is_read: false,
        metadata: JSON.stringify({
          alert_type: alert.alert_type,
          severity: alert.severity,
          timestamp: new Date().toISOString()
        }),
        created_at: new Date(),
        updated_at: new Date()
      }));

      if (notifications.length > 0) {
        await database('notifications').insert(notifications);
      }

      // TODO: Send email notifications
      // TODO: Send webhook notifications
      // TODO: Send SMS notifications (if configured)

    } catch (error) {
      logger.error('Error sending alert notifications:', error);
    }
  }

  // Get historical metrics
  async getHistoricalMetrics(startDate, endDate, aggregation = 'hour') {
    try {
      const query = database('system_stats')
        .select('*')
        .whereBetween('recorded_at', [startDate, endDate])
        .orderBy('recorded_at', 'asc');

      const data = await query;

      // Aggregate data if requested
      if (aggregation !== 'raw') {
        return this.aggregateMetrics(data, aggregation);
      }

      return data;
    } catch (error) {
      logger.error('Error getting historical metrics:', error);
      throw error;
    }
  }

  // Aggregate metrics by time period
  aggregateMetrics(data, period) {
    const aggregated = {};
    const groupBy = period === 'hour' ? 'hour' : period === 'day' ? 'day' : 'minute';

    data.forEach(record => {
      const date = new Date(record.recorded_at);
      let key;

      switch (groupBy) {
        case 'minute':
          key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
          break;
        case 'hour':
          key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:00`;
          break;
        case 'day':
          key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
          break;
        default:
          key = record.recorded_at;
      }

      if (!aggregated[key]) {
        aggregated[key] = {
          timestamp: key,
          cpu_usage: [],
          memory_usage: [],
          disk_usage: [],
          load_avg_1: [],
          processes_total: []
        };
      }

      aggregated[key].cpu_usage.push(record.cpu_usage);
      aggregated[key].memory_usage.push(record.memory_usage);
      aggregated[key].disk_usage.push(record.disk_usage);
      aggregated[key].load_avg_1.push(record.load_avg_1);
      aggregated[key].processes_total.push(record.processes_total);
    });

    // Calculate averages
    return Object.values(aggregated).map(group => ({
      timestamp: group.timestamp,
      cpu_usage: average(group.cpu_usage),
      memory_usage: average(group.memory_usage),
      disk_usage: average(group.disk_usage),
      load_avg_1: average(group.load_avg_1),
      processes_total: Math.round(average(group.processes_total))
    }));
  }

  // Get system health summary
  async getHealthSummary() {
    try {
      const health = await systemService.getSystemHealth();
      
      // Get recent alerts
      const recentAlerts = await database('system_alerts')
        .select('*')
        .where('triggered_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000)) // Last 24 hours
        .where('is_resolved', false)
        .orderBy('triggered_at', 'desc');

      // Get uptime
      const uptime = systemService.getUptime();

      return {
        overall: health.overall,
        score: health.score,
        issues: health.issues,
        uptime: uptime,
        alerts: recentAlerts.length,
        criticalAlerts: recentAlerts.filter(alert => alert.severity === 'critical').length,
        warningAlerts: recentAlerts.filter(alert => alert.severity === 'warning').length
      };
    } catch (error) {
      logger.error('Error getting health summary:', error);
      throw error;
    }
  }

  // Schedule cleanup of old data
  scheduleCleanup() {
    // Run cleanup daily at 2 AM
    cron.schedule('0 2 * * *', async () => {
      try {
        await this.cleanupOldData();
      } catch (error) {
        logger.error('Error during scheduled cleanup:', error);
      }
    });

    logger.info('Scheduled daily cleanup at 2 AM');
  }

  // Clean up old monitoring data
  async cleanupOldData() {
    try {
      const cutoffDate = new Date(Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000));
      
      // Clean system stats
      const deletedStats = await database('system_stats')
        .where('recorded_at', '<', cutoffDate)
        .del();

      // Clean process snapshots
      const deletedSnapshots = await database('process_snapshots')
        .where('recorded_at', '<', cutoffDate)
        .del();

      // Clean resolved alerts older than 90 days
      const alertCutoff = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000));
      const deletedAlerts = await database('system_alerts')
        .where('triggered_at', '<', alertCutoff)
        .where('is_resolved', true)
        .del();

      // Clean expired auth tokens
      await cleanExpiredTokens();

      logger.info(`Cleanup completed: ${deletedStats} stats, ${deletedSnapshots} snapshots, ${deletedAlerts} alerts deleted`);
      
      this.emit('cleanup', {
        deletedStats,
        deletedSnapshots,
        deletedAlerts,
        cutoffDate
      });

    } catch (error) {
      logger.error('Error cleaning up old data:', error);
      throw error;
    }
  }

  // Schedule alert checks
  scheduleAlertChecks() {
    // Check for stale alerts every hour
    cron.schedule('0 * * * *', async () => {
      try {
        await this.checkStaleAlerts();
      } catch (error) {
        logger.error('Error checking stale alerts:', error);
      }
    });
  }

  // Check for alerts that should be auto-resolved
  async checkStaleAlerts() {
    try {
      const currentStats = await systemService.getSystemStats();
      
      // Auto-resolve CPU alerts
      if (currentStats.cpu.usage < this.alertThresholds.cpu) {
        await database('system_alerts')
          .where('alert_type', 'high_cpu_usage')
          .where('is_resolved', false)
          .update({
            is_resolved: true,
            resolved_at: new Date()
          });
      }

      // Auto-resolve memory alerts
      if (currentStats.memory.usage < this.alertThresholds.memory) {
        await database('system_alerts')
          .where('alert_type', 'high_memory_usage')
          .where('is_resolved', false)
          .update({
            is_resolved: true,
            resolved_at: new Date()
          });
      }

      // Auto-resolve load alerts
      const loadPerCore = currentStats.loadAverage[0] / require('os').cpus().length;
      if (loadPerCore < this.alertThresholds.load) {
        await database('system_alerts')
          .where('alert_type', 'high_system_load')
          .where('is_resolved', false)
          .update({
            is_resolved: true,
            resolved_at: new Date()
          });
      }

    } catch (error) {
      logger.error('Error checking stale alerts:', error);
    }
  }

  // Update alert thresholds
  updateThresholds(newThresholds) {
    this.alertThresholds = { ...this.alertThresholds, ...newThresholds };
    logger.info('Alert thresholds updated:', this.alertThresholds);
    this.emit('thresholdsUpdated', this.alertThresholds);
  }

  // Get current configuration
  getConfiguration() {
    return {
      isRunning: this.isRunning,
      interval: config.MONITORING.INTERVAL,
      thresholds: this.alertThresholds,
      retentionDays: this.retentionDays,
      alertsEnabled: config.MONITORING.ALERTS_ENABLED
    };
  }

  // Export metrics for external monitoring systems
  async exportMetrics(format = 'prometheus') {
    try {
      const stats = await systemService.getSystemStats();

      if (format === 'prometheus') {
        const processInfo = await systemService.getProcesses().catch(() => ({ total: 0 }));
        return this.formatPrometheusMetrics(stats, processInfo);
      } else if (format === 'json') {
        return JSON.stringify(stats, null, 2);
      } else {
        throw new Error(`Unsupported export format: ${format}`);
      }
    } catch (error) {
      logger.error('Error exporting metrics:', error);
      throw error;
    }
  }

  // Format metrics in Prometheus format
  formatPrometheusMetrics(stats, processInfo) {
    const metrics = [];
    
    metrics.push(`# HELP cpu_usage_percent CPU usage percentage`);
    metrics.push(`# TYPE cpu_usage_percent gauge`);
    metrics.push(`cpu_usage_percent ${stats.cpu.usage}`);
    
    metrics.push(`# HELP memory_usage_percent Memory usage percentage`);
    metrics.push(`# TYPE memory_usage_percent gauge`);
    metrics.push(`memory_usage_percent ${stats.memory.usage}`);
    
    metrics.push(`# HELP memory_total_bytes Total memory in bytes`);
    metrics.push(`# TYPE memory_total_bytes gauge`);
    metrics.push(`memory_total_bytes ${stats.memory.total}`);
    
    metrics.push(`# HELP load_average_1min System load average over 1 minute`);
    metrics.push(`# TYPE load_average_1min gauge`);
    metrics.push(`load_average_1min ${stats.loadAverage[0]}`);
    
    metrics.push(`# HELP processes_total Total number of processes`);
    metrics.push(`# TYPE processes_total gauge`);
    metrics.push(`processes_total ${processInfo.total}`);
    
    return metrics.join('\n');
  }
}

// Helper function to calculate average
function average(numbers) {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
}

module.exports = new MonitoringService();