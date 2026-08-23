const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const unzipper = require('unzipper');
const { requirePermission } = require('../middleware/authMiddleware');
const { body, param, validationResult } = require('express-validator');
const logger = require('../config/logger');
const config = require('../config/config');
const database = require('../config/database');
const jobQueue = require('../jobs/jobQueue');

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
    requirements: { os: ['linux', 'windows'] },
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
    requirements: { os: ['linux'], kernel: '>=3.10' },
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
    requirements: { ram: '>=2GB', disk: '>=10GB' },
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
    requirements: { ram: '>=1GB', disk: '>=5GB' },
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
    requirements: { ram: '>=512MB' },
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
    requirements: { ram: '>=256MB' },
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
    requirements: { ram: '>=512MB' },
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
    requirements: { ram: '>=1GB', disk: '>=2GB' },
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
    requirements: { ram: '>=2GB', disk: '>=5GB' },
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
    let apps = Object.entries(APPLICATION_CATALOG).map(([id, app]) => ({ id, ...app }));

    if (category) {
      apps = apps.filter(app => app.category === category);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      apps = apps.filter(app =>
        app.name.toLowerCase().includes(searchLower) ||
        app.description.toLowerCase().includes(searchLower) ||
        app.tags.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }

    if (tags) {
      const tagList = tags.split(',');
      apps = apps.filter(app => tagList.some(tag => app.tags.includes(tag.trim())));
    }

    const appsWithStatus = await Promise.all(apps.map(async (app) => {
      const installation = await database('installed_applications')
        .where('app_id', app.id)
        .whereIn('status', ['installed', 'installing', 'updating', 'uninstalling', 'failed'])
        .orderBy('id', 'desc')
        .first();

      return {
        ...app,
        isInstalled: installation ? installation.status === 'installed' : false,
        installationStatus: installation ? installation.status : null,
        installationId: installation ? installation.id : null,
        installedVersion: installation && installation.status === 'installed' ? installation.version : null,
        installedAt: installation && installation.status === 'installed' ? installation.installed_at : null
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
    res.status(500).json({ success: false, message: 'Failed to retrieve application catalog' });
  }
});

// Get installed applications
router.get('/installed', requirePermission('apps:read'), async (req, res) => {
  try {
    const installations = await database('installed_applications').select('*').orderBy('installed_at', 'desc');

    const installedApps = installations.map(installation => {
      const catalogApp = APPLICATION_CATALOG[installation.app_id];
      return {
        ...installation,
        ...catalogApp,
        // Preserve the DB's own copies over the catalog's, in case they diverge
        name: installation.name,
        version: installation.version,
        installationId: installation.id
      };
    });

    res.json({ success: true, data: installedApps });
  } catch (error) {
    logger.error('Error getting installed applications:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve installed applications' });
  }
});

// Install application
router.post('/install/:appId',
  requirePermission('apps:install'),
  [
    param('appId').isString().withMessage('Application ID is required'),
    body('domain').optional().isString().isLength({ max: 255 }).withMessage('Domain must be a string'),
    body('installPath').optional().isString().isLength({ max: 500 }).withMessage('Install path must be a string'),
    body('config').optional().isObject().withMessage('Configuration must be an object')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { appId } = req.params;
      const { domain, installPath, config: appConfig = {} } = req.body;

      const app = APPLICATION_CATALOG[appId];
      if (!app) {
        return res.status(404).json({ success: false, message: 'Application not found in catalog' });
      }

      const existingInstallation = await database('installed_applications')
        .where('app_id', appId)
        .where('status', 'installed')
        .first();

      if (existingInstallation) {
        return res.status(409).json({ success: false, message: 'Application is already installed' });
      }

      const requirementCheck = await checkRequirements(app.requirements);
      if (!requirementCheck.met) {
        return res.status(400).json({
          success: false,
          message: 'System requirements not met',
          missingRequirements: requirementCheck.missing
        });
      }

      const resolvedInstallPath = installPath || defaultInstallPath(appId);
      const resolvedDomain = domain || 'localhost';

      const [installationId] = await database('installed_applications').insert({
        app_id: appId,
        name: app.name,
        version: app.version,
        install_path: resolvedInstallPath,
        domain: resolvedDomain,
        config: JSON.stringify(appConfig),
        status: 'installing',
        progress: 0,
        installed_by: req.user.id,
        installed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      });

      const job = jobQueue.createJob('app_install', `Install ${app.name}`, req.user.id);
      await logInstallation(installationId, 'info', 'Installation queued');

      res.status(202).json({
        success: true,
        message: 'Application installation started',
        data: {
          installationId,
          jobId: job.id,
          status: 'installing',
          estimatedTime: getEstimatedInstallTime(appId)
        }
      });

      setImmediate(async () => {
        jobQueue.updateJob(job.id, { status: 'running', progress: 0 });
        try {
          const provisioned = await runInstallation(installationId, appId, {
            domain: resolvedDomain,
            installPath: resolvedInstallPath,
            config: appConfig,
            userId: req.user.id,
            onProgress: (progress, message) => {
              jobQueue.updateJob(job.id, { progress });
              database('installed_applications').where('id', installationId).update({ progress, updated_at: new Date() }).catch(() => {});
              if (message) logInstallation(installationId, 'info', message).catch(() => {});
            }
          });

          await database('installed_applications').where('id', installationId).update({
            status: 'installed',
            progress: 100,
            config: JSON.stringify({ ...appConfig, ...provisioned }),
            completed_at: new Date(),
            updated_at: new Date()
          });
          await logInstallation(installationId, 'info', 'Installation completed successfully');
          jobQueue.updateJob(job.id, { status: 'completed', progress: 100 });
        } catch (error) {
          logger.error(`Error installing application ${appId}:`, error);
          await database('installed_applications').where('id', installationId).update({
            status: 'failed',
            error_message: error.message,
            updated_at: new Date()
          }).catch(() => {});
          await logInstallation(installationId, 'error', `Installation failed: ${error.message}`).catch(() => {});
          jobQueue.updateJob(job.id, { status: 'failed', error: error.message });
        }
      });
    } catch (error) {
      logger.error('Error installing application:', error);
      res.status(500).json({ success: false, message: 'Failed to start application installation' });
    }
  }
);

