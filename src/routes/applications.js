const express = require('express');
const router = express.Router();
const { exec, execFile, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { requirePermission, requireRole } = require('../middleware/authMiddleware');
const { body, param, query, validationResult } = require('express-validator');
const logger = require('../config/logger');
const config = require('../config/config');
const database = require('../config/database');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Application catalog with popular applications
const APPLICATION_CATALOG = {
  // Web Applications
  wordpress: {
    name: 'WordPress',
    description: 'Popular content management system',
    category: 'cms',
    version: 'latest',
    requirements: {
      php: '>=7.4',
      mysql: '>=5.7',
      webServer: ['apache2', 'nginx']
    },
    downloadUrl: 'https://wordpress.org/latest.zip',
    installScript: 'wordpress-install.sh',
    icon: 'wordpress.png',
    tags: ['cms', 'blog', 'website'],
    size: '50MB',
    license: 'GPL'
  },
  nextcloud: {
    name: 'Nextcloud',
    description: 'Self-hosted cloud storage and collaboration platform',
    category: 'productivity',
    version: 'latest',
    requirements: {
      php: '>=8.0',
      mysql: '>=8.0',
      webServer: ['apache2', 'nginx'],
      modules: ['php-gd', 'php-curl', 'php-zip']
    },
    downloadUrl: 'https://download.nextcloud.com/server/releases/latest.zip',
    installScript: 'nextcloud-install.sh',
    icon: 'nextcloud.png',
    tags: ['cloud', 'storage', 'collaboration'],
    size: '180MB',
    license: 'AGPL'
  },
  phpmyadmin: {
    name: 'phpMyAdmin',
    description: 'Web-based MySQL administration tool',
    category: 'database',
    version: 'latest',
    requirements: {
      php: '>=7.2',
      mysql: '>=5.5'
    },
    downloadUrl: 'https://files.phpmyadmin.net/phpMyAdmin/5.2.1/phpMyAdmin-5.2.1-all-languages.zip',
    installScript: 'phpmyadmin-install.sh',
    icon: 'phpmyadmin.png',
    tags: ['database', 'mysql', 'admin'],
    size: '15MB',
    license: 'GPL'
  },
  
  // Development Tools
  nodejs: {
    name: 'Node.js',
    description: 'JavaScript runtime for server-side development',
    category: 'development',
    version: '18.x',
    requirements: {
      os: ['linux', 'windows']
    },
    installScript: 'nodejs-install.sh',
    icon: 'nodejs.png',
    tags: ['javascript', 'runtime', 'development'],
    size: '50MB',
    license: 'MIT'
  },
  docker: {
    name: 'Docker',
    description: 'Container platform for application deployment',
    category: 'development',
    version: 'latest',
    requirements: {
      os: ['linux'],
      kernel: '>=3.10'
    },
    installScript: 'docker-install.sh',
    icon: 'docker.png',
    tags: ['containers', 'virtualization', 'deployment'],
    size: '100MB',
    license: 'Apache'
  },
  
  // Databases
  mysql: {
    name: 'MySQL Server',
    description: 'Popular relational database management system',
    category: 'database',
    version: '8.0',
    requirements: {
      ram: '>=2GB',
      disk: '>=10GB'
    },
    installScript: 'mysql-install.sh',
    icon: 'mysql.png',
    tags: ['database', 'sql', 'relational'],
    size: '200MB',
    license: 'GPL'
  },
  postgresql: {
    name: 'PostgreSQL',
    description: 'Advanced open source relational database',
    category: 'database',
    version: '15',
    requirements: {
      ram: '>=1GB',
      disk: '>=5GB'
    },
    installScript: 'postgresql-install.sh',
    icon: 'postgresql.png',
    tags: ['database', 'sql', 'relational'],
    size: '150MB',
    license: 'PostgreSQL'
  },
  redis: {
    name: 'Redis',
    description: 'In-memory data structure store',
    category: 'database',
    version: '7.x',
    requirements: {
      ram: '>=512MB'
    },
    installScript: 'redis-install.sh',
    icon: 'redis.png',
    tags: ['cache', 'nosql', 'memory'],
    size: '10MB',
    license: 'BSD'
  },
  
  // Web Servers
  nginx: {
    name: 'Nginx',
    description: 'High-performance web server and reverse proxy',
    category: 'webserver',
    version: 'latest',
    requirements: {
      ram: '>=256MB'
    },
    installScript: 'nginx-install.sh',
    icon: 'nginx.png',
    tags: ['webserver', 'proxy', 'performance'],
    size: '15MB',
    license: 'BSD'
  },
  apache2: {
    name: 'Apache HTTP Server',
    description: 'Popular open-source web server',
    category: 'webserver',
    version: '2.4',
    requirements: {
      ram: '>=512MB'
    },
    installScript: 'apache2-install.sh',
    icon: 'apache.png',
    tags: ['webserver', 'http', 'modules'],
    size: '25MB',
    license: 'Apache'
  },
  
  // Monitoring Tools
  grafana: {
    name: 'Grafana',
    description: 'Open source analytics and monitoring platform',
    category: 'monitoring',
    version: 'latest',
    requirements: {
      ram: '>=1GB',
      disk: '>=2GB'
    },
    installScript: 'grafana-install.sh',
    icon: 'grafana.png',
    tags: ['monitoring', 'analytics', 'dashboards'],
    size: '80MB',
    license: 'AGPL'
  },
  prometheus: {
    name: 'Prometheus',
    description: 'Systems monitoring and alerting toolkit',
    category: 'monitoring',
    version: 'latest',
    requirements: {
      ram: '>=2GB',
      disk: '>=5GB'
    },
    installScript: 'prometheus-install.sh',
    icon: 'prometheus.png',
    tags: ['monitoring', 'metrics', 'alerting'],
    size: '60MB',
    license: 'Apache'
  }
};

// Get application catalog
router.get('/catalog', requirePermission('apps:read'), async (req, res) => {
  try {
    const { category, search, tags } = req.query;
    let apps = Object.entries(APPLICATION_CATALOG).map(([id, app]) => ({
      id,
      ...app
    }));
    
    // Filter by category
    if (category) {
      apps = apps.filter(app => app.category === category);
    }
    
    // Filter by search term
    if (search) {
      const searchLower = search.toLowerCase();
      apps = apps.filter(app => 
        app.name.toLowerCase().includes(searchLower) ||
        app.description.toLowerCase().includes(searchLower) ||
        app.tags.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }
    
    // Filter by tags
    if (tags) {
      const tagList = tags.split(',');
      apps = apps.filter(app => 
        tagList.some(tag => app.tags.includes(tag.trim()))
      );
    }
    
    // Get installation status for each app
    const appsWithStatus = await Promise.all(apps.map(async (app) => {
      const installation = await database('installed_applications')
        .where('app_id', app.id)
        .where('status', 'installed')
        .first();
        
      return {
        ...app,
        isInstalled: !!installation,
        installedVersion: installation ? installation.version : null,
        installedAt: installation ? installation.installed_at : null
      };
    }));
    
    res.json({
      success: true,
      data: {
        applications: appsWithStatus,
        categories: [...new Set(Object.values(APPLICATION_CATALOG).map(app => app.category))],
        total: appsWithStatus.length
      }
    });
  } catch (error) {
    logger.error('Error getting application catalog:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve application catalog'
    });
  }
});

// Get installed applications
router.get('/installed', requirePermission('apps:read'), async (req, res) => {
  try {
    const installations = await database('installed_applications')
      .select('*')
      .orderBy('installed_at', 'desc');
    
    const installedApps = installations.map(installation => {
      const catalogApp = APPLICATION_CATALOG[installation.app_id];
      return {
        ...installation,
        ...catalogApp,
        installationId: installation.id
      };
    });
    
    res.json({
      success: true,
      data: installedApps
    });
  } catch (error) {
    logger.error('Error getting installed applications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve installed applications'
    });
  }
});

