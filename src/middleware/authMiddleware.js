const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const config = require('../config/config');
const logger = require('../config/logger');
const database = require('../config/database');

// In-memory blacklist cache — O(1) lookup before hitting DB.
// Tokens blacklisted in a previous process run are caught by the DB fallback.
const blacklistCache = new Set();

// Debounce last_activity DB writes to at most once per 5 minutes per user.
const activityCache = new Map();
const ACTIVITY_DEBOUNCE = 5 * 60 * 1000;

// Rate limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: config.SECURITY.LOCKOUT_TIME,
  max: config.SECURITY.MAX_LOGIN_ATTEMPTS,
  message: {
    error: 'Too many login attempts, please try again later',
    retryAfter: Math.ceil(config.SECURITY.LOCKOUT_TIME / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Only count failed requests
  skipSuccessfulRequests: true,
  // Custom key generator to track by IP + username
  keyGenerator: (req) => `login_${req.ip}_${req.body.username || 'unknown'}`
});

// JWT token verification middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.auth_token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    const decoded = jwt.verify(token, config.JWT_SECRET);

    // Fast blacklist check — in-memory first, DB fallback for cross-restart correctness
    if (blacklistCache.has(token)) {
      return res.status(401).json({ success: false, message: 'Token has been revoked' });
    }

    // Fetch user and DB blacklist entry in parallel
    const [user, blacklistedRow] = await Promise.all([
      database('users').where({ id: decoded.id, is_active: true }).first(),
      database('token_blacklist').where({ token }).first()
    ]);

    if (blacklistedRow) {
      blacklistCache.add(token); // Warm cache so next request is O(1)
      return res.status(401).json({ success: false, message: 'Token has been revoked' });
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      permissions: JSON.parse(user.permissions || '[]'),
      last_login: user.last_login,
      twoFactorVerified: decoded.twoFactorVerified || false
    };

    // Debounced last_activity write — at most once per 5 min per user, fire-and-forget
    const now = Date.now();
    if (now - (activityCache.get(user.id) || 0) > ACTIVITY_DEBOUNCE) {
      activityCache.set(user.id, now);
      database('users').where({ id: user.id }).update({ last_activity: new Date() })
        .catch(err => logger.error('Failed to update last_activity:', err));
    }

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Authentication service error'
    });
  }
};

// Role-based authorization middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(userRole)) {
      logger.warn(`Access denied for user ${req.user.username} with role ${userRole}. Required: ${allowedRoles.join(', ')}`);
      
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Permission-based authorization middleware
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userPermissions = req.user.permissions;
    
    // Admin role has all permissions
    if (req.user.role === 'admin') {
      return next();
    }

    if (!userPermissions.includes(permission)) {
      logger.warn(`Permission denied for user ${req.user.username}. Required: ${permission}`);
      
      return res.status(403).json({
        success: false,
        message: `Permission required: ${permission}`
      });
    }

    next();
  };
};

// Input validation for authentication
const validateLogin = [
  body('username')
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-zA-Z0-9_.-]+$/)
    .withMessage('Username must be 3-50 characters and contain only letters, numbers, dots, hyphens, and underscores'),
  
  body('password')
    .isLength({ min: config.SECURITY.PASSWORD_MIN_LENGTH })
    .withMessage(`Password must be at least ${config.SECURITY.PASSWORD_MIN_LENGTH} characters long`),
    
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    next();
  }
];

const validateRegistration = [
  body('username')
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-zA-Z0-9_.-]+$/)
    .withMessage('Username must be 3-50 characters and contain only letters, numbers, dots, hyphens, and underscores'),
  
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('password')
    .isLength({ min: config.SECURITY.PASSWORD_MIN_LENGTH })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage(`Password must be at least ${config.SECURITY.PASSWORD_MIN_LENGTH} characters and contain at least one uppercase letter, one lowercase letter, one number, and one special character`),
  
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return value;
    }),

  body('role')
    .optional()
    .isIn(['admin', 'user', 'viewer'])
    .withMessage('Role must be one of: admin, user, viewer'),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    next();
  }
];

// Generate JWT token
const generateToken = (user, twoFactorVerified = false) => {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      twoFactorVerified: twoFactorVerified || !user.two_factor_enabled
    },
    config.JWT_SECRET,
    {
      expiresIn: config.JWT_EXPIRE,
      issuer: 'ServerPanel Pro',
      audience: 'ServerPanel Users'
    }
  );
};

// Hash password
const hashPassword = async (password) => {
  return await bcrypt.hash(password, config.BCRYPT_ROUNDS);
};

// Verify password
const verifyPassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