// Get installation status
router.get('/install/:installationId/status', requirePermission('apps:read'), async (req, res) => {
  try {
    const { installationId } = req.params;

    const installation = await database('installed_applications').where('id', installationId).first();
    if (!installation) {
      return res.status(404).json({ success: false, message: 'Installation not found' });
    }

    const logs = await database('installation_logs')
      .where('installation_id', installationId)
      .orderBy('created_at', 'desc')
      .limit(50);

    res.json({
      success: true,
      data: {
        status: installation.status,
        progress: installation.progress || 0,
        logs: logs.map(log => ({ timestamp: log.created_at, level: log.level, message: log.message })),
        startedAt: installation.installed_at,
        completedAt: installation.completed_at,
        errorMessage: installation.error_message
      }
    });
  } catch (error) {
    logger.error('Error getting installation status:', error);
    res.status(500).json({ success: false, message: 'Failed to get installation status' });
  }
});

// Uninstall application
router.delete('/uninstall/:installationId',
  requirePermission('apps:uninstall'),
  [param('installationId').isInt()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { installationId } = req.params;
      const installation = await database('installed_applications').where('id', installationId).first();

      if (!installation) {
        return res.status(404).json({ success: false, message: 'Installation not found' });
      }

      await database('installed_applications').where('id', installationId).update({
        status: 'uninstalling',
        updated_at: new Date()
      });

      const job = jobQueue.createJob('app_uninstall', `Uninstall ${installation.name}`, req.user.id);

      res.status(202).json({ success: true, message: 'Application uninstallation started', data: { jobId: job.id } });

      setImmediate(async () => {
        jobQueue.updateJob(job.id, { status: 'running' });
        try {
          await startUninstallation(installationId, installation);
          jobQueue.updateJob(job.id, { status: 'completed', progress: 100 });
        } catch (error) {
          logger.error(`Error uninstalling application ${installation.app_id}:`, error);
          await database('installed_applications').where('id', installationId).update({
            status: 'failed',
            error_message: `Uninstall failed: ${error.message}`,
            updated_at: new Date()
          }).catch(() => {});
          await logInstallation(installationId, 'error', `Uninstall failed: ${error.message}`).catch(() => {});
          jobQueue.updateJob(job.id, { status: 'failed', error: error.message });
        }
      });
    } catch (error) {
      logger.error('Error uninstalling application:', error);
      res.status(500).json({ success: false, message: 'Failed to start application uninstallation' });
    }
  }
);