// Install application
router.post('/install/:appId',
  requirePermission('apps:install'),
  [
    param('appId').isString().withMessage('Application ID is required'),
    body('domain').optional().isString().withMessage('Domain must be a string'),
    body('installPath').optional().isString().withMessage('Install path must be a string'),
    body('config').optional().isObject().withMessage('Configuration must be an object')
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

      const { appId } = req.params;
      const { domain, installPath, config: appConfig = {} } = req.body;
      
      const app = APPLICATION_CATALOG[appId];
      if (!app) {
        return res.status(404).json({
          success: false,
          message: 'Application not found in catalog'
        });
      }
      
      // Check if already installed
      const existingInstallation = await database('installed_applications')
        .where('app_id', appId)
        .where('status', 'installed')
        .first();
        
      if (existingInstallation) {
        return res.status(409).json({
          success: false,
          message: 'Application is already installed'
        });
      }
      
      // Check system requirements
      const requirementCheck = await checkRequirements(app.requirements);
      if (!requirementCheck.met) {
        return res.status(400).json({
          success: false,
          message: 'System requirements not met',
          missingRequirements: requirementCheck.missing
        });
      }
      
      // Create installation record
      const [installationId] = await database('installed_applications').insert({
        app_id: appId,
        name: app.name,
        version: app.version,
        install_path: installPath || `/var/www/${appId}`,
        domain: domain || 'localhost',
        config: JSON.stringify(appConfig),
        status: 'installing',
        installed_by: req.user.id,
        installed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      });
      
      // Start installation process
      const installation = await startInstallation(installationId, appId, {
        domain,
        installPath: installPath || `/var/www/${appId}`,
        config: appConfig,
        userId: req.user.id
      });
      
      res.json({
        success: true,
        message: 'Application installation started',
        data: {
          installationId,
          status: 'installing',
          estimatedTime: installation.estimatedTime
        }
      });
      
    } catch (error) {
      logger.error('Error installing application:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start application installation'
      });
    }
  }
);

