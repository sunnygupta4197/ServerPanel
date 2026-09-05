// Socket.IO Event Handlers for Real-time Communication
const logger = require('../config/logger');
const monitoringService = require('../services/monitoringService');
const { SystemService, systemMonitor } = require('../services/systemService');
const jobQueue = require('../jobs/jobQueue');
const broadcast = require('./broadcast');

module.exports = (io) => {
  broadcast.setIO(io);

  // Store connected clients
  const connectedClients = new Map();

  io.on('connection', (socket) => {
    const userInfo = socket.isAuthenticated ? 
      `User: ${socket.userId} (${socket.userRole})` : 
      'Unauthenticated';
    logger.info(`Client connected: ${socket.id} (${userInfo})`);
    
    // Store client info
    connectedClients.set(socket.id, {
      userId: socket.userId || null,
      userRole: socket.userRole || 'guest',
      isAuthenticated: socket.isAuthenticated || false,
      connectedAt: new Date(),
      lastActivity: new Date()
    });

    // Join user-specific room (only if authenticated)
    if (socket.userId) {
      socket.join(`user_${socket.userId}`);
    }
    
    // Join role-specific room
    socket.join(`role_${socket.userRole || 'guest'}`);

    // Send initial connection data
    socket.emit('connected', {
      message: 'Connected to ServerPanel Pro',
      timestamp: new Date().toISOString(),
      clientId: socket.id
    });

    // Handle real-time monitoring requests
    socket.on('subscribe_monitoring', async (data) => {
      try {
        if (!socket.isAuthenticated) {
          socket.emit('error', { message: 'Authentication required to subscribe to monitoring' });
          return;
        }

        logger.info(`Client ${socket.id} (User: ${socket.userId}) subscribed to monitoring`);
        socket.join('monitoring');

        // Send initial monitoring data
        try {
          const stats = await systemMonitor.getRealtimeStats();
          socket.emit('monitoring_data', {
            type: 'initial',
            data: stats,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error('Error getting system stats:', error);
          socket.emit('monitoring_data', {
            type: 'error',
            message: 'Failed to get system stats',
            timestamp: new Date().toISOString()
          });
        }
        
        // Update last activity
        const client = connectedClients.get(socket.id);
        if (client) {
          client.lastActivity = new Date();
        }
        
      } catch (error) {
        logger.error('Error handling monitoring subscription:', error);
        socket.emit('error', {
          message: 'Failed to subscribe to monitoring',
          error: error.message
        });
      }
    });

    // Handle unsubscribe from monitoring
    socket.on('unsubscribe_monitoring', () => {
      socket.leave('monitoring');
      logger.info(`Client ${socket.id} unsubscribed from monitoring`);
    });

    // Subscribe to background job updates
    socket.on('subscribe_jobs', () => {
      if (!socket.isAuthenticated) {
        socket.emit('error', { message: 'Authentication required to subscribe to jobs' });
        return;
      }
      socket.join('jobs');
      // Send current job state immediately so the panel populates on load
      socket.emit('jobs:snapshot', jobQueue.getJobs());
      logger.info(`Client ${socket.id} (User: ${socket.userId}) subscribed to jobs`);
    });

    socket.on('unsubscribe_jobs', () => {
      socket.leave('jobs');
    });

    // Handle file operations
    socket.on('subscribe_file_operations', () => {
      if (!socket.isAuthenticated) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }
      socket.join('file_operations');
      logger.info(`Client ${socket.id} subscribed to file operations`);
    });

    // Handle system logs subscription
    socket.on('subscribe_logs', (data) => {
      if (!socket.isAuthenticated) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }
      const { logType } = data;
      socket.join(`logs_${logType}`);
      logger.info(`Client ${socket.id} subscribed to ${logType} logs`);
    });

    // Handle service status subscription
    socket.on('subscribe_services', () => {
      if (!socket.isAuthenticated) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }
      socket.join('services');
      logger.info(`Client ${socket.id} subscribed to service status`);
    });

    socket.on('unsubscribe_services', () => {
      socket.leave('services');
    });

    // Handle process monitoring
    socket.on('subscribe_processes', () => {
      if (!socket.isAuthenticated) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }
      socket.join('processes');
      logger.info(`Client ${socket.id} subscribed to process monitoring`);
    });

    // Handle chat messages (for admin communication)
    socket.on('send_message', (data) => {
      const { message, channel = 'general' } = data;
      
      // Broadcast to all admins
      io.to('role_admin').emit('new_message', {
        userId: socket.userId,
        message,
        channel,
        timestamp: new Date().toISOString()
      });
      
      logger.info(`Message sent by ${socket.userId} to ${channel}: ${message}`);
    });

    // Handle notification acknowledgment
    socket.on('ack_notification', (data) => {
      const { notificationId } = data;
      logger.info(`Notification ${notificationId} acknowledged by user ${socket.userId}`);
      
      // Update notification status in database
      updateNotificationStatus(notificationId, socket.userId);
    });

    // Handle alert acknowledgment
    socket.on('ack_alert', (data) => {
      const { alertId } = data;
      logger.info(`Alert ${alertId} acknowledged by user ${socket.userId}`);
      
      // Update alert status
      updateAlertStatus(alertId, socket.userId);
    });

    // Handle ping/pong for connection monitoring
    socket.on('ping', () => {
      socket.emit('pong', {
        timestamp: new Date().toISOString()
      });
      
      // Update last activity
      const client = connectedClients.get(socket.id);
      if (client) {
        client.lastActivity = new Date();
      }
    });

    // Handle custom events
    socket.on('custom_event', (data) => {
      logger.info(`Custom event received from ${socket.userId}:`, data);
      
      // Broadcast to other admins if user is admin
      if (socket.userRole === 'admin') {
        socket.to('role_admin').emit('admin_event', {
          userId: socket.userId,
          event: data,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      logger.info(`Client disconnected: ${socket.id} (Reason: ${reason})`);
      
      // Remove from connected clients
      connectedClients.delete(socket.id);
      
      // Notify other admins about disconnection
      socket.to('role_admin').emit('user_disconnected', {
        userId: socket.userId,
        reason,
        timestamp: new Date().toISOString()
      });
    });

    // Handle connection errors
    socket.on('error', (error) => {
      logger.error(`Socket error for client ${socket.id}:`, error);
    });
  });

  // Job completion → broadcast page:refresh to all connected clients
  const JOB_PAGE_MAP = {
    service_control: 'services',
    ssl_issue:       'ssl',
    ssl_renew:       'ssl',
    backup_create:   'backups',
    backup_restore:  'backups',
    app_install:     'applications',
    app_uninstall:   'applications',
  };

  jobQueue.emitter.on('job:done', (job) => {
    const page = JOB_PAGE_MAP[job.type];
    if (page) {
      io.emit('page:refresh', { page, jobStatus: job.status, jobId: job.id });
    }
  });

  // Service status poller — push a refresh signal to the services room every 30 s
  // so the UI stays live even when services change outside the panel.
  setInterval(() => {
    io.to('services').emit('page:refresh', { page: 'services', source: 'poll' });
  }, 30000);

  // Start real-time system monitoring
  systemMonitor.start(5000); // Update every 5 seconds

  // Set up real-time monitoring listeners
  systemMonitor.on('stats', (stats) => {
    if (stats) {
      io.to('monitoring').emit('systemStats', stats);
      io.to('monitoring').emit('monitoring_data', {
        type: 'update',
        data: stats,
        timestamp: new Date().toISOString()
      });
    }
  });

  // monitoringService.on('systemStats') is intentionally omitted — real-time
  // socket updates are handled by systemMonitor above. monitoringService stats
  // are for DB storage and alerts only.

  monitoringService.on('alert', (alert) => {
    // Send to all admins
    io.to('role_admin').emit('system_alert', {
      alert,
      timestamp: new Date().toISOString()
    });
    
    // Send to monitoring subscribers
    io.to('monitoring').emit('alert', alert);
  });

  monitoringService.on('notification', (notification) => {
    // Send to specific user or all users
    if (notification.userId) {
      io.to(`user_${notification.userId}`).emit('notification', notification);
    } else {
      io.emit('notification', notification);
    }
  });

  // Periodic connection cleanup
  setInterval(() => {
    const now = new Date();
    const timeout = 5 * 60 * 1000; // 5 minutes
    
    connectedClients.forEach((client, socketId) => {
      if (now - client.lastActivity > timeout) {
        logger.info(`Cleaning up inactive client: ${socketId}`);
        connectedClients.delete(socketId);
        
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
        }
      }
    });
  }, 60000); // Check every minute

  // Heartbeat to check client connectivity
  setInterval(() => {
    io.emit('heartbeat', {
      timestamp: new Date().toISOString(),
      connectedClients: connectedClients.size
    });
  }, 30000); // Every 30 seconds

  // Export functions for external use
  return {
    getConnectedClients: () => Array.from(connectedClients.values()),
    getClientCount: () => connectedClients.size
  };
};

// Helper functions
async function updateNotificationStatus(notificationId, userId) {
  try {
    const database = require('../config/database');
    
    await database('notifications')
      .where('id', notificationId)
      .where('user_id', userId)
      .update({
        is_read: true,
        read_at: new Date()
      });
      
  } catch (error) {
    logger.error('Error updating notification status:', error);
  }
}

async function updateAlertStatus(alertId, userId) {
  try {
    const database = require('../config/database');
    
    await database('system_alerts')
      .where('id', alertId)
      .update({
        acknowledged_by: userId,
        acknowledged_at: new Date()
      });
      
  } catch (error) {
    logger.error('Error updating alert status:', error);
  }
}