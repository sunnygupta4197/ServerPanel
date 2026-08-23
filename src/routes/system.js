const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const si = require('systeminformation');
const { requireRole, requirePermission } = require('../middleware/authMiddleware');
const { body, param, query, validationResult } = require('express-validator');
const logger = require('../config/logger');
const config = require('../config/config');
const broadcast = require('../sockets/broadcast');

const execFileAsync = promisify(execFile);

// Service/unit names: alnum start, then alnum/underscore/dot/@/dash. No '/' allowed.
const SERVICE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,127}$/;
const ALLOWED_KILL_SIGNALS = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2'];

// Race a promise against a timeout, returning fallback on timeout or error
const safe = (promise, fallback, ms = 3000) =>
  Promise.race([
    promise.catch(() => fallback),
    new Promise(resolve => setTimeout(() => resolve(fallback), ms))
  ]);

// Cache for slow/static system info (refreshes every 60s)
let _infoCache = null;
let _infoCacheAt = 0;

// System information endpoint
router.get('/info', requirePermission('system:read'), async (req, res) => {
  try {
    const now = Date.now();
    if (_infoCache && now - _infoCacheAt < 60000) {
      return res.json({ success: true, data: _infoCache });
    }

    const [cpu, memory, disks, network, system] = await Promise.all([
      safe(si.cpu(), {}),
      safe(si.mem(), { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem(), available: os.freemem() }),
      safe(si.fsSize(), []),
      safe(si.networkInterfaces(), []),
      safe(si.system(), {}),
    ]);

    const systemInfo = {
      system: {
        platform: os.platform(),
        hostname: os.hostname(),
        type: os.type(),
        arch: os.arch(),
        release: os.release(),
        uptime: os.uptime(),
        manufacturer: system.manufacturer || 'Unknown',
        model: system.model || 'Unknown',
        version: system.version || 'Unknown'
      },
      os: {
        platform: os.platform(),
        release: os.release(),
      },
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        speed: cpu.speed,
        cores: cpu.cores || os.cpus().length,
        physicalCores: cpu.physicalCores,
        processors: cpu.processors
      },
      memory: {
        total: memory.total,
        free: memory.free,
        used: memory.used,
        available: memory.available,
        usage: memory.total > 0 ? ((memory.used / memory.total) * 100).toFixed(2) : '0'
      },
      storage: disks.map(disk => ({
        filesystem: disk.fs,
        type: disk.type,
        size: disk.size,
        used: disk.used,
        available: disk.available,
        usage: disk.use,
        mount: disk.mount
      })),
      network: network.filter(i => !i.internal).map(iface => ({
        iface: iface.iface,
        type: iface.type,
        ip4: iface.ip4,
        ip6: iface.ip6,
        mac: iface.mac,
        speed: iface.speed,
        operstate: iface.operstate
      })),
    };

    _infoCache = systemInfo;
    _infoCacheAt = now;

    res.json({ success: true, data: systemInfo });
  } catch (error) {
    logger.error('Error getting system info:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve system information' });
  }
});

// Real-time system stats (fast path — no process enumeration)
router.get('/stats', requirePermission('system:read'), async (req, res) => {
  try {
    const [currentLoad, memory, temp] = await Promise.all([
      safe(si.currentLoad(), { currentload: 0, currentload_user: 0, currentload_system: 0, currentload_idle: 100 }),
      safe(si.mem(), { total: os.totalmem(), used: os.totalmem() - os.freemem(), free: os.freemem() }),
      safe(si.cpuTemperature(), { main: null }),
    ]);

    const stats = {
      timestamp: new Date().toISOString(),
      cpu: {
        usage: ((currentLoad.currentload ?? 0)).toFixed(2),
        user: ((currentLoad.currentload_user ?? 0)).toFixed(2),
        system: ((currentLoad.currentload_system ?? 0)).toFixed(2),
        idle: ((currentLoad.currentload_idle ?? 100)).toFixed(2),
        temperature: temp.main || null
      },
      memory: {
        total: memory.total,
        used: memory.used,
        free: memory.free,
        usage: memory.total > 0 ? ((memory.used / memory.total) * 100).toFixed(2) : '0'
      },
      loadAvg: os.loadavg()
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('Error getting system stats:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve system statistics' });
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
    param('pid').isInt({ min: 1 }).withMessage('Invalid process ID'),
    body('signal').optional().isIn(ALLOWED_KILL_SIGNALS).withMessage('Invalid signal')
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
        await execFileAsync('taskkill', ['/PID', String(pid), '/F']);
      } else {
        await execFileAsync('kill', [`-${signal}`, String(pid)]);
      }

      logger.info(`Process ${pid} killed by user ${req.user.username}`);
      broadcast.broadcastProcessChange({ pid: parseInt(pid), action: 'killed', signal });

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
      const { stdout } = await execFileAsync('sc', ['query', 'type=', 'service', 'state=', 'all']);
      // Parse Windows services output
      services = parseWindowsServices(stdout);
    } else {
      // Linux systemd services
      const { stdout } = await execFileAsync('systemctl', ['list-units', '--type=service', '--all', '--no-pager', '--output=json']);
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
    param('name').isLength({ min: 1, max: 128 }).withMessage('Service name is required')
      .matches(SERVICE_NAME_RE).withMessage('Service name contains invalid characters'),
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

      if (config.SYSTEM.IS_WINDOWS) {
        switch (action) {
          case 'start':
            await execFileAsync('sc', ['start', name]);
            break;
          case 'stop':
            await execFileAsync('sc', ['stop', name]);
            break;
          case 'restart':
            await execFileAsync('sc', ['stop', name]);
            await execFileAsync('sc', ['start', name]);
            break;
          default:
            return res.status(400).json({
              success: false,
              message: 'Action not supported on Windows'
            });
        }
      } else {
        await execFileAsync('systemctl', [action, name]);
      }

      logger.info(`Service ${name} ${action} executed by user ${req.user.username}`);
      broadcast.broadcastServiceStatus(name, action);

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
    param('logType').isIn(['system', 'auth', 'apache', 'nginx', 'mysql']).withMessage('Invalid log type'),
    query('lines').optional().isInt({ min: 1, max: 5000 }).withMessage('Lines must be between 1 and 5000')
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
      const lines = parseInt(req.query.lines, 10) || 100;

      let logFile;

      if (config.SYSTEM.IS_WINDOWS) {
        // Windows Event Log
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          'Get-EventLog -LogName System -Newest ([int]$env:SP_LOG_LINES) | ConvertTo-Json'
        ], { env: { ...process.env, SP_LOG_LINES: String(lines) } });
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

        const { stdout } = await execFileAsync('tail', ['-n', String(lines), logFile]);
        
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

      // Execute with no wait
      if (config.SYSTEM.IS_WINDOWS) {
        execFile('shutdown', action === 'reboot'
          ? ['/r', '/t', String(delay)]
          : ['/s', '/t', String(delay)]);
      } else {
        const minutes = `+${Math.ceil(delay / 60)}`;
        execFile('shutdown', action === 'reboot' ? ['-r', minutes] : ['-h', minutes]);
      }
      
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