// Blacklist token (for logout)
const blacklistToken = async (token) => {
  try {
    const decoded = jwt.decode(token);
    const expiresAt = new Date(decoded.exp * 1000);

    blacklistCache.add(token); // Immediate in-memory effect

    await database('token_blacklist').insert({
      token,
      expires_at: expiresAt,
      created_at: new Date()
    });

    return true;
  } catch (error) {
    logger.error('Error blacklisting token:', error);
    return false;
  }
};

// Clean expired blacklisted tokens — call periodically (e.g. daily cron)
const cleanExpiredTokens = async () => {
  try {
    // Clear in-memory cache; non-expired entries are re-warmed on next miss
    blacklistCache.clear();
    activityCache.clear();

    const deleted = await database('token_blacklist')
      .where('expires_at', '<', new Date())
      .del();

    if (deleted > 0) {
      logger.info(`Cleaned ${deleted} expired tokens from blacklist`);
    }

    return deleted;
  } catch (error) {
    logger.error('Error cleaning expired tokens:', error);
    return 0;
  }
};

// Check if user account is locked due to failed attempts
const isAccountLocked = async (username) => {
  const user = await database('users')
    .where({ username })
    .first();
    
  if (!user) return false;
  
  const lockoutEnd = user.lockout_until;
  if (lockoutEnd && new Date() < new Date(lockoutEnd)) {
    return true;
  }
  
  return false;
};

// Record failed login attempt
const recordFailedAttempt = async (username, ip) => {
  try {
    const user = await database('users')
      .where({ username })
      .first();
      
    if (!user) return;
    
    const failedAttempts = (user.failed_attempts || 0) + 1;
    const updateData = {
      failed_attempts: failedAttempts
    };
    
    // Lock account if max attempts reached
    if (failedAttempts >= config.SECURITY.MAX_LOGIN_ATTEMPTS) {
      updateData.lockout_until = new Date(Date.now() + config.SECURITY.LOCKOUT_TIME);
      logger.warn(`Account locked for user ${username} due to ${failedAttempts} failed attempts`);
    }
    
    await database('users')
      .where({ username })
      .update(updateData);
      
    // Log the attempt
    await database('login_attempts').insert({
      username,
      ip_address: ip,
      success: false,
      attempted_at: new Date()
    });
    
  } catch (error) {
    logger.error('Error recording failed attempt:', error);
  }
};

// Record successful login
const recordSuccessfulLogin = async (username, ip) => {
  try {
    await database('users')
      .where({ username })
      .update({
        failed_attempts: 0,
        lockout_until: null,
        last_login: new Date(),
        last_login_ip: ip
      });
      
    // Log the attempt
    await database('login_attempts').insert({
      username,
      ip_address: ip,
      success: true,
      attempted_at: new Date()
    });
    
  } catch (error) {
    logger.error('Error recording successful login:', error);
  }
};

// Middleware to check API key authentication (for API-only endpoints)
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        message: 'API key is required'
      });
    }
    
    const keyRecord = await database('api_keys')
      .where({ key: apiKey, is_active: true })
      .first();
      
    if (!keyRecord) {
      return res.status(401).json({
        success: false,
        message: 'Invalid API key'
      });
    }
    
    // Check if key has expired
    if (keyRecord.expires_at && new Date() > new Date(keyRecord.expires_at)) {
      return res.status(401).json({
        success: false,
        message: 'API key has expired'
      });
    }
    
    // Get user associated with API key
    const user = await database('users')
      .where({ id: keyRecord.user_id, is_active: true })
      .first();
      
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid API key owner'
      });
    }
    
    // Add user info to request
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      permissions: JSON.parse(user.permissions || '[]'),
      apiKey: keyRecord
    };
    
    // Update last used timestamp
    await database('api_keys')
      .where({ id: keyRecord.id })
      .update({ last_used: new Date() });
    
    next();
  } catch (error) {
    logger.error('API key authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication service error'
    });
  }
};

// Two-factor authentication middleware
const requireTwoFactor = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  
  const user = await database('users')
    .where({ id: req.user.id })
    .first();
    
  if (user.two_factor_enabled && !req.user.twoFactorVerified) {
    return res.status(403).json({
      success: false,
      message: 'Two-factor authentication required',
      requiresTwoFactor: true
    });
  }
  
  next();
};

// Session-based authentication (alternative to JWT)
const authenticateSession = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Session authentication required'
    });
  }
  
  // Session is valid, continue
  next();
};

module.exports = {
  authenticateToken,
  authenticateApiKey,
  authenticateSession,
  requireRole,
  requirePermission,
  requireTwoFactor,
  loginLimiter,
  validateLogin,
  validateRegistration,
  generateToken,
  hashPassword,
  verifyPassword,
  blacklistToken,
  cleanExpiredTokens,
  isAccountLocked,
  recordFailedAttempt,
  recordSuccessfulLogin
};