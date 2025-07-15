const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Ensure logs directory exists
const logsDir = config.PATHS.LOGS;
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

// Console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} ${level}: ${stack || message}`;
  })
);

// Create transports array
const transports = [];

// Console transport (always enabled in development)
if (config.LOGGING.ENABLE_CONSOLE || config.NODE_ENV === 'development') {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: config.LOGGING.LEVEL
    })
  );
}

// File transports (if enabled)
if (config.LOGGING.ENABLE_FILE) {
  // Combined log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: logFormat,
      level: config.LOGGING.LEVEL,
      maxsize: config.LOGGING.MAX_SIZE || 10485760, // 10MB
      maxFiles: config.LOGGING.MAX_FILES || 5,
      tailable: true
    })
  );

  // Error log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      format: logFormat,
      level: 'error',
      maxsize: config.LOGGING.MAX_SIZE || 10485760, // 10MB
      maxFiles: config.LOGGING.MAX_FILES || 5,
      tailable: true
    })
  );

  // Security log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'security.log'),
      format: logFormat,
      level: 'warn',
      maxsize: config.LOGGING.MAX_SIZE || 10485760, // 10MB
      maxFiles: config.LOGGING.MAX_FILES || 5,
      tailable: true
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: config.LOGGING.LEVEL || 'info',
  format: logFormat,
  transports,
  exitOnError: false
});

// Add security logging methods
logger.security = (message, meta = {}) => {
  logger.warn(message, { ...meta, type: 'security' });
};

logger.audit = (action, user, resource, meta = {}) => {
  logger.info(`AUDIT: ${action}`, {
    user: user ? user.id || user.username : 'system',
    resource,
    ...meta,
    type: 'audit'
  });
};

logger.performance = (operation, duration, meta = {}) => {
  logger.info(`PERFORMANCE: ${operation} took ${duration}ms`, {
    ...meta,
    type: 'performance',
    duration
  });
};

// Handle uncaught exceptions
logger.exceptions.handle(
  new winston.transports.File({
    filename: path.join(logsDir, 'exceptions.log'),
    format: logFormat,
    maxsize: 10485760,
    maxFiles: 5
  })
);

// Handle unhandled promise rejections
logger.rejections.handle(
  new winston.transports.File({
    filename: path.join(logsDir, 'rejections.log'),
    format: logFormat,
    maxsize: 10485760,
    maxFiles: 5
  })
);

// Stream for Morgan HTTP logging
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

module.exports = logger;