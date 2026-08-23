const AgentActionType = Object.freeze({
  FILE_READ: 'file.read',
  FILE_WRITE: 'file.write',
  FILE_DELETE: 'file.delete',
  FILE_LIST: 'file.list',
  DIRECTORY_CREATE: 'directory.create',
  SERVICE_STATUS: 'service.status',
  SERVICE_CONTROL: 'service.control',
  PROCESS_RESTART: 'process.restart',
  DATABASE_PROVISION: 'database.provision',
  DATABASE_BACKUP: 'database.backup',
  DATABASE_RESTORE: 'database.restore',
  CERTIFICATE_ISSUE: 'certificate.issue',
  PROXY_RENDER: 'proxy.render',
  APP_DEPLOY: 'app.deploy',
  APP_HEALTHCHECK: 'app.healthcheck',
  METRICS_COLLECT: 'metrics.collect'
});

module.exports = {
  AgentActionType
};
