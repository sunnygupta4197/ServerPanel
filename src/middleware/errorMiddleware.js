const logger = require('../config/logger');
const config = require('../config/config');

// 404 Not Found handler
const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.status = 404;
  logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    user: req.user ? req.user.username : 'anonymous'
  });
  next(error);
};

// Global error handler
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error details
  logger.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    user: req.user ? req.user.username : 'anonymous',
    body: req.body,
    params: req.params,
    query: req.query
  });

  // Default error
  let statusCode = error.status || 500;
  let message = error.message;

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    message = 'Resource not found';
    statusCode = 404;
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    message = 'Duplicate field value entered';
    statusCode = 400;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    message = Object.values(err.errors).map(val => val.message).join(', ');
    statusCode = 400;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    message = 'Invalid token';
    statusCode = 401;
  }

  if (err.name === 'TokenExpiredError') {
    message = 'Token expired';
    statusCode = 401;
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    message = 'File too large';
    statusCode = 413;
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    message = 'Too many files';
    statusCode = 413;
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    message = 'Unexpected file field';
    statusCode = 400;
  }

  // Database errors
  if (err.code === 'SQLITE_CONSTRAINT' || err.code === 'ER_DUP_ENTRY') {
    message = 'Duplicate entry';
    statusCode = 409;
  }

  if (err.code === 'ECONNREFUSED') {
    message = 'Database connection failed';
    statusCode = 503;
  }

  // File system errors
  if (err.code === 'ENOENT') {
    message = 'File or directory not found';
    statusCode = 404;
  }

  if (err.code === 'EACCES' || err.code === 'EPERM') {
    message = 'Permission denied';
    statusCode = 403;
  }

  if (err.code === 'ENOSPC') {
    message = 'No space left on device';
    statusCode = 507;
  }

  // Rate limiting errors
  if (err.status === 429) {
    message = 'Too many requests, please try again later';
    statusCode = 429;
  }

  // Security errors
  if (err.type === 'security') {
    logger.security(`Security error: ${message}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      user: req.user ? req.user.username : 'anonymous'
    });
  }

  // Prepare error response
  const errorResponse = {
    success: false,
    error: {
      message,
      status: statusCode
    }
  };

  // Include stack trace in development
  if (config.NODE_ENV === 'development') {
    errorResponse.error.stack = error.stack;
    errorResponse.error.details = {
      originalMessage: err.message,
      code: err.code,
      name: err.name
    };
  }

  // Include request ID if available
  if (req.id) {
    errorResponse.error.requestId = req.id;
  }

  res.status(statusCode).json(errorResponse);
};

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Validation error formatter
const formatValidationErrors = (errors) => {
  return errors.map(error => ({
    field: error.param,
    message: error.msg,
    value: error.value
  }));
};

// Custom error classes
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
    this.name = 'AuthorizationError';
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429);
    this.name = 'RateLimitError';
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503);
    this.name = 'ServiceUnavailableError';
  }
}

// Error handling for unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  logger.error('Unhandled Promise Rejection:', {
    error: err.message,
    stack: err.stack,
    promise: promise
  });
  
  // Close server gracefully
  if (config.NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', {
    error: err.message,
    stack: err.stack
  });
  
  // Close server gracefully
  process.exit(1);
});

// Handle specific operational errors
const handleOperationalError = (error) => {
  if (error.isOperational) {
    return error;
  }
  
  // Convert non-operational errors to operational
  return new AppError('Something went wrong', 500);
};

// Database error handler
const handleDatabaseError = (error) => {
  // SQLite errors
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return new ConflictError('Duplicate entry found');
  }
  
  if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return new ValidationError('Foreign key constraint failed');
  }
  
  if (error.code === 'SQLITE_CONSTRAINT_NOTNULL') {
    return new ValidationError('Required field is missing');
  }
  
  // MySQL errors
  if (error.code === 'ER_DUP_ENTRY') {
    return new ConflictError('Duplicate entry found');
  }
  
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return new ValidationError('Referenced record does not exist');
  }
  
  if (error.code === 'ER_DATA_TOO_LONG') {
    return new ValidationError('Data too long for field');
  }
  
  // PostgreSQL errors
  if (error.code === '23505') {
    return new ConflictError('Duplicate entry found');
  }
  
  if (error.code === '23503') {
    return new ValidationError('Foreign key constraint violation');
  }
  
  if (error.code === '23502') {
    return new ValidationError('Not null constraint violation');
  }
  
  // Connection errors
  if (error.code === 'ECONNREFUSED') {
    return new ServiceUnavailableError('Database connection failed');
  }
  
  if (error.code === 'ETIMEDOUT') {
    return new ServiceUnavailableError('Database operation timed out');
  }
  
  return new AppError('Database operation failed', 500);
};

// File system error handler
const handleFileSystemError = (error) => {
  if (error.code === 'ENOENT') {
    return new NotFoundError('File or directory not found');
  }
  
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    return new AuthorizationError('Permission denied');
  }
  
  if (error.code === 'ENOSPC') {
    return new ServiceUnavailableError('No space left on device');
  }
  
  if (error.code === 'EMFILE' || error.code === 'ENFILE') {
    return new ServiceUnavailableError('Too many open files');
  }
  
  if (error.code === 'EISDIR') {
    return new ValidationError('Expected file but found directory');
  }
  
  if (error.code === 'ENOTDIR') {
    return new ValidationError('Expected directory but found file');
  }
  
  return new AppError('File system operation failed', 500);
};

// Network error handler
const handleNetworkError = (error) => {
  if (error.code === 'ECONNREFUSED') {
    return new ServiceUnavailableError('Connection refused');
  }
  
  if (error.code === 'ETIMEDOUT') {
    return new ServiceUnavailableError('Operation timed out');
  }
  
  if (error.code === 'ENOTFOUND') {
    return new NotFoundError('Host not found');
  }
  
  if (error.code === 'ECONNRESET') {
    return new ServiceUnavailableError('Connection reset');
  }
  
  return new AppError('Network operation failed', 500);
};

// Enhanced error handler with specific error type handling
const enhancedErrorHandler = (err, req, res, next) => {
  let error = err;
  
  // Handle specific error types
  if (error.code && error.code.startsWith('SQLITE_') || 
      error.code && error.code.startsWith('ER_') ||
      error.code && /^\d{5}$/.test(error.code)) {
    error = handleDatabaseError(error);
  } else if (error.code && ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EMFILE', 'ENFILE', 'EISDIR', 'ENOTDIR'].includes(error.code)) {
    error = handleFileSystemError(error);
  } else if (error.code && ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'].includes(error.code)) {
    error = handleNetworkError(error);
  } else {
    error = handleOperationalError(error);
  }
  
  // Use the standard error handler
  errorHandler(error, req, res, next);
};

// Request timeout middleware
const requestTimeout = (timeout = 30000) => {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      const error = new ServiceUnavailableError('Request timeout');
      next(error);
    }, timeout);
    
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    
    next();
  };
};

// Health check error handler
const healthCheckErrorHandler = (req, res, next) => {
  // For health check endpoints, provide minimal error information
  if (req.path === '/health' || req.path.startsWith('/health/')) {
    return (err, req, res, next) => {
      res.status(503).json({
        status: 'error',
        message: 'Health check failed'
      });
    };
  }
  next();
};

module.exports = {
  notFound,
  errorHandler,
  enhancedErrorHandler,
  asyncHandler,
  formatValidationErrors,
  requestTimeout,
  healthCheckErrorHandler,
  // Error classes
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
  // Specific error handlers
  handleDatabaseError,
  handleFileSystemError,
  handleNetworkError,
  handleOperationalError
};