// Get installation status
router.get('/install/:installationId/status', requirePermission('apps:read'), async (req, res) => {
  try {
    const { installationId } = req.params;
    
    const installation = await database('installed_applications')
      .where('id', installationId)
      .first();
      
    if (!installation) {
      return res.status(404).json({
        success: false,
        message: 'Installation not found'
      });
    }
    
    // Get installation logs
    const logs = await database('installation_logs')
      .where('installation_id', installationId)
      .orderBy('created_at', 'desc')
      .limit(50);
    
    res.json({
      success: true,
      data: {
        status: installation.status,
        progress: installation.progress || 0,
        logs: logs.map(log => ({
          timestamp: log.created_at,
          level: log.level,
          message: log.message
        })),
        startedAt: installation.installed_at,
        completedAt: installation.completed_at,
        errorMessage: installation.error_message
      }
    });
  } catch (error) {
    logger.error('Error getting installation status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get installation status'
    });
  }
});

// Uninstall application
router.delete('/uninstall/:installationId',
  requirePermission('apps:uninstall'),
  async (req, res) => {
    try {
      const { installationId } = req.params;
      
      const installation = await database('installed_applications')
        .where('id', installationId)
        .first();
        
      if (!installation) {
        return res.status(404).json({
          success: false,
          message: 'Installation not found'
        });
      }
      
      // Start uninstallation process
      await startUninstallation(installationId, installation, req.user.id);
      
      res.json({
        success: true,
        message: 'Application uninstallation started'
      });
      
    } catch (error) {
      logger.error('Error uninstalling application:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start application uninstallation'
      });
    }
  }
);

// Update application
router.post('/update/:installationId',
  requirePermission('apps:update'),
  async (req, res) => {
    try {
      const { installationId } = req.params;
      
      const installation = await database('installed_applications')
        .where('id', installationId)
        .first();
        
      if (!installation) {
        return res.status(404).json({
          success: false,
          message: 'Installation not found'
        });
      }
      
      const app = APPLICATION_CATALOG[installation.app_id];
      if (!app) {
        return res.status(404).json({
          success: false,
          message: 'Application not found in catalog'
        });
      }
      
      // Check if update is available
      if (installation.version === app.version) {
        return res.status(400).json({
          success: false,
          message: 'Application is already up to date'
        });
      }
      
      // Start update process
      await startUpdate(installationId, installation, app, req.user.id);
      
      res.json({
        success: true,
        message: 'Application update started'
      });
      
    } catch (error) {
      logger.error('Error updating application:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start application update'
      });
    }
  }
);

