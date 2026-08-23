const express = require('express');
const router = express.Router();
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const { requirePermission } = require('../middleware/authMiddleware');
const { body, param, query, validationResult } = require('express-validator');
const logger = require('../config/logger');
const config = require('../config/config');
const jobQueue = require('../jobs/jobQueue');
const broadcast = require('../sockets/broadcast');
const execFileAsync = promisify(execFile);

// Service/unit names: alnum start, then alnum/underscore/dot/@/dash.
// No '/' is allowed anywhere, which also rules out path traversal when the
// name is used to build a systemd unit file path.
const SERVICE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,127}$/;
const NO_NEWLINES_RE = /^[^\r\n]*$/;

const serviceNameValidator = (field, location = param) =>
  location(field)
    .isLength({ min: 1, max: 128 }).withMessage('Service name is required')
    .matches(SERVICE_NAME_RE).withMessage('Service name contains invalid characters');

// Get all services
router.get('/', requirePermission('services:read'), async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;

    let services = [];

    if (config.SYSTEM.IS_WINDOWS) {
      services = await getWindowsServices();
    } else {
      services = await getLinuxServices();
    }

    // Filter by status
    if (status) {
      services = services.filter(service =>
        service.status.toLowerCase() === status.toLowerCase()
      );
    }

    // Filter by search
    if (search) {
      const searchLower = search.toLowerCase();
      services = services.filter(service =>
        service.name.toLowerCase().includes(searchLower) ||
        service.displayName.toLowerCase().includes(searchLower) ||
        service.description.toLowerCase().includes(searchLower)
      );
    }

    // Pagination
    const offset = (page - 1) * limit;
    const paginatedServices = services.slice(offset, offset + limit);

    res.json({
      success: true,
      data: {
        services: paginatedServices,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: services.length,
          pages: Math.ceil(services.length / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Error getting services:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve services'
    });
  }
});

// Get specific service details
router.get('/:name',
  requirePermission('services:read'),
  [
    serviceNameValidator('name')
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

      const { name } = req.params;

      let service;
      if (config.SYSTEM.IS_WINDOWS) {
        service = await getWindowsServiceDetails(name);
      } else {
        service = await getLinuxServiceDetails(name);
      }

      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found'
        });
      }

      res.json({
        success: true,
        data: service
      });
    } catch (error) {
      logger.error('Error getting service details:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve service details'
      });
    }
  }
);

// Control service (start, stop, restart, enable, disable)
router.post('/:name/:action',
  requirePermission('services:write'),
  [
    serviceNameValidator('name'),
    param('action').isIn(['start', 'stop', 'restart', 'enable', 'disable', 'reload']).withMessage('Invalid action')
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

      // Security check - prevent control of critical system services
      if (isCriticalService(name)) {
        return res.status(403).json({
          success: false,
          message: 'Cannot control critical system services'
        });
      }

      // Dispatch as background job — respond immediately with job ID
      const job = jobQueue.createJob(
        'service_control',
        `${action} ${name}`,
        req.user.id
      );

      res.status(202).json({
        success: true,
        message: `Job queued: ${action} ${name}`,
        jobId: job.id
      });

      // Run the actual command in the background
      setImmediate(async () => {
        jobQueue.updateJob(job.id, { status: 'running' });
        try {
          let result;
          if (config.SYSTEM.IS_WINDOWS) {
            result = await controlWindowsService(name, action);
          } else {
            result = await controlLinuxService(name, action);
          }
          logger.info(`Service ${name} ${action} executed by user ${req.user.username}`);
          jobQueue.updateJob(job.id, { status: 'completed', progress: 100, result });
          broadcast.broadcastServiceStatus(name, action);
        } catch (error) {
          logger.error('Error controlling service:', error);
          jobQueue.updateJob(job.id, { status: 'failed', error: error.message });
        }
      });
    } catch (error) {
      logger.error('Error queuing service control job:', error);
      res.status(500).json({
        success: false,
        message: `Failed to queue ${req.params.action} for service`
      });
    }
  }
);

// Get service logs
router.get('/:name/logs',
  requirePermission('services:read'),
  [
    serviceNameValidator('name'),
    query('lines').optional().isInt({ min: 1, max: 10000 }).withMessage('Lines must be between 1 and 10000')
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

      const { name } = req.params;
      const lines = parseInt(req.query.lines, 10) || 100;

      let logs;
      if (config.SYSTEM.IS_WINDOWS) {
        logs = await getWindowsServiceLogs(name, lines);
      } else {
        logs = await getLinuxServiceLogs(name, lines);
      }

      res.json({
        success: true,
        data: {
          service: name,
          logs: logs,
          lines
        }
      });
    } catch (error) {
      logger.error('Error getting service logs:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve service logs'
      });
    }
  }
);