// Update application — not implemented; say so rather than faking success
router.post('/update/:installationId', requirePermission('apps:update'), async (req, res) => {
  const installation = await database('installed_applications').where('id', req.params.installationId).first();
  if (!installation) {
    return res.status(404).json({ success: false, message: 'Installation not found' });
  }
  res.status(501).json({
    success: false,
    message: 'In-place application updates are not implemented yet. Uninstall and reinstall the newer version instead.'
  });
});

// Get application configuration
router.get('/:installationId/config', requirePermission('apps:read'), async (req, res) => {
  try {
    const { installationId } = req.params;
    const installation = await database('installed_applications').where('id', installationId).first();

    if (!installation) {
      return res.status(404).json({ success: false, message: 'Installation not found' });
    }

    const cfg = JSON.parse(installation.config || '{}');
    res.json({
      success: true,
      data: {
        config: cfg,
        installPath: installation.install_path,
        domain: installation.domain,
        version: installation.version
      }
    });
  } catch (error) {
    logger.error('Error getting application configuration:', error);
    res.status(500).json({ success: false, message: 'Failed to get application configuration' });
  }
});

// Update application configuration — not implemented; say so rather than faking success
router.put('/:installationId/config',
  requirePermission('apps:configure'),
  [body('config').isObject().withMessage('Configuration must be an object')],
  async (req, res) => {
    const installation = await database('installed_applications').where('id', req.params.installationId).first();
    if (!installation) {
      return res.status(404).json({ success: false, message: 'Installation not found' });
    }
    res.status(501).json({
      success: false,
      message: 'Applying configuration changes to an installed application is not implemented yet.'
    });
  }
);

// Helper functions

function defaultInstallPath(appId) {
  const base = config.SYSTEM.IS_WINDOWS ? 'C:\\inetpub\\wwwroot' : (config.SYSTEM.WEB_ROOT || '/var/www');
  return path.join(base, appId);
}

