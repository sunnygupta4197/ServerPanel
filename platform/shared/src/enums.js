const ServerProvider = Object.freeze({
  SELF_HOSTED: 'self_hosted',
  HETZNER: 'hetzner',
  DIGITALOCEAN: 'digitalocean',
  AWS: 'aws',
  GCP: 'gcp',
  AZURE: 'azure'
});

const ServerStatus = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
  DRAINING: 'draining',
  DECOMMISSIONED: 'decommissioned'
});

const JobStatus = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
  TIMED_OUT: 'timed_out'
});

const JobType = Object.freeze({
  SERVER_REGISTER: 'server.register',
  SERVER_SYNC: 'server.sync',
  APP_CREATE: 'app.create',
  APP_DEPLOY: 'app.deploy',
  APP_RESTART: 'app.restart',
  DOMAIN_ATTACH: 'domain.attach',
  CERTIFICATE_ISSUE: 'certificate.issue',
  DATABASE_PROVISION: 'database.provision',
  BACKUP_CREATE: 'backup.create',
  BACKUP_RESTORE: 'backup.restore'
});

const ResourceType = Object.freeze({
  USER: 'user',
  TEAM: 'team',
  SERVER: 'server',
  APP: 'app',
  DOMAIN: 'domain',
  CERTIFICATE: 'certificate',
  DATABASE: 'database',
  BACKUP: 'backup',
  JOB: 'job'
});

module.exports = {
  JobStatus,
  JobType,
  ResourceType,
  ServerProvider,
  ServerStatus
};
