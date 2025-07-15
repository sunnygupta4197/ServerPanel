// Socket.IO Event Handlers for Real-time Communication
const logger = require('../config/logger');
const monitoringService = require('../services/monitoringService');
const systemService = require('../services/systemService');

module.exports = (io) => {
  // Store connected clients
  const connectedClients = new Map();

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id} (User: ${socket.userId})`);
    
    // Store client info
    connectedClients.set(socket.id, {
      userId: socket.userId,
      userRole: socket.userRole,
      connectedAt: new Date(),
      lastActivity: new Date()
    });

    // Join user-specific room
    socket.join(`user_${socket.userId}`);
    
    // Join role-specific room
    socket.join(`role_${socket.userRole}`);

    // Send initial connection data
    socket.emit('connected', {
      message: 'Connected to ServerPanel Pro',
      timestamp: new Date().toISOString(),
      clientId: socket.id
    });

    // Handle real-time monitoring requests
    socket.on('subscribe_monitoring', async (data) => {
      try {
        logger.info(`Client ${socket.id} subscribed to monitoring`);
        
        // Join monitoring room
        socket.join('monitoring');
        
        // Send initial monitoring data
        const stats = await systemService.getSystemStats();
        socket.emit('monitoring_data', {
          type: 'initial',
          data: stats,
          timestamp: new Date().toISOString()
        });
        
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

    // Handle file operations
    socket.on('subscribe_file_operations', () => {
      socket.join('file_operations');
      logger.info(`Client ${socket.id} subscribed to file operations`);
    });

    // Handle system logs subscription
    socket.on('subscribe_logs', (data) => {
      const { logType } = data;
      socket.join(`logs_${logType}`);
      logger.info(`Client ${socket.id} subscribed to ${logType} logs`);
    });

    // Handle service status subscription
    socket.on('subscribe_services', () => {
      socket.join('services');
      logger.info(`Client ${socket.id} subscribed to service status`);
    });

    // Handle process monitoring
    socket.on('subscribe_processes', () => {
      socket.join('processes');
      logger.info(`Client ${socket.id} subscribed to process monitoring`);
    });

    // Handle terminal session requests
    socket.on('request_terminal', (data) => {
      if (socket.userRole === 'admin') {
        socket.join('terminal');
        logger.info(`Admin ${socket.userId} requested terminal access`);
        socket.emit('terminal_ready', {
          message: 'Terminal access granted',
          sessionId: socket.id
        });
      } else {
        socket.emit('terminal_denied', {
          message: 'Terminal access denied - insufficient permissions'
        });
      }
    });

    // Handle terminal commands
    socket.on('terminal_command', async (data) => {
      if (socket.userRole === 'admin' && socket.rooms.has('terminal')) {
        try {
          const { command } = data;
          
          // Log command execution
          logger.info(`Terminal command executed by ${socket.userId}: ${command}`);
          
          // Execute command (implement with proper security)
          const result = await executeTerminalCommand(command);
          
          socket.emit('terminal_output', {
            command,
            output: result.output,
            error: result.error,
            timestamp: new Date().toISOString()
          });
          
        } catch (error) {
          socket.emit('terminal_output', {
            command: data.command,
            output: '',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }
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

  // Set up monitoring service event listeners
  monitoringService.on('systemStats', (stats) => {
    io.to('monitoring').emit('monitoring_data', {
      type: 'update',
      data: stats,
      timestamp: new Date().toISOString()
    });
  });

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

  // Broadcast service status changes
  const broadcastServiceStatus = (serviceName, status) => {
    io.to('services').emit('service_status_change', {
      service: serviceName,
      status,
      timestamp: new Date().toISOString()
    });
  };

  // Broadcast process changes
  const broadcastProcessChange = (processInfo) => {
    io.to('processes').emit('process_change', {
      process: processInfo,
      timestamp: new Date().toISOString()
    });
  };

  // Broadcast file operation results
  const broadcastFileOperation = (operation, result) => {
    io.to('file_operations').emit('file_operation_result', {
      operation,
      result,
      timestamp: new Date().toISOString()
    });
  };

  // Broadcast system logs
  const broadcastSystemLog = (logType, logEntry) => {
    io.to(`logs_${logType}`).emit('log_entry', {
      type: logType,
      entry: logEntry,
      timestamp: new Date().toISOString()
    });
  };

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
    broadcastServiceStatus,
    broadcastProcessChange,
    broadcastFileOperation,
    broadcastSystemLog,
    getConnectedClients: () => Array.from(connectedClients.values()),
    getClientCount: () => connectedClients.size
  };
};

// Helper functions
async function executeTerminalCommand(command) {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  try {
    // Security check - block dangerous commands
    const dangerousCommands = [
      'rm -rf', 'del /f', 'format', 'fdisk', 'mkfs',
      'shutdown', 'reboot', 'halt', 'poweroff'
    ];
    
    const isDangerous = dangerousCommands.some(dangerous => 
      command.toLowerCase().includes(dangerous.toLowerCase())
    );
    
    if (isDangerous) {
      throw new Error('Command blocked for security reasons');
    }
    
    const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
    return { output: stdout, error: stderr };
    
  } catch (error) {
    return { output: '', error: error.message };
  }
}

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