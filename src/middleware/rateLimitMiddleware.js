const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const logger = require('../config/logger');
const config = require('../config/config');

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: config.SECURITY.RATE_LIMIT_WINDOW || 15 * 60 * 1000, // 15 minutes
  max: config.SECURITY.RATE_LIMIT_MAX || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later',
    retryAfter: Math.ceil((config.SECURITY.RATE_LIMIT_WINDOW || 15 * 60 * 1000) / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });
    
    res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many requests from this IP, please try again later',
      retryAfter: Math.ceil((config.SECURITY.RATE_LIMIT_WINDOW || 15 * 60 * 1000) / 1000)
    });
  }
});

// Strict rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: config.SECURITY.LOCKOUT_TIME || 15 * 60 * 1000, // 15 minutes
  max: config.SECURITY.MAX_LOGIN_ATTEMPTS || 5, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later',
    retryAfter: Math.ceil((config.SECURITY.LOCKOUT_TIME || 15 * 60 * 1000) / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  handler: (req, res) => {
    logger.warn(`Authentication rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });
    
    res.status(429).json({
      success: false,
      error: 'Authentication rate limit exceeded',
      message: 'Too many authentication attempts, please try again later',
      retryAfter: Math.ceil((config.SECURITY.LOCKOUT_TIME || 15 * 60 * 1000) / 1000)
    });
  }
});

// File upload rate limiter
const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // limit each IP to 10 uploads per 5 minutes
  message: {
    error: 'Too many file uploads, please try again later',
    retryAfter: 300
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`File upload rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      user: req.user ? req.user.username : 'anonymous'
    });
    
    res.status(429).json({
      success: false,
      error: 'Upload rate limit exceeded',
      message: 'Too many file uploads, please try again later',
      retryAfter: 300
    });
  }
});

// API key rate limiter (more permissive)
const apiKeyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // limit each API key to 1000 requests per minute
  message: {
    error: 'API rate limit exceeded, please try again later',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use API key instead of IP for rate limiting
    return req.headers['x-api-key'] || req.ip;
  },
  handler: (req, res) => {
    logger.warn(`API key rate limit exceeded`, {
      apiKey: req.headers['x-api-key'],
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });
    
    res.status(429).json({
      success: false,
      error: 'API rate limit exceeded',
      message: 'API rate limit exceeded, please try again later',
      retryAfter: 60
    });
  }
});

// Command execution rate limiter (very strict)
const commandLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // limit each IP to 5 command executions per minute
  message: {
    error: 'Command execution rate limit exceeded',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Command execution rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      user: req.user ? req.user.username : 'anonymous'
    });
    
    res.status(429).json({
      success: false,
      error: 'Command execution rate limit exceeded',
      message: 'Too many command executions, please try again later',
      retryAfter: 60
    });
  }
});

// Dynamic rate limiter based on user role
const createRoleLimiter = (limits) => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: (req) => {
      const userRole = req.user ? req.user.role : 'anonymous';
      return limits[userRole] || limits.default || 10;
    },
    message: {
      error: 'Rate limit exceeded for your user role',
      retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.user ? `${req.user.id}` : req.ip;
    },
    handler: (req, res) => {
      logger.warn(`Role-based rate limit exceeded`, {
        user: req.user ? req.user.username : 'anonymous',
        role: req.user ? req.user.role : 'anonymous',
        ip: req.ip,
        endpoint: req.originalUrl
      });
      
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Rate limit exceeded for your user role',
        retryAfter: 900
      });
    }
  });
};

// Create specific limiters for different user roles
const roleLimiter = createRoleLimiter({
  admin: 1000,
  user: 200,
  viewer: 100,
  default: 50
});

// Brute force protection middleware
const createBruteForceProtection = (options = {}) => {
  const attempts = new Map();
  const maxAttempts = options.maxAttempts || 5;
  const windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes
  const blockDuration = options.blockDuration || 60 * 60 * 1000; // 1 hour
  
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    
    // Clean up old attempts
    const cutoff = now - windowMs;
    if (attempts.has(key)) {
      const userAttempts = attempts.get(key);
      userAttempts.attempts = userAttempts.attempts.filter(attempt => attempt > cutoff);
      
      if (userAttempts.attempts.length === 0) {
        attempts.delete(key);
      }
    }
    
    // Check if IP is currently blocked
    if (attempts.has(key)) {
      const userAttempts = attempts.get(key);
      if (userAttempts.blocked && userAttempts.blockedUntil > now) {
        const remainingTime = Math.ceil((userAttempts.blockedUntil - now) / 1000);
        
        logger.warn(`Blocked IP attempted access: ${key}`, {
          ip: key,
          remainingTime,
          endpoint: req.originalUrl
        });
        
        return res.status(429).json({
          success: false,
          error: 'IP temporarily blocked',
          message: 'Too many failed attempts. IP temporarily blocked.',
          retryAfter: remainingTime
        });
      }
    }
    
    // Record failed attempt
    req.recordFailedAttempt = () => {
      if (!attempts.has(key)) {
        attempts.set(key, { attempts: [], blocked: false, blockedUntil: 0 });
      }
      
      const userAttempts = attempts.get(key);
      userAttempts.attempts.push(now);
      
      if (userAttempts.attempts.length >= maxAttempts) {
        userAttempts.blocked = true;
        userAttempts.blockedUntil = now + blockDuration;
        
        logger.warn(`IP blocked due to brute force attempts: ${key}`, {
          ip: key,
          attempts: userAttempts.attempts.length,
          blockedUntil: new Date(userAttempts.blockedUntil)
        });
      }
    };
    
    // Clear attempts on successful authentication
    req.clearAttempts = () => {
      attempts.delete(key);
    };
    
    next();
  };
};

// IP whitelist middleware
const createIPWhitelist = (whitelist = []) => {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    // Allow localhost by default
    const defaultWhitelist = ['127.0.0.1', '::1', 'localhost'];
    const allowedIPs = [...defaultWhitelist, ...whitelist];
    
    if (allowedIPs.includes(clientIP)) {
      return next();
    }
    
    logger.warn(`Access denied for non-whitelisted IP: ${clientIP}`, {
      ip: clientIP,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });
    
    res.status(403).json({
      success: false,
      error: 'Access denied',
      message: 'Your IP address is not whitelisted'
    });
  };
};

// Request size limiter
const requestSizeLimiter = (maxSize = '10mb') => {
  return (req, res, next) => {
    const contentLength = req.headers['content-length'];
    
    if (contentLength) {
      const sizeInBytes = parseInt(contentLength);
      const maxSizeInBytes = parseSize(maxSize);
      
      if (sizeInBytes > maxSizeInBytes) {
        logger.warn(`Request size exceeded limit: ${sizeInBytes} bytes`, {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          endpoint: req.originalUrl,
          maxSize: maxSizeInBytes
        });
        
        return res.status(413).json({
          success: false,
          error: 'Request too large',
          message: `Request size exceeds maximum allowed size of ${maxSize}`
        });
      }
    }
    
    next();
  };
};

// Helper function to parse size strings
const parseSize = (sizeStr) => {
  const units = { b: 1, kb: 1024, mb: 1024**2, gb: 1024**3 };
  const match = sizeStr.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
  
  if (!match) return 0;
  
  const value = parseFloat(match[1]);
  const unit = match[2];
  
  return Math.floor(value * (units[unit] || 1));
};

module.exports = {
  apiLimiter,
  authLimiter,
  uploadLimiter,
  apiKeyLimiter,
  commandLimiter,
  roleLimiter,
  createRoleLimiter,
  createBruteForceProtection,
  createIPWhitelist,
  requestSizeLimiter
};