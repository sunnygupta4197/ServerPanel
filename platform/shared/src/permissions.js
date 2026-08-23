const Permission = Object.freeze({
  SERVER_READ: 'server.read',
  SERVER_WRITE: 'server.write',
  APP_READ: 'app.read',
  APP_WRITE: 'app.write',
  APP_DEPLOY: 'app.deploy',
  DATABASE_READ: 'database.read',
  DATABASE_WRITE: 'database.write',
  BACKUP_READ: 'backup.read',
  BACKUP_WRITE: 'backup.write',
  CERTIFICATE_READ: 'certificate.read',
  CERTIFICATE_WRITE: 'certificate.write',
  JOB_READ: 'job.read',
  JOB_WRITE: 'job.write',
  AUDIT_READ: 'audit.read',
  SECRET_READ: 'secret.read',
  SECRET_WRITE: 'secret.write',
  POLICY_ADMIN: 'policy.admin',
  IDENTITY_ADMIN: 'identity.admin'
});

const Role = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  OPERATOR: 'operator',
  VIEWER: 'viewer'
});

const ROLE_PERMISSIONS = Object.freeze({
  [Role.OWNER]: Object.values(Permission),
  [Role.ADMIN]: [
    Permission.SERVER_READ,
    Permission.SERVER_WRITE,
    Permission.APP_READ,
    Permission.APP_WRITE,
    Permission.APP_DEPLOY,
    Permission.DATABASE_READ,
    Permission.DATABASE_WRITE,
    Permission.BACKUP_READ,
    Permission.BACKUP_WRITE,
    Permission.CERTIFICATE_READ,
    Permission.CERTIFICATE_WRITE,
    Permission.JOB_READ,
    Permission.JOB_WRITE,
    Permission.AUDIT_READ,
    Permission.SECRET_READ,
    Permission.SECRET_WRITE
  ],
  [Role.OPERATOR]: [
    Permission.SERVER_READ,
    Permission.APP_READ,
    Permission.APP_WRITE,
    Permission.APP_DEPLOY,
    Permission.DATABASE_READ,
    Permission.BACKUP_READ,
    Permission.CERTIFICATE_READ,
    Permission.JOB_READ
  ],
  [Role.VIEWER]: [
    Permission.SERVER_READ,
    Permission.APP_READ,
    Permission.DATABASE_READ,
    Permission.BACKUP_READ,
    Permission.CERTIFICATE_READ,
    Permission.JOB_READ,
    Permission.AUDIT_READ
  ]
});

module.exports = {
  Permission,
  Role,
  ROLE_PERMISSIONS
};
