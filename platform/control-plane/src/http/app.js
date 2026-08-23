const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Permission } = require('../../../shared/src');
const { authenticateAgentRequest, authenticateRequest, requirePermission } = require('./auth-middleware');
const { createAuthService } = require('../services/auth-service');
const { createServerService } = require('../services/server-service');
const { createAgentService } = require('../services/agent-service');
const { createJobService } = require('../services/job-service');
const { createAppService } = require('../services/app-service');
const { createDatabaseService } = require('../services/database-service');
const { createCertificateService } = require('../services/certificate-service');
const { createBackupService } = require('../services/backup-service');

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    mfaEnabled: user.mfaEnabled,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt
  };
}

function createControlPlaneApp({ config, store }) {
  const app = express();
  const authRequired = authenticateRequest(config);
  const agentAuthRequired = authenticateAgentRequest(config);
  const authService = createAuthService({ config, store });
  const serverService = createServerService({ config, store });
  const agentService = createAgentService({ config, store });
  const jobService = createJobService({ store });
  const appService = createAppService({ store });
  const databaseService = createDatabaseService({ store });
  const certificateService = createCertificateService({ store });
  const backupService = createBackupService({ store });

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
  }));

  app.get('/health', (req, res) => {
    res.json({
      success: true,
      status: 'ok',
      service: 'serverpanel-control-plane',
      timestamp: new Date().toISOString()
    });
  });

  app.post('/api/v1/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const result = await authService.login({ email, password });
    if (!result) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    return res.json({
      success: true,
      token: result.token,
      user: sanitizeUser(result.user)
    });
  });

  app.get('/api/v1/auth/me', authRequired, async (req, res) => {
    const user = await store.findUserByEmail(req.auth.email);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.json({
      success: true,
      user: sanitizeUser(user)
    });
  });

  app.get('/api/v1/users', authRequired, requirePermission(Permission.IDENTITY_ADMIN), async (req, res) => {
    const users = await store.listUsers();
    res.json({
      success: true,
      data: users.map(sanitizeUser)
    });
  });

  app.get('/api/v1/servers', authRequired, requirePermission(Permission.SERVER_READ), async (req, res) => {
    const servers = await serverService.listServers();
    res.json({
      success: true,
      data: servers
    });
  });

  app.post('/api/v1/servers', authRequired, requirePermission(Permission.SERVER_WRITE), async (req, res) => {
    const { name, provider, hostname, environment, tags, capabilities } = req.body || {};
    if (!name || !provider) {
      return res.status(400).json({
        success: false,
        message: 'name and provider are required'
      });
    }

    const server = await serverService.createServer({
      name,
      provider,
      hostname,
      environment,
      tags: Array.isArray(tags) ? tags : [],
      capabilities: Array.isArray(capabilities) ? capabilities : []
    }, req.auth.userId);

    res.status(201).json({
      success: true,
      data: server
    });
  });

  app.post('/api/v1/servers/:serverId/enrollment-tokens', authRequired, requirePermission(Permission.SERVER_WRITE), async (req, res) => {
    const token = await serverService.issueEnrollmentToken(req.params.serverId, req.auth.userId);
    res.status(201).json({
      success: true,
      data: token
    });
  });

  app.get('/api/v1/agents', authRequired, requirePermission(Permission.SERVER_READ), async (req, res) => {
    const agents = await agentService.listAgents();
    res.json({
      success: true,
      data: agents
    });
  });

  app.post('/api/v1/agents/register', async (req, res) => {
    const { enrollmentToken, hostname, version, capabilities } = req.body || {};
    if (!enrollmentToken || !hostname) {
      return res.status(400).json({
        success: false,
        message: 'enrollmentToken and hostname are required'
      });
    }

    try {
      const result = await agentService.register({
        enrollmentToken,
        hostname,
        version,
        capabilities: Array.isArray(capabilities) ? capabilities : []
      });
      return res.status(201).json({
        success: true,
        token: result.token,
        agent: result.agent
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  });

  app.post('/api/v1/agents/heartbeat', agentAuthRequired, async (req, res) => {
    const updatedAgent = await agentService.heartbeat(req.agentAuth.agentId, req.body || {});
    res.json({
      success: true,
      data: updatedAgent
    });
  });

  app.get('/api/v1/apps', authRequired, requirePermission(Permission.APP_READ), async (req, res) => {
    const apps = await appService.listApps();
    res.json({
      success: true,
      data: apps
    });
  });

  app.post('/api/v1/apps', authRequired, requirePermission(Permission.APP_WRITE), async (req, res) => {
    const { name, serverId, runtime, sourceType, domains, deployRoot, healthCheckUrl } = req.body || {};
    if (!name || !serverId) {
      return res.status(400).json({
        success: false,
        message: 'name and serverId are required'
      });
    }

    try {
      const appResource = await appService.createApp({
        name,
        serverId,
        runtime,
        sourceType,
        domains: Array.isArray(domains) ? domains : [],
        deployRoot: deployRoot || null,
        healthCheckUrl: healthCheckUrl || null
      }, req.auth.userId);

      return res.status(201).json({
        success: true,
        data: appResource
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  });

  app.get('/api/v1/databases', authRequired, requirePermission(Permission.DATABASE_READ), async (req, res) => {
    const databases = await databaseService.listDatabases();
    res.json({
      success: true,
      data: databases
    });
  });

  app.post('/api/v1/databases', authRequired, requirePermission(Permission.DATABASE_WRITE), async (req, res) => {
    const { serverId, name, engine } = req.body || {};
    if (!serverId || !name) {
      return res.status(400).json({
        success: false,
        message: 'serverId and name are required'
      });
    }

    try {
      const database = await databaseService.createDatabase({
        serverId,
        name,
        engine
      }, req.auth.userId);

      return res.status(201).json({
        success: true,
        data: database
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  });

  app.get('/api/v1/certificates', authRequired, requirePermission(Permission.CERTIFICATE_READ), async (req, res) => {
    const certificates = await certificateService.listCertificates();
    res.json({
      success: true,
      data: certificates
    });
  });

  app.post('/api/v1/certificates', authRequired, requirePermission(Permission.CERTIFICATE_WRITE), async (req, res) => {
    const { serverId, domains, provider } = req.body || {};
    if (!serverId || !Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'serverId and non-empty domains are required'
      });
    }

    try {
      const certificate = await certificateService.createCertificate({
        serverId,
        domains,
        provider: provider || 'letsencrypt'
      }, req.auth.userId);

      return res.status(201).json({
        success: true,
        data: certificate
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  });

  app.get('/api/v1/backups', authRequired, requirePermission(Permission.BACKUP_READ), async (req, res) => {
    const backups = await backupService.listBackups();
    res.json({
      success: true,
      data: backups
    });
  });

  app.post('/api/v1/backups', authRequired, requirePermission(Permission.BACKUP_WRITE), async (req, res) => {
    const { serverId, targetResourceType, targetResourceId, storageProvider } = req.body || {};
    if (!serverId || !targetResourceType || !targetResourceId) {
      return res.status(400).json({
        success: false,
        message: 'serverId, targetResourceType, and targetResourceId are required'
      });
    }

    try {
      const backup = await backupService.createBackup({
        serverId,
        targetResourceType,
        targetResourceId,
        storageProvider: storageProvider || 'local'
      }, req.auth.userId);

      return res.status(201).json({
        success: true,
        data: backup
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  });

  app.get('/api/v1/jobs', authRequired, requirePermission(Permission.JOB_READ), async (req, res) => {
    const jobs = await jobService.listJobs();
    res.json({
      success: true,
      data: jobs
    });
  });

  app.get('/api/v1/jobs/:jobId', authRequired, requirePermission(Permission.JOB_READ), async (req, res) => {
    const job = await jobService.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    res.json({
      success: true,
      data: job
    });
  });

  app.post('/api/v1/jobs', authRequired, requirePermission(Permission.JOB_WRITE), async (req, res) => {
    const { type, resourceType, resourceId, targetServerId, input } = req.body || {};
    if (!type || !resourceType || !resourceId) {
      return res.status(400).json({
        success: false,
        message: 'type, resourceType, and resourceId are required'
      });
    }

    try {
      const job = await jobService.dispatchJob({
        type,
        resourceType,
        resourceId,
        targetServerId: targetServerId || null,
        requestedByUserId: req.auth.userId,
        input: input || {}
      }, req.auth.userId);

      return res.status(201).json({
        success: true,
        data: job
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  });

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: 'Route not found'
    });
  });

  return app;
}

module.exports = {
  createControlPlaneApp
};
