const { body, param, query, validationResult } = require('express-validator');
const logger = require('../config/logger');
const config = require('../config/config');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    logger.warn('Validation failed', {
      ip: req.ip,
      endpoint: req.originalUrl,
      errors: errors.array(),
      user: req.user ? req.user.username : 'anonymous'
    });
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.param,
        message: error.msg,
        value: error.value,
        location: error.location
      }))
    });
  }
  
  next();
};

// Common validation rules
const validationRules = {
  // User validation
  username: () => body('username')
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9_.-]+$/)
    .withMessage('Username can only contain letters, numbers, dots, hyphens, and underscores'),
  
  email: () => body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  password: () => body('password')
    .isLength({ min: config.SECURITY.PASSWORD_MIN_LENGTH || 8 })
    .withMessage(`Password must be at least ${config.SECURITY.PASSWORD_MIN_LENGTH || 8} characters long`)
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  
  confirmPassword: () => body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return value;
    }),
  
  // File validation
  filename: () => body('filename')
    .isLength({ min: 1, max: 255 })
    .withMessage('Filename must be between 1 and 255 characters')
    .matches(/^[^<>:"/\\|?*\x00-\x1f]+$/)
    .withMessage('Filename contains invalid characters'),
  
  filePath: () => body('path')
    .isLength({ min: 1, max: 4096 })
    .withMessage('File path must be between 1 and 4096 characters')
    .custom((value) => {
      // Check for directory traversal attempts
      if (value.includes('..') || value.includes('~')) {
        throw new Error('File path contains invalid sequences');
      }
      return true;
    }),
  
  // System validation
  serviceName: () => param('name')
    .isLength({ min: 1, max: 100 })
    .withMessage('Service name must be between 1 and 100 characters')
    .matches(/^[a-zA-Z0-9._-]+$/)
    .withMessage('Service name can only contain letters, numbers, dots, hyphens, and underscores'),
  
  processId: () => param('pid')
    .isInt({ min: 1, max: 65535 })
    .withMessage('Process ID must be a valid integer between 1 and 65535'),
  
  // Query validation
  pagination: () => [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Limit must be between 1 and 1000')
  ],
  
  dateRange: () => [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Start date must be a valid ISO 8601 date'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('End date must be a valid ISO 8601 date')
      .custom((value, { req }) => {
        if (req.query.startDate && value) {
          const startDate = new Date(req.query.startDate);
          const endDate = new Date(value);
          if (endDate <= startDate) {
            throw new Error('End date must be after start date');
          }
        }
        return true;
      })
  ],
  
  // Monitoring validation
  threshold: () => body('threshold')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Threshold must be a number between 0 and 100'),
  
  alertType: () => body('alertType')
    .isIn(['info', 'warning', 'error', 'critical'])
    .withMessage('Alert type must be one of: info, warning, error, critical'),
  
  // Database validation
  databaseName: () => body('database')
    .isLength({ min: 1, max: 64 })
    .withMessage('Database name must be between 1 and 64 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Database name can only contain letters, numbers, and underscores'),
  
  // IP validation
  ipAddress: () => body('ip')
    .isIP()
    .withMessage('Please provide a valid IP address'),
  
  // URL validation
  url: () => body('url')
    .isURL()
    .withMessage('Please provide a valid URL'),
  
  // UUID validation
  uuid: () => param('id')
    .isUUID()
    .withMessage('Please provide a valid UUID'),
  
  // JSON validation
  jsonData: () => body('data')
    .custom((value) => {
      if (typeof value === 'string') {
        try {
          JSON.parse(value);
        } catch (error) {
          throw new Error('Data must be valid JSON');
        }
      }
      return true;
    }),
  
  // Command validation
  command: () => body('command')
    .isLength({ min: 1, max: 1000 })
    .withMessage('Command must be between 1 and 1000 characters')
    .custom((value) => {
      // Block potentially dangerous commands
      const dangerousCommands = [
        'rm -rf', 'del /f', 'format', 'fdisk', 'mkfs',
        'shutdown', 'reboot', 'halt', 'poweroff', 'init 0', 'init 6',
        'dd if=', 'cat /dev/zero', ':(){ :|:& };:', 'chmod 777',
        'chown root', 'passwd', 'su -', 'sudo su', 'history -c'
      ];
      
      const lowerCommand = value.toLowerCase();
      const isDangerous = dangerousCommands.some(dangerous => 
        lowerCommand.includes(dangerous.toLowerCase())
      );
      
      if (isDangerous) {
        throw new Error('Command contains potentially dangerous operations');
      }
      
      return true;
    }),
  
  // Configuration validation
  configKey: () => body('key')
    .isLength({ min: 1, max: 100 })
    .withMessage('Configuration key must be between 1 and 100 characters')
    .matches(/^[a-zA-Z0-9._-]+$/)
    .withMessage('Configuration key can only contain letters, numbers, dots, hyphens, and underscores'),
  
  configValue: () => body('value')
    .isLength({ min: 0, max: 1000 })
    .withMessage('Configuration value must be less than 1000 characters'),
  
  // Time validation
  timeRange: () => query('timeRange')
    .optional()
    .isIn(['1h', '6h', '12h', '24h', '7d', '30d'])
    .withMessage('Time range must be one of: 1h, 6h, 12h, 24h, 7d, 30d'),
  
  // Size validation
  fileSize: () => body('size')
    .optional()
    .isInt({ min: 0 })
    .withMessage('File size must be a positive integer'),
  
  // Permission validation
  permissions: () => body('permissions')
    .optional()
    .isArray()
    .withMessage('Permissions must be an array')
    .custom((value) => {
      const validPermissions = [
        'system:read', 'system:write', 'system:execute',
        'files:read', 'files:write', 'files:delete',
        'users:read', 'users:write', 'users:delete',
        'services:read', 'services:write',
        'database:read', 'database:write',
        'monitoring:read', 'monitoring:write',
        'settings:read', 'settings:write'
      ];
      
      for (const permission of value) {
        if (!validPermissions.includes(permission)) {
          throw new Error(`Invalid permission: ${permission}`);
        }
      }
      
      return true;
    }),
  
  // Role validation
  role: () => body('role')
    .isIn(['admin', 'user', 'viewer'])
    .withMessage('Role must be one of: admin, user, viewer'),
  
  // Boolean validation
  boolean: (field) => body(field)
    .isBoolean()
    .withMessage(`${field} must be a boolean value`),
  
  // Integer validation
  integer: (field, min = 0, max = Number.MAX_SAFE_INTEGER) => body(field)
    .isInt({ min, max })
    .withMessage(`${field} must be an integer between ${min} and ${max}`),
  
  // Array validation
  array: (field) => body(field)
    .isArray()
    .withMessage(`${field} must be an array`),
  
  // Object validation
  object: (field) => body(field)
    .isObject()
    .withMessage(`${field} must be an object`)
};

// Validation middleware factories
const validateRequest = (rules) => {
  return [
    ...rules,
    handleValidationErrors
  ];
};

const validateLogin = validateRequest([
  validationRules.username(),
  validationRules.password()
]);

const validateRegistration = validateRequest([
  validationRules.username(),
  validationRules.email(),
  validationRules.password(),
  validationRules.confirmPassword()
]);

const validatePasswordChange = validateRequest([
  body('currentPassword')
    .isLength({ min: 1 })
    .withMessage('Current password is required'),
  validationRules.password().withMessage('New password must meet requirements')
]);

const validateFileUpload = validateRequest([
  body('filename')
    .optional()
    .isLength({ min: 1, max: 255 })
    .withMessage('Filename must be between 1 and 255 characters')
]);

const validateFileOperation = validateRequest([
  validationRules.filePath(),
  body('operation')
    .isIn(['copy', 'move', 'delete', 'rename'])
    .withMessage('Operation must be one of: copy, move, delete, rename')
]);

const validateServiceControl = validateRequest([
  validationRules.serviceName(),
  param('action')
    .isIn(['start', 'stop', 'restart', 'enable', 'disable', 'reload'])
    .withMessage('Action must be one of: start, stop, restart, enable, disable, reload')
]);

const validateProcessControl = validateRequest([
  validationRules.processId(),
  body('signal')
    .optional()
    .isIn(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP'])
    .withMessage('Signal must be one of: SIGTERM, SIGKILL, SIGINT, SIGHUP')
]);

const validateMonitoringConfig = validateRequest([
  body('thresholds')
    .optional()
    .isObject()
    .withMessage('Thresholds must be an object'),
  body('thresholds.cpu')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('CPU threshold must be between 0 and 100'),
  body('thresholds.memory')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Memory threshold must be between 0 and 100'),
  body('thresholds.disk')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Disk threshold must be between 0 and 100')
]);

const validateDatabaseOperation = validateRequest([
  validationRules.databaseName(),
  body('operation')
    .isIn(['create', 'drop', 'backup', 'restore'])
    .withMessage('Operation must be one of: create, drop, backup, restore')
]);

const validateUserManagement = validateRequest([
  validationRules.username(),
  validationRules.email(),
  validationRules.role(),
  validationRules.permissions()
]);

const validateApiKey = validateRequest([
  body('name')
    .isLength({ min: 1, max: 100 })
    .withMessage('API key name must be between 1 and 100 characters'),
  body('permissions')
    .isArray()
    .withMessage('Permissions must be an array'),
  body('expiresIn')
    .optional()
    .isInt({ min: 3600 })
    .withMessage('Expiration must be at least 1 hour (3600 seconds)')
]);

const validateBackupConfig = validateRequest([
  body('schedule')
    .optional()
    .matches(/^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/)
    .withMessage('Schedule must be a valid cron expression'),
  body('retention')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('Retention must be between 1 and 365 days'),
  body('compress')
    .optional()
    .isBoolean()
    .withMessage('Compress must be a boolean value'),
  body('encrypt')
    .optional()
    .isBoolean()
    .withMessage('Encrypt must be a boolean value')
]);

// Custom validation functions
const validateArrayLength = (field, min = 0, max = 100) => {
  return body(field)
    .isArray({ min, max })
    .withMessage(`${field} must be an array with ${min} to ${max} items`);
};

const validateEnum = (field, values) => {
  return body(field)
    .isIn(values)
    .withMessage(`${field} must be one of: ${values.join(', ')}`);
};

const validateRegex = (field, pattern, message) => {
  return body(field)
    .matches(pattern)
    .withMessage(message);
};

const validateCustom = (field, validator, message) => {
  return body(field)
    .custom(validator)
    .withMessage(message);
};

module.exports = {
  handleValidationErrors,
  validationRules,
  validateRequest,
  validateLogin,
  validateRegistration,
  validatePasswordChange,
  validateFileUpload,
  validateFileOperation,
  validateServiceControl,
  validateProcessControl,
  validateMonitoringConfig,
  validateDatabaseOperation,
  validateUserManagement,
  validateApiKey,
  validateBackupConfig,
  validateArrayLength,
  validateEnum,
  validateRegex,
  validateCustom
};