async function checkRequirements(requirements) {
  const missing = [];
  let met = true;

  try {
    if (requirements.php) {
      try {
        const { stdout } = await execFileAsync('php', ['--version']);
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

    if (requirements.mysql) {
      try {
        const { stdout } = await execFileAsync('mysql', ['--version']);
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

    if (requirements.ram) {
      const totalRam = require('os').totalmem();
      const requiredRam = parseSize(requirements.ram);
      if (totalRam < requiredRam) {
        missing.push(`RAM ${requirements.ram}`);
        met = false;
      }
    }

    if (requirements.disk) {
      try {
        const { stdout } = await execFileAsync('df', ['-k', '/']);
        const line = stdout.trim().split('\n').pop();
        const availableKb = parseInt(line.trim().split(/\s+/)[3], 10);
        const availableSpace = availableKb * 1024;
        const requiredSpace = parseSize(requirements.disk);
        if (availableSpace < requiredSpace) {
          missing.push(`Disk space ${requirements.disk}`);
          met = false;
        }
      } catch {
        // Can't determine disk space (e.g. Windows) — don't block install on it
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
  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([A-Z]{1,2})$/i);
  if (!match) return 0;
  return parseFloat(match[1]) * (units[match[2].toUpperCase()] || 1);
}

// Runs the real install: download+extract, permissions, DB provisioning
// (when the DB engine supports it), and web server vhost generation.
// Reports incremental progress via options.onProgress(percent, logMessage).
async function runInstallation(installationId, appId, options) {
  const app = APPLICATION_CATALOG[appId];
  const scriptPath = path.join(__dirname, '../scripts/installers', app.installScript || '');
  const hasCustomScript = app.installScript && await fs.access(scriptPath).then(() => true).catch(() => false);

  if (hasCustomScript) {
    options.onProgress(10, `Running custom install script for ${app.name}`);
    const { stdout } = await execFileAsync('bash', [scriptPath], {
      env: {
        ...process.env,
        INSTALL_PATH: options.installPath,
        DOMAIN: options.domain,
        CONFIG: JSON.stringify(options.config)
      }
    });
    options.onProgress(100, 'Custom install script finished');
    return { scriptOutput: stdout };
  }

  return genericInstallation(appId, options);
}

async function genericInstallation(appId, options) {
  const app = APPLICATION_CATALOG[appId];
  const resultConfig = {};

  options.onProgress(5, `Creating install directory ${options.installPath}`);
  await fs.mkdir(options.installPath, { recursive: true });

  if (app.downloadUrl) {
    options.onProgress(15, `Downloading ${app.name} (${app.size})`);
    await downloadAndExtract(app.downloadUrl, options.installPath);
    options.onProgress(55, 'Download extracted');
  }

  options.onProgress(65, 'Setting file permissions');
  if (config.SYSTEM.IS_WINDOWS) {
    await execFileAsync('icacls', [options.installPath, '/grant', 'IIS_IUSRS:F']).catch(err =>
      logger.warn(`Could not set Windows permissions for ${options.installPath}:`, err.message));
  } else {
    await execFileAsync('chown', ['-R', 'www-data:www-data', options.installPath]).catch(err =>
      logger.warn(`Could not chown ${options.installPath} (may need to run as root):`, err.message));
    await execFileAsync('chmod', ['-R', '755', options.installPath]).catch(err =>
      logger.warn(`Could not chmod ${options.installPath}:`, err.message));
  }

  if (app.requirements && app.requirements.mysql) {
    options.onProgress(75, 'Provisioning database');
    const dbInfo = await provisionDatabase(appId, installationIdSafeName(appId));
    if (dbInfo) {
      resultConfig.database = dbInfo;
      options.onProgress(85, `Database ${dbInfo.database} provisioned`);
    } else {
      options.onProgress(85, 'Database provisioning skipped (unsupported DB engine for this panel) — configure manually');
    }
  }

  if (app.requirements && app.requirements.webServer) {
    options.onProgress(92, 'Generating web server configuration');
    const vhostInfo = await generateVhostConfig(appId, options.domain, options.installPath);
    resultConfig.vhost = vhostInfo;
  }

  options.onProgress(98, 'Finalizing installation');

  return resultConfig;
}

function installationIdSafeName(appId) {
  return `${appId}_${crypto.randomBytes(4).toString('hex')}`;
}

// Actually provisions a real database + user for mysql/postgres. Skipped
// (not simulated) for sqlite, since a single-file DB has no equivalent of
// CREATE DATABASE/CREATE USER — an app needing its own SQLite file should
// get one via its own install script instead.
async function provisionDatabase(appId, uniqueSuffix) {
  const client = database.client.config.client;
  const dbName = `app_${uniqueSuffix}`.slice(0, 64);
  const dbUser = dbName;
  const dbPassword = crypto.randomBytes(18).toString('base64url');

  try {
    if (client === 'mysql' || client === 'mysql2') {
      await database.raw('CREATE DATABASE ??', [dbName]);
      await database.raw('CREATE USER ?@? IDENTIFIED BY ?', [dbUser, '%', dbPassword]);
      await database.raw('GRANT ALL PRIVILEGES ON ??.* TO ?@?', [dbName, dbUser, '%']);
      await database.raw('FLUSH PRIVILEGES');
    } else if (client === 'pg') {
      await database.raw('CREATE DATABASE ??', [dbName]);
      await database.raw('CREATE USER ?? WITH ENCRYPTED PASSWORD ?', [dbUser, dbPassword]);
      await database.raw('GRANT ALL PRIVILEGES ON DATABASE ?? TO ??', [dbName, dbUser]);
    } else {
      return null;
    }
  } catch (error) {
    logger.error(`Database provisioning failed for app db ${dbName}:`, error);
    throw new Error(`Database provisioning failed: ${error.message}`);
  }

  const host = database.client.config.connection.host || 'localhost';
  const port = database.client.config.connection.port || (client === 'pg' ? 5432 : 3306);
  return { engine: client, host, port, database: dbName, user: dbUser, password: dbPassword };
}

// Writes a real nginx or apache vhost config file to config.PATHS.CONFIGS.
// Best-effort activation (symlink into sites-enabled + reload) only if the
// standard paths exist — never hard-fails the install if they don't, since
// distro layouts vary and this runs on Windows too.
async function generateVhostConfig(appId, domain, installPath) {
  const vhostDir = path.join(config.PATHS.CONFIGS, 'vhosts');
  await fs.mkdir(vhostDir, { recursive: true });

  const usesNginx = await execFileAsync('which', ['nginx']).then(() => true).catch(() => false);
  const fileName = `${appId}-${(domain || 'localhost').replace(/[^a-zA-Z0-9.-]/g, '_')}.conf`;
  const vhostPath = path.join(vhostDir, fileName);

  const contents = usesNginx
    ? `server {\n    listen 80;\n    server_name ${domain};\n    root ${installPath};\n    index index.php index.html;\n\n    location / {\n        try_files $uri $uri/ /index.php?$args;\n    }\n\n    location ~ \\.php$ {\n        include snippets/fastcgi-php.conf;\n        fastcgi_pass unix:/run/php/php-fpm.sock;\n    }\n}\n`
    : `<VirtualHost *:80>\n    ServerName ${domain}\n    DocumentRoot ${installPath}\n    <Directory ${installPath}>\n        AllowOverride All\n        Require all granted\n    </Directory>\n</VirtualHost>\n`;

  await fs.writeFile(vhostPath, contents, 'utf8');

  let activated = false;
  if (!config.SYSTEM.IS_WINDOWS) {
    const sitesAvailable = usesNginx ? '/etc/nginx/sites-available' : '/etc/apache2/sites-available';
    const sitesEnabled = usesNginx ? '/etc/nginx/sites-enabled' : '/etc/apache2/sites-enabled';
    const hasStandardLayout = await fs.access(sitesAvailable).then(() => true).catch(() => false);

    if (hasStandardLayout) {
      try {
        const availablePath = path.join(sitesAvailable, fileName);
        await fs.copyFile(vhostPath, availablePath);
        await execFileAsync('ln', ['-sf', availablePath, path.join(sitesEnabled, fileName)]);
        await execFileAsync(usesNginx ? 'nginx' : 'apache2ctl', usesNginx ? ['-s', 'reload'] : ['graceful']).catch(err =>
          logger.warn('Vhost written and linked but reload failed — reload the web server manually:', err.message));
        activated = true;
      } catch (error) {
        logger.warn(`Could not auto-activate vhost for ${domain}, config was still written to ${vhostPath}:`, error.message);
      }
    }
  }

  return { path: vhostPath, server: usesNginx ? 'nginx' : 'apache', activated };
}

async function downloadAndExtract(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();

  const tempFile = path.join(destination, `download-${Date.now()}.zip`);
  await fs.writeFile(tempFile, Buffer.from(buffer));

  await fsSync.createReadStream(tempFile)
    .pipe(unzipper.Extract({ path: destination }))
    .promise();

  await fs.unlink(tempFile);
}

function getEstimatedInstallTime(appId) {
  const times = {
    wordpress: '2-5 minutes', nextcloud: '5-10 minutes', phpmyadmin: '1-3 minutes',
    nodejs: '3-7 minutes', docker: '5-15 minutes', mysql: '10-20 minutes',
    postgresql: '8-15 minutes', redis: '2-5 minutes', nginx: '2-5 minutes',
    apache2: '3-7 minutes', grafana: '5-10 minutes', prometheus: '5-12 minutes'
  };
  return times[appId] || '5-10 minutes';
}

async function logInstallation(installationId, level, message) {
  await database('installation_logs').insert({ installation_id: installationId, level, message, created_at: new Date() });
}

// Real uninstall: removes the install directory, drops any provisioned
// database, removes the generated vhost, and deletes the installation
// record (installed_applications.status has no terminal "uninstalled"
// value — a fully-removed app simply has no row, same as backups/domains).
async function startUninstallation(installationId, installation) {
  const cfg = JSON.parse(installation.config || '{}');

  if (installation.install_path) {
    await fs.rm(installation.install_path, { recursive: true, force: true }).catch(error =>
      logger.warn(`Could not remove install directory ${installation.install_path}:`, error.message));
    await logInstallation(installationId, 'info', `Removed ${installation.install_path}`);
  }

  if (cfg.database && cfg.database.database) {
    try {
      const client = database.client.config.client;
      if (client === 'mysql' || client === 'mysql2') {
        await database.raw('DROP DATABASE IF EXISTS ??', [cfg.database.database]);
        await database.raw('DROP USER IF EXISTS ?@?', [cfg.database.user, '%']);
      } else if (client === 'pg') {
        await database.raw('DROP DATABASE IF EXISTS ??', [cfg.database.database]);
        await database.raw('DROP USER IF EXISTS ??', [cfg.database.user]);
      }
      await logInstallation(installationId, 'info', `Dropped database ${cfg.database.database}`);
    } catch (error) {
      logger.warn(`Could not drop provisioned database for installation ${installationId}:`, error.message);
      await logInstallation(installationId, 'warn', `Could not drop database: ${error.message}`);
    }
  }

  if (cfg.vhost && cfg.vhost.path) {
    await fs.unlink(cfg.vhost.path).catch(() => {});
  }

  await database('installed_applications').where('id', installationId).del();
  logger.info(`Application installation ${installationId} (${installation.app_id}) removed`);
}

module.exports = router;