// Get application configuration
router.get('/:installationId/config', requirePermission('apps:read'), async (req, res) => {
  try {
    const { installationId } = req.params;
    
    const installation = await database('installed_applications')
      .where('id', installationId)
      .first();
      
    if (!installation) {
      return res.status(404).json({
        success: false,
        message: 'Installation not found'
      });
    }
    
    const config = JSON.parse(installation.config || '{}');
    
    res.json({
      success: true,
      data: {
        config,
        installPath: installation.install_path,
        domain: installation.domain,
        version: installation.version
      }
    });
  } catch (error) {
    logger.error('Error getting application configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get application configuration'
    });
  }
});

// Update application configuration
router.put('/:installationId/config',
  requirePermission('apps:configure'),
  [
    body('config').isObject().withMessage('Configuration must be an object')
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

      const { installationId } = req.params;
      const { config } = req.body;
      
      const installation = await database('installed_applications')
        .where('id', installationId)
        .first();
        
      if (!installation) {
        return res.status(404).json({
          success: false,
          message: 'Installation not found'
        });
      }
      
      // Update configuration
      await database('installed_applications')
        .where('id', installationId)
        .update({
          config: JSON.stringify(config),
          updated_at: new Date()
        });
      
      // Apply configuration changes
      await applyConfigurationChanges(installation, config);
      
      res.json({
        success: true,
        message: 'Configuration updated successfully'
      });
      
    } catch (error) {
      logger.error('Error updating application configuration:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update application configuration'
      });
    }
  }
);

// Helper functions
async function checkRequirements(requirements) {
  const missing = [];
  let met = true;
  
  try {
    // Check PHP version
    if (requirements.php) {
      try {
        const { stdout } = await execAsync('php --version');
        const phpVersion = stdout.match(/PHP (\d+\.\d+)/);
        if (!phpVersion || !satisfiesVersion(phpVersion[1], requirements.php)) {
          missing.push(`PHP ${requirements.php}`);
          met = false;
        }
      } catch {
        missing.push(`PHP ${requirements.php}`);
        met = false;
      }
    }
    
    // Check MySQL
    if (requirements.mysql) {
      try {
        const { stdout } = await execAsync('mysql --version');
        const mysqlVersion = stdout.match(/(\d+\.\d+)/);
        if (!mysqlVersion || !satisfiesVersion(mysqlVersion[1], requirements.mysql)) {
          missing.push(`MySQL ${requirements.mysql}`);
          met = false;
        }
      } catch {
        missing.push(`MySQL ${requirements.mysql}`);
        met = false;
      }
    }
    
    // Check web server
    if (requirements.webServer) {
      const hasWebServer = await Promise.all(
        requirements.webServer.map(async (server) => {
          try {
            await execFileAsync('which', [server]);
            return true;
          } catch {
            return false;
          }
        })
      );
      
      if (!hasWebServer.some(Boolean)) {
        missing.push(`Web server (${requirements.webServer.join(' or ')})`);
        met = false;
      }
    }
    
    // Check RAM
    if (requirements.ram) {
      const totalRam = require('os').totalmem();
      const requiredRam = parseSize(requirements.ram);
      if (totalRam < requiredRam) {
        missing.push(`RAM ${requirements.ram}`);
        met = false;
      }
    }
    
    // Check disk space
    if (requirements.disk) {
      const { stdout } = await execAsync("df / | tail -1 | awk '{print $4}'");
      const availableSpace = parseInt(stdout.trim()) * 1024; // Convert from KB to bytes
      const requiredSpace = parseSize(requirements.disk);
      if (availableSpace < requiredSpace) {
        missing.push(`Disk space ${requirements.disk}`);
        met = false;
      }
    }
    
  } catch (error) {
    logger.error('Error checking requirements:', error);
    met = false;
  }
  
  return { met, missing };
}

function satisfiesVersion(current, required) {
  const parseVersion = (v) => v.replace(/[^\d.]/g, '').split('.').map(Number);
  const currentParts = parseVersion(current);
  const requiredParts = parseVersion(required.replace('>=', ''));
  
  for (let i = 0; i < Math.max(currentParts.length, requiredParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const requiredPart = requiredParts[i] || 0;
    
    if (currentPart > requiredPart) return true;
    if (currentPart < requiredPart) return false;
  }
  
  return true;
}

function parseSize(sizeStr) {
  const units = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([A-Z]{1,2})$/i);
  if (!match) return 0;
  return parseFloat(match[1]) * (units[match[2].toUpperCase()] || 1);
}