// Get service status summary
router.get('/status/summary', requirePermission('services:read'), async (req, res) => {
  try {
    let services = [];

    if (config.SYSTEM.IS_WINDOWS) {
      services = await getWindowsServices();
    } else {
      services = await getLinuxServices();
    }

    const summary = {
      total: services.length,
      running: services.filter(s => s.status === 'running' || s.status === 'active').length,
      stopped: services.filter(s => s.status === 'stopped' || s.status === 'inactive').length,
      failed: services.filter(s => s.status === 'failed').length,
      enabled: services.filter(s => s.enabled).length,
      disabled: services.filter(s => !s.enabled).length
    };

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    logger.error('Error getting service status summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve service status summary'
    });
  }
});

// Create custom service
router.post('/',
  requirePermission('services:write'),
  [
    serviceNameValidator('name', body),
    body('displayName').isLength({ min: 1, max: 255 }).withMessage('Display name is required')
      .matches(NO_NEWLINES_RE).withMessage('Display name must not contain line breaks'),
    body('description').optional().isLength({ max: 1000 }).withMessage('Description too long')
      .matches(NO_NEWLINES_RE).withMessage('Description must not contain line breaks'),
    body('execStart').isLength({ min: 1, max: 2000 }).withMessage('Exec start command is required')
      .matches(NO_NEWLINES_RE).withMessage('Exec start must not contain line breaks'),
    body('workingDirectory').optional().isLength({ min: 1, max: 1000 }).withMessage('Working directory must be specified')
      .matches(NO_NEWLINES_RE).withMessage('Working directory must not contain line breaks'),
    body('user').optional().isLength({ min: 1, max: 255 }).withMessage('User must be specified')
      .matches(NO_NEWLINES_RE).withMessage('User must not contain line breaks'),
    body('autoStart').optional().isBoolean().withMessage('Auto start must be boolean')
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

      const { name, displayName, description, execStart, workingDirectory, user, autoStart } = req.body;

      if (config.SYSTEM.IS_WINDOWS) {
        await createWindowsService(name, displayName, description, execStart, workingDirectory, user, autoStart);
      } else {
        await createLinuxService(name, displayName, description, execStart, workingDirectory, user, autoStart);
      }

      logger.info(`Custom service ${name} created by user ${req.user.username}`);

      res.status(201).json({
        success: true,
        message: 'Service created successfully'
      });
    } catch (error) {
      logger.error('Error creating service:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create service'
      });
    }
  }
);

// Delete custom service
router.delete('/:name',
  requirePermission('services:write'),
  [
    serviceNameValidator('name')
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

      const { name } = req.params;

      // Security check - prevent deletion of system services
      if (isCriticalService(name)) {
        return res.status(403).json({
          success: false,
          message: 'Cannot delete system services'
        });
      }

      if (config.SYSTEM.IS_WINDOWS) {
        await deleteWindowsService(name);
      } else {
        await deleteLinuxService(name);
      }

      logger.info(`Service ${name} deleted by user ${req.user.username}`);

      res.json({
        success: true,
        message: 'Service deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting service:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete service'
      });
    }
  }
);

// Helper functions
//
// All helpers below take `name` (and, where relevant, `lines`) only after it
// has passed SERVICE_NAME_RE / isInt validation in the route handlers above.
// They still avoid ever building a shell command string out of that input:
// Linux calls use execFile with an argv array (no shell involved at all),
// and Windows calls pass the value through an environment variable rather
// than interpolating it into the PowerShell script text, so even a bug in
// the upstream validation can't turn into command injection here.

// Get Windows services
async function getWindowsServices() {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-Service | ConvertTo-Json'
    ]);
    const services = JSON.parse(stdout);

    return (Array.isArray(services) ? services : [services]).map(service => ({
      name: service.Name,
      displayName: service.DisplayName,
      description: service.DisplayName,
      status: service.Status.toLowerCase(),
      enabled: service.StartType !== 'Disabled',
      startType: service.StartType,
      canStop: service.CanStop,
      canPause: service.CanPauseAndContinue
    }));
  } catch (error) {
    logger.error('Error getting Windows services:', error);
    return [];
  }
}

// Get Linux services
async function getLinuxServices() {
  try {
    const { stdout } = await execFileAsync('systemctl', [
      'list-units', '--type=service', '--all', '--no-pager', '--output=json'
    ]);
    const services = JSON.parse(stdout);

    return services.map(service => ({
      name: service.unit,
      displayName: service.unit,
      description: service.description,
      status: service.active,
      enabled: service.sub === 'running',
      startType: service.load,
      canStop: true,
      canPause: false
    }));
  } catch (error) {
    logger.error('Error getting Linux services:', error);
    return [];
  }
}

// Get Windows service details
async function getWindowsServiceDetails(name) {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-Service -Name $env:SVC_NAME | ConvertTo-Json'
    ], { env: { ...process.env, SVC_NAME: name } });
    const service = JSON.parse(stdout);

    return {
      name: service.Name,
      displayName: service.DisplayName,
      description: service.DisplayName,
      status: service.Status.toLowerCase(),
      enabled: service.StartType !== 'Disabled',
      startType: service.StartType,
      canStop: service.CanStop,
      canPause: service.CanPauseAndContinue
    };
  } catch (error) {
    return null;
  }
}

