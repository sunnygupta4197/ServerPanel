const express = require('express');
const router = express.Router();
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const si = require('systeminformation');
const { requireRole, requirePermission } = require('../middleware/authMiddleware');
const { body, param, validationResult } = require('express-validator');
const logger = require('../config/logger');
const config = require('../config/config');

const execAsync = promisify(exec);

// System information endpoint
router.get('/info', requirePermission('system:read'), async (req, res) => {
  try {
    const [cpu, memory, disks, network, system, battery] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.networkInterfaces(),
      si.system(),
      si.battery()
    ]);

    const systemInfo = {
      system: {
        platform: os.platform(),
        hostname: os.hostname(),
        type: os.type(),
        arch: os.arch(),
        release: os.release(),
        uptime: os.uptime(),
        manufacturer: system.manufacturer,
        model: system.model,
        version: system.version
      },
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        speed: cpu.speed,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        processors: cpu.processors
      },
      memory: {
        total: memory.total,
        free: memory.free,
        used: memory.used,
        available: memory.available,
        usage: ((memory.used / memory.total) * 100).toFixed(2)
      },
      disks: disks.map(disk => ({
        filesystem: disk.fs,
        type: disk.type,
        size: disk.size,
        used: disk.used,
        available: disk.available,
        usage: disk.use,
        mount: disk.mount
      })),
      network: network.map(iface => ({
        iface: iface.iface,
        type: iface.type,
        ip4: iface.ip4,
        ip6: iface.ip6,
        mac: iface.mac,
        speed: iface.speed,
        operstate: iface.operstate
      })),
      battery: battery ? {
        hasBattery: battery.hasbattery,
        percent: battery.percent,
        charging: battery.ischarging,
        timeRemaining: battery.timeremaining
      } : null
    };

    res.json({
      success: true,
      data: systemInfo
    });
  } catch (error) {
    logger.error('Error getting system info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve system information'
    });
  }
});

// Real-time system stats
router.get('/stats', requirePermission('system:read'), async (req, res) => {
  try {
    const [currentLoad, memory, temp, processes] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.cpuTemperature(),
      si.processes()
    ]);

    const stats = {
      timestamp: new Date().toISOString(),
      cpu: {
        usage: currentLoad.currentload.toFixed(2),
        user: currentLoad.currentload_user.toFixed(2),
        system: currentLoad.currentload_system.toFixed(2),
        idle: currentLoad.currentload_idle.toFixed(2),
        temperature: temp.main || null
      },
      memory: {
        total: memory.total,
        used: memory.used,
        free: memory.free,
        usage: ((memory.used / memory.total) * 100).toFixed(2)
      },
      processes: {
        all: processes.all,
        running: processes.running,
        blocked: processes.blocked,
        sleeping: processes.sleeping
      },
      loadAvg: os.loadavg()
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting system stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve system statistics'
    });
  }
});

// Process management
router.get('/processes', requirePermission('system:read'), async (req, res) => {
  try {
    const processes = await si.processes();
    
    const processData = processes.list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 50) // Top 50 processes
      .map(proc => ({
        pid: proc.pid,
        name: proc.name,
        command: proc.command,
        cpu: proc.cpu,
        memory: proc.memory,
        priority: proc.priority,
        user: proc.user,
        state: proc.state,
        started: proc.started
      }));

    res.json({
      success: true,
      data: {
        total: processes.all,
        running: processes.running,
        processes: processData
      }
    });
  } catch (error) {
    logger.error('Error getting processes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve process list'
    });
  }
});

// Kill process
router.delete('/processes/:pid', 
  requirePermission('system:write'),
  [
    param('pid').isInt({ min: 1 }).withMessage('Invalid process ID')
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

      const { pid } = req.params;
      const { signal = 'SIGTERM' } = req.body;

      // Security check - don't allow killing critical system processes
      const criticalPids = [0, 1, 2]; // init, kthreadd, etc.
      if (criticalPids.includes(parseInt(pid))) {
        return res.status(403).json({
          success: false,
          message: 'Cannot kill critical system process'
        });
      }

      if (config.SYSTEM.IS_WINDOWS) {
        await execAsync(`taskkill /PID ${pid} /F`);
      } else {
        await execAsync(`kill -${signal} ${pid}`);
      }

      logger.info(`Process ${pid} killed by user ${req.user.username}`);
      
      res.json({
        success: true,
        message: `Process ${pid} terminated successfully`
      });
    } catch (error) {
      logger.error('Error killing process:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to terminate process'
      });
    }
  }
);

// System services
router.get('/services', requirePermission('system:read'), async (req, res) => {
  try {
    let services = [];

    if (config.SYSTEM.IS_WINDOWS) {
      const { stdout } = await execAsync('sc query type= service state= all');
      // Parse Windows services output
      services = parseWindowsServices(stdout);
    } else {
      // Linux systemd services
      const { stdout } = await execAsync('systemctl list-units --type=service --all --no-pager --output=json');
      services = JSON.parse(stdout).map(service => ({
        name: service.unit,
        status: service.active,
        enabled: service.sub === 'running',
        description: service.description
      }));
    }

    res.json({
      success: true,
      data: services
    });
  } catch (error) {
    logger.error('Error getting services:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve services'
    });
  }
});