async function startInstallation(installationId, appId, options) {
  // This would typically spawn a background process
  // For now, we'll simulate with a simple implementation
  
  const app = APPLICATION_CATALOG[appId];
  const estimatedTime = getEstimatedInstallTime(appId);
  
  // Log installation start
  await logInstallation(installationId, 'info', 'Installation started');
  
  // Simulate installation process (in production, this would be a real installer)
  setTimeout(async () => {
    try {
      await runInstallationScript(appId, options);
      
      // Update status to completed
      await database('installed_applications')
        .where('id', installationId)
        .update({
          status: 'installed',
          progress: 100,
          completed_at: new Date(),
          updated_at: new Date()
        });
      
      await logInstallation(installationId, 'info', 'Installation completed successfully');
      
    } catch (error) {
      // Update status to failed
      await database('installed_applications')
        .where('id', installationId)
        .update({
          status: 'failed',
          error_message: error.message,
          updated_at: new Date()
        });
      
      await logInstallation(installationId, 'error', `Installation failed: ${error.message}`);
    }
  }, 1000); // Start after 1 second
  
  return { estimatedTime };
}

async function runInstallationScript(appId, options) {
  const app = APPLICATION_CATALOG[appId];
  const scriptPath = path.join(__dirname, '../scripts/installers', app.installScript);
  
  // Check if custom install script exists
  if (await fs.access(scriptPath).then(() => true).catch(() => false)) {
    // Run custom installation script
    const { stdout, stderr } = await execFileAsync('bash', [scriptPath], {
      env: {
        ...process.env,
        INSTALL_PATH: options.installPath,
        DOMAIN: options.domain,
        CONFIG: JSON.stringify(options.config)
      }
    });
    
    if (stderr) {
      throw new Error(stderr);
    }
    
    return stdout;
  } else {
    // Use generic installation based on app type
    return await genericInstallation(appId, options);
  }
}

async function genericInstallation(appId, options) {
  const app = APPLICATION_CATALOG[appId];
  
  // Create installation directory
  await fs.mkdir(options.installPath, { recursive: true });
  
  // Download application if URL provided
  if (app.downloadUrl) {
    await downloadAndExtract(app.downloadUrl, options.installPath);
  }
  
  // Set permissions
  if (config.SYSTEM.IS_WINDOWS) {
    // Windows permissions
    await execFileAsync('icacls', [options.installPath, '/grant', 'IIS_IUSRS:F']);
  } else {
    // Linux permissions
    await execFileAsync('chown', ['-R', 'www-data:www-data', options.installPath]);
    await execFileAsync('chmod', ['-R', '755', options.installPath]);
  }
  
  return 'Generic installation completed';
}

async function downloadAndExtract(url, destination) {
  // This is a simplified implementation
  // In production, you'd want proper download progress tracking
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  
  const tempFile = path.join(destination, 'download.zip');
  await fs.writeFile(tempFile, Buffer.from(buffer));
  
  // Extract zip file
  await fs.createReadStream(tempFile)
    .pipe(unzipper.Extract({ path: destination }))
    .promise();
  
  // Clean up
  await fs.unlink(tempFile);
}

function getEstimatedInstallTime(appId) {
  const times = {
    wordpress: '2-5 minutes',
    nextcloud: '5-10 minutes',
    phpmyadmin: '1-3 minutes',
    nodejs: '3-7 minutes',
    docker: '5-15 minutes',
    mysql: '10-20 minutes',
    postgresql: '8-15 minutes',
    redis: '2-5 minutes',
    nginx: '2-5 minutes',
    apache2: '3-7 minutes',
    grafana: '5-10 minutes',
    prometheus: '5-12 minutes'
  };
  
  return times[appId] || '5-10 minutes';
}

async function logInstallation(installationId, level, message) {
  await database('installation_logs').insert({
    installation_id: installationId,
    level,
    message,
    created_at: new Date()
  });
}

async function startUninstallation(installationId, installation, userId) {
  // Implementation for uninstalling applications
  // This would remove files, database entries, configurations, etc.
}

async function startUpdate(installationId, installation, app, userId) {
  // Implementation for updating applications
  // This would backup current version, install new version, migrate data, etc.
}

async function applyConfigurationChanges(installation, config) {
  // Implementation for applying configuration changes
  // This would update config files, restart services, etc.
}

module.exports = router;