// Get Linux service details
async function getLinuxServiceDetails(name) {
  try {
    const { stdout } = await execFileAsync('systemctl', ['show', name, '--no-pager']);
    const lines = stdout.split('\n');
    const details = {};

    lines.forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        details[key] = value;
      }
    });

    return {
      name: details.Id,
      displayName: details.Id,
      description: details.Description,
      status: details.ActiveState,
      enabled: details.UnitFileState === 'enabled',
      startType: details.UnitFileState,
      canStop: details.CanStop === 'yes',
      canPause: false,
      memoryUsage: details.MemoryCurrent,
      processId: details.MainPID
    };
  } catch (error) {
    return null;
  }
}

// Control Windows service
async function controlWindowsService(name, action) {
  const scriptByAction = {
    start: 'Start-Service -Name $env:SVC_NAME',
    stop: 'Stop-Service -Name $env:SVC_NAME',
    restart: 'Restart-Service -Name $env:SVC_NAME',
    enable: 'Set-Service -Name $env:SVC_NAME -StartupType Automatic',
    disable: 'Set-Service -Name $env:SVC_NAME -StartupType Disabled'
  };

  const script = scriptByAction[action];
  if (!script) {
    throw new Error('Invalid action');
  }

  const { stdout, stderr } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', script
  ], { env: { ...process.env, SVC_NAME: name } });
  return { stdout, stderr };
}

// Control Linux service
async function controlLinuxService(name, action) {
  const validActions = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
  if (!validActions.includes(action)) {
    throw new Error('Invalid action');
  }

  const { stdout, stderr } = await execFileAsync('systemctl', [action, name]);
  return { stdout, stderr };
}

// Get Windows service logs
async function getWindowsServiceLogs(name, lines) {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-EventLog -LogName System -Source $env:SVC_NAME -Newest ([int]$env:SVC_LINES) | ConvertTo-Json'
    ], { env: { ...process.env, SVC_NAME: name, SVC_LINES: String(lines) } });
    const events = JSON.parse(stdout);

    return (Array.isArray(events) ? events : [events]).map(event => ({
      timestamp: event.TimeGenerated,
      level: event.EntryType,
      message: event.Message
    }));
  } catch (error) {
    return [];
  }
}

// Get Linux service logs
async function getLinuxServiceLogs(name, lines) {
  try {
    const { stdout } = await execFileAsync('journalctl', [
      '-u', name, '-n', String(lines), '--no-pager', '--output=json'
    ]);
    const logLines = stdout.split('\n').filter(line => line.trim());

    return logLines.map(line => {
      try {
        const entry = JSON.parse(line);
        return {
          timestamp: new Date(entry.__REALTIME_TIMESTAMP / 1000),
          level: entry.PRIORITY,
          message: entry.MESSAGE
        };
      } catch {
        return {
          timestamp: new Date(),
          level: 'info',
          message: line
        };
      }
    });
  } catch (error) {
    return [];
  }
}

// Create Linux service
async function createLinuxService(name, displayName, description, execStart, workingDirectory, user, autoStart) {
  const serviceContent = `[Unit]
Description=${description || displayName}
After=network.target

[Service]
Type=simple
User=${user || 'root'}
WorkingDirectory=${workingDirectory || '/'}
ExecStart=${execStart}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`;

  const servicePath = `/etc/systemd/system/${name}.service`;
  // Pipe the unit file content over stdin instead of embedding it in a shell
  // command string, so nothing in serviceContent can be interpreted by a shell.
  execFileSync('sudo', ['tee', servicePath], { input: serviceContent, stdio: ['pipe', 'ignore', 'inherit'] });
  await execFileAsync('sudo', ['systemctl', 'daemon-reload']);

  if (autoStart) {
    await execFileAsync('sudo', ['systemctl', 'enable', name]);
  }
}

// Create Windows service
async function createWindowsService(name, displayName, description, execStart, workingDirectory, user, autoStart) {
  const args = ['create', name, `binPath= ${execStart}`, `DisplayName= ${displayName}`];

  if (description) {
    args.push(`Description= ${description}`);
  }

  if (autoStart) {
    args.push('start=', 'auto');
  }

  await execFileAsync('sc', args);
}

// Delete Linux service
async function deleteLinuxService(name) {
  await execFileAsync('sudo', ['systemctl', 'stop', name]);
  await execFileAsync('sudo', ['systemctl', 'disable', name]);
  await execFileAsync('sudo', ['rm', '-f', `/etc/systemd/system/${name}.service`]);
  await execFileAsync('sudo', ['systemctl', 'daemon-reload']);
}

// Delete Windows service
async function deleteWindowsService(name) {
  await execFileAsync('sc', ['stop', name]);
  await execFileAsync('sc', ['delete', name]);
}

// Check if service is critical
function isCriticalService(name) {
  const criticalServices = [
    'kernel', 'init', 'systemd', 'kthreadd', 'ksoftirqd',
    'winlogon', 'csrss', 'wininit', 'services', 'lsass', 'smss',
    'sshd', 'networking', 'systemd-networkd', 'systemd-resolved',
    'dbus', 'avahi-daemon', 'bluetooth', 'cups'
  ];

  return criticalServices.some(critical =>
    name.toLowerCase().includes(critical.toLowerCase())
  );
}

module.exports = router;