// Control service
router.post('/services/:name/:action',
  requirePermission('system:write'),
  [
    param('name').isLength({ min: 1 }).withMessage('Service name is required'),
    param('action').isIn(['start', 'stop', 'restart', 'enable', 'disable']).withMessage('Invalid action')
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

      const { name, action } = req.params;
      let command;

      if (config.SYSTEM.IS_WINDOWS) {
        switch (action) {
          case 'start':
            command = `sc start "${name}"`;
            break;
          case 'stop':
            command = `sc stop "${name}"`;
            break;
          case 'restart':
            command = `sc stop "${name}" && sc start "${name}"`;
            break;
          default:
            return res.status(400).json({
              success: false,
              message: 'Action not supported on Windows'
            });
        }
      } else {
        command = `systemctl ${action} ${name}`;
      }

      await execAsync(command);
      
      logger.info(`Service ${name} ${action} executed by user ${req.user.username}`);
      
      res.json({
        success: true,
        message: `Service ${name} ${action} completed successfully`
      });
    } catch (error) {
      logger.error('Error controlling service:', error);
      res.status(500).json({
        success: false,
        message: `Failed to ${req.params.action} service`
      });
    }
  }
);

// System logs
router.get('/logs/:logType', 
  requirePermission('system:read'),
  [
    param('logType').isIn(['system', 'auth', 'apache', 'nginx', 'mysql']).withMessage('Invalid log type')
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

      const { logType } = req.params;
      const { lines = 100 } = req.query;
      
      let logFile;
      
      if (config.SYSTEM.IS_WINDOWS) {
        // Windows Event Log
        const { stdout } = await execAsync(`powershell "Get-EventLog -LogName System -Newest ${lines} | ConvertTo-Json"`);
        const events = JSON.parse(stdout);
        
        return res.json({
          success: true,
          data: {
            type: logType,
            entries: events.map(event => ({
              timestamp: event.TimeGenerated,
              level: event.EntryType,
              source: event.Source,
              message: event.Message
            }))
          }
        });
      } else {
        // Linux log files
        const logFiles = {
          system: '/var/log/syslog',
          auth: '/var/log/auth.log',
          apache: '/var/log/apache2/error.log',
          nginx: '/var/log/nginx/error.log',
          mysql: '/var/log/mysql/error.log'
        };
        
        logFile = logFiles[logType];
        
        if (!logFile) {
          return res.status(400).json({
            success: false,
            message: 'Invalid log type'
          });
        }

        const { stdout } = await execAsync(`tail -n ${lines} "${logFile}" 2>/dev/null || echo "Log file not found"`);
        
        res.json({
          success: true,
          data: {
            type: logType,
            file: logFile,
            content: stdout
          }
        });
      }
    } catch (error) {
      logger.error('Error reading logs:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to read system logs'
      });
    }
  }
);

// Execute system command (admin only)
router.post('/execute',
  requireRole('admin'),
  [
    body('command').isLength({ min: 1 }).withMessage('Command is required'),
    body('timeout').optional().isInt({ min: 1000, max: 300000 }).withMessage('Timeout must be between 1-300 seconds')
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

      const { command, timeout = 30000 } = req.body;
      
      // Security: Block dangerous commands
      const dangerousCommands = [
        'rm -rf', 'del /f', 'format', 'fdisk', 'mkfs',
        'dd if=', 'shutdown', 'reboot', 'halt', 'poweroff'
      ];
      
      const isDangerous = dangerousCommands.some(dangerous => 
        command.toLowerCase().includes(dangerous.toLowerCase())
      );
      
      if (isDangerous) {
        return res.status(403).json({
          success: false,
          message: 'Command contains potentially dangerous operations'
        });
      }

      const { stdout, stderr } = await execAsync(command, { timeout });
      
      logger.info(`Command executed by ${req.user.username}: ${command}`);
      
      res.json({
        success: true,
        data: {
          command,
          stdout,
          stderr,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Error executing command:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Command execution failed'
      });
    }
  }
);

// System reboot/shutdown (admin only)
router.post('/power/:action',
  requireRole('admin'),
  [
    param('action').isIn(['reboot', 'shutdown']).withMessage('Invalid action'),
    body('delay').optional().isInt({ min: 0, max: 300 }).withMessage('Delay must be 0-300 seconds')
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

      const { action } = req.params;
      const { delay = 60 } = req.body;
      
      let command;
      
      if (config.SYSTEM.IS_WINDOWS) {
        command = action === 'reboot' 
          ? `shutdown /r /t ${delay}` 
          : `shutdown /s /t ${delay}`;
      } else {
        command = action === 'reboot' 
          ? `shutdown -r +${Math.ceil(delay / 60)}` 
          : `shutdown -h +${Math.ceil(delay / 60)}`;
      }
      
      // Execute with no wait
      exec(command);
      
      logger.warn(`System ${action} initiated by ${req.user.username} with ${delay}s delay`);
      
      res.json({
        success: true,
        message: `System ${action} scheduled in ${delay} seconds`
      });
    } catch (error) {
      logger.error('Error scheduling power action:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to schedule power action'
      });
    }
  }
);

// Helper function to parse Windows services
function parseWindowsServices(output) {
  const services = [];
  const lines = output.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('SERVICE_NAME:')) {
      const name = line.split(':')[1].trim();
      const statusLine = lines[i + 3];
      const status = statusLine ? statusLine.split(':')[1].trim() : 'UNKNOWN';
      
      services.push({
        name,
        status: status.includes('RUNNING') ? 'active' : 'inactive',
        enabled: true, // Windows services are typically enabled if they exist
        description: name
      });
    }
  }
  
  return services;
}

module.exports = router;