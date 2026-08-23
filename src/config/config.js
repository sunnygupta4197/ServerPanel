const path = require('path');
const os = require('os');

// In production there is no safe default for a secret — booting with one
// means every token/session is signed with a value sitting in this repo.
// Dev/test keep a fallback so `npm run dev` and the test suite don't need
// any setup.
function requiredSecret(envVar, devFallback) {
  const value = process.env[envVar];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envVar} must be set when NODE_ENV=production — refusing to start with a default secret`);
  }
  return devFallback;
}

module.exports = {
  // Environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 3000,

  // Security
  JWT_SECRET: requiredSecret('JWT_SECRET', 'dev-only-jwt-secret-do-not-use-in-production'),
  JWT_EXPIRE: process.env.JWT_EXPIRE || '24h',
  SESSION_SECRET: requiredSecret('SESSION_SECRET', 'dev-only-session-secret-do-not-use-in-production'),
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS) || 12,
  
  // Database
  DATABASE: {
    client: process.env.DB_CLIENT || 'sqlite3',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'serverpanel',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'serverpanel',
      filename: process.env.DB_FILE || path.join(__dirname, '../../data/serverpanel.db')
    },
    migrations: {
      directory: path.join(__dirname, '../../migrations'),
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: path.join(__dirname, '../../seeds')
    }
  },
  
  // Redis (for sessions and caching)
  REDIS: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: process.env.REDIS_DB || 0
  },
  
  // File upload settings
  UPLOAD: {
    MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || '100MB',
    ALLOWED_EXTENSIONS: process.env.ALLOWED_EXTENSIONS?.split(',') || [
      '.txt', '.log', '.conf', '.json', '.xml', '.yml', '.yaml',
      '.js', '.css', '.html', '.php', '.py', '.sh', '.sql'
    ],
    UPLOAD_PATH: process.env.UPLOAD_PATH || path.join(__dirname, '../uploads'),
    TEMP_PATH: process.env.TEMP_PATH || path.join(os.tmpdir(), 'serverpanel')
  },
  
  // System paths
  PATHS: {
    LOGS: process.env.LOGS_PATH || path.join(__dirname, '../logs'),
    BACKUPS: process.env.BACKUPS_PATH || path.join(__dirname, '../backups'),
    CONFIGS: process.env.CONFIGS_PATH || path.join(__dirname, '../configs'),
    CERTIFICATES: process.env.CERTS_PATH || path.join(__dirname, '../certificates')
  },
  
  // System-specific configurations
  SYSTEM: {
    PLATFORM: os.platform(),
    IS_WINDOWS: os.platform() === 'win32',
    IS_LINUX: os.platform() === 'linux',
    HOME_DIR: os.homedir(),
    TEMP_DIR: os.tmpdir(),
    
    // Service management
    SERVICE_MANAGER: process.env.SERVICE_MANAGER || (os.platform() === 'win32' ? 'windows' : 'systemd'),
    
    // Web servers
    APACHE_CONFIG: process.env.APACHE_CONFIG || (os.platform() === 'win32' 
      ? 'C:/Apache24/conf/httpd.conf' 
      : '/etc/apache2/apache2.conf'),
    NGINX_CONFIG: process.env.NGINX_CONFIG || (os.platform() === 'win32'
      ? 'C:/nginx/conf/nginx.conf'
      : '/etc/nginx/nginx.conf'),
    
    // Common directories
    WEB_ROOT: process.env.WEB_ROOT || (os.platform() === 'win32'
      ? 'C:/inetpub/wwwroot'
      : '/var/www/html'),
    LOG_DIR: process.env.SYSTEM_LOG_DIR || (os.platform() === 'win32'
      ? 'C:/Windows/System32/LogFiles'
      : '/var/log')
  },
  
  // Email configuration
  EMAIL: {
    HOST: process.env.SMTP_HOST || 'localhost',
    PORT: process.env.SMTP_PORT || 587,
    SECURE: process.env.SMTP_SECURE === 'true',
    USER: process.env.SMTP_USER || '',
    PASS: process.env.SMTP_PASS || '',
    FROM: process.env.EMAIL_FROM || 'noreply@serverpanel.local'
  },
  
  // Monitoring settings
  MONITORING: {
    INTERVAL: process.env.MONITOR_INTERVAL || 30000, // 30 seconds
    RETENTION_DAYS: process.env.MONITOR_RETENTION || 30,
    ALERTS_ENABLED: process.env.ALERTS_ENABLED !== 'false',
    
    // Thresholds
    CPU_THRESHOLD: parseFloat(process.env.CPU_THRESHOLD) || 80,
    MEMORY_THRESHOLD: parseFloat(process.env.MEMORY_THRESHOLD) || 85,
    DISK_THRESHOLD: parseFloat(process.env.DISK_THRESHOLD) || 90,
    LOAD_THRESHOLD: parseFloat(process.env.LOAD_THRESHOLD) || 5.0
  },
  
  // Security settings
  SECURITY: {
    RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW || 15 * 60 * 1000, // 15 minutes
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || 100,
    PASSWORD_MIN_LENGTH: process.env.PASSWORD_MIN_LENGTH || 8,
    SESSION_TIMEOUT: process.env.SESSION_TIMEOUT || 24 * 60 * 60 * 1000, // 24 hours
    MAX_LOGIN_ATTEMPTS: process.env.MAX_LOGIN_ATTEMPTS || 5,
    LOCKOUT_TIME: process.env.LOCKOUT_TIME || 15 * 60 * 1000 // 15 minutes
  },
  
  // Backup settings
  BACKUP: {
    ENABLED: process.env.BACKUP_ENABLED !== 'false',
    SCHEDULE: process.env.BACKUP_SCHEDULE || '0 2 * * *', // Daily at 2 AM
    RETENTION_DAYS: process.env.BACKUP_RETENTION || 7,
    COMPRESSION: process.env.BACKUP_COMPRESSION !== 'false',
    ENCRYPTION: process.env.BACKUP_ENCRYPTION === 'true'
  },
  
  // Logging configuration
  LOGGING: {
    LEVEL: process.env.LOG_LEVEL || 'info',
    MAX_SIZE: process.env.LOG_MAX_SIZE || '10m',
    MAX_FILES: process.env.LOG_MAX_FILES || 5,
    ENABLE_CONSOLE: process.env.LOG_CONSOLE !== 'false',
    ENABLE_FILE: process.env.LOG_FILE !== 'false'
  },
  
  // Frontend configuration
  FRONTEND: {
    URL: process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3000}`,
    THEME: process.env.DEFAULT_THEME || 'dark',
    LANGUAGE: process.env.DEFAULT_LANGUAGE || 'en'
  },
  
  // API configuration
  API: {
    PREFIX: '/api',
    VERSION: 'v1',
    DOCS_ENABLED: process.env.API_DOCS !== 'false',
    DOCS_PATH: '/api/docs'
  },
  
  // Features toggle
  FEATURES: {
    FILE_MANAGER: process.env.FEATURE_FILE_MANAGER !== 'false',
    DATABASE_MANAGER: process.env.FEATURE_DATABASE !== 'false',
    SERVICE_MANAGER: process.env.FEATURE_SERVICES !== 'false',
    MONITORING: process.env.FEATURE_MONITORING !== 'false',
    BACKUP: process.env.FEATURE_BACKUP !== 'false',
    USER_MANAGEMENT: process.env.FEATURE_USERS !== 'false',
    EMAIL_ACCOUNTS: process.env.FEATURE_EMAIL !== 'false',
    SSL_MANAGER: process.env.FEATURE_SSL !== 'false',
    DOMAIN_MANAGER: process.env.FEATURE_DOMAINS !== 'false'
  }
};