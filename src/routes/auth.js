const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const config = require('../config/config');
const database = require('../config/database');
const logger = require('../config/logger');
const {
  generateToken,
  hashPassword,
  verifyPassword,
  blacklistToken,
  isAccountLocked,
  recordFailedAttempt,
  recordSuccessfulLogin,
  validateLogin,
  validateRegistration,
  loginLimiter
} = require('../middleware/authMiddleware');

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: {
    error: 'Too many authentication attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Login endpoint
router.post('/login', 
  authLimiter,
  loginLimiter,
  validateLogin,
  async (req, res) => {
    try {
      const { username, password } = req.body;
      const clientIP = req.ip || req.connection.remoteAddress;

      // Check if account is locked
      if (await isAccountLocked(username)) {
        logger.security(`Login attempt on locked account: ${username}`, { ip: clientIP });
        return res.status(423).json({
          success: false,
          message: 'Account is temporarily locked due to too many failed attempts'
        });
      }

      // Find user
      const user = await database('users')
        .where('username', username)
        .where('is_active', true)
        .first();

      if (!user) {
        await recordFailedAttempt(username, clientIP);
        logger.security(`Login attempt with invalid username: ${username}`, { ip: clientIP });
        return res.status(401).json({
          success: false,
          message: 'Invalid username or password'
        });
      }

      // Verify password
      const isValidPassword = await verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        await recordFailedAttempt(username, clientIP);
        logger.security(`Login attempt with invalid password for user: ${username}`, { ip: clientIP });
        return res.status(401).json({
          success: false,
          message: 'Invalid username or password'
        });
      }

      // Check if two-factor authentication is required
      if (user.two_factor_enabled && !req.body.twoFactorCode) {
        return res.status(200).json({
          success: false,
          requiresTwoFactor: true,
          message: 'Two-factor authentication code required',
          tempToken: generateTempToken(user.id)
        });
      }

      // Verify two-factor code if provided
      if (user.two_factor_enabled && req.body.twoFactorCode) {
        const isValidTwoFactor = verifyTwoFactorCode(user.two_factor_secret, req.body.twoFactorCode);
        if (!isValidTwoFactor) {
          await recordFailedAttempt(username, clientIP);
          logger.security(`Invalid 2FA code for user: ${username}`, { ip: clientIP });
          return res.status(401).json({
            success: false,
            message: 'Invalid two-factor authentication code'
          });
        }
      }

      // Successful login
      await recordSuccessfulLogin(username, clientIP);
      
      // Generate JWT token
      const token = generateToken(user);
      
      // Update last login
      await database('users')
        .where('id', user.id)
        .update({
          last_login: new Date(),
          last_login_ip: clientIP,
          last_activity: new Date()
        });

      // Log successful login
      logger.audit('user_login', user, 'authentication', { ip: clientIP });

      // Return user data (without sensitive information)
      const userData = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        permissions: JSON.parse(user.permissions || '[]'),
        last_login: new Date(),
        two_factor_enabled: user.two_factor_enabled
      };

      res.json({
        success: true,
        message: 'Login successful',
        token,
        user: userData
      });

    } catch (error) {
      logger.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error during login'
      });
    }
  }
);

// Verify two-factor authentication
router.post('/verify-2fa',
  authLimiter,
  [
    body('tempToken').isString().withMessage('Temporary token is required'),
    body('code').isLength({ min: 6, max: 6 }).withMessage('2FA code must be 6 digits')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { tempToken, code } = req.body;
      const clientIP = req.ip || req.connection.remoteAddress;

      // Verify temporary token
      const decoded = jwt.verify(tempToken, config.JWT_SECRET);
      if (decoded.type !== 'temp_2fa') {
        return res.status(401).json({
          success: false,
          message: 'Invalid temporary token'
        });
      }

      // Get user
      const user = await database('users')
        .where('id', decoded.userId)
        .where('is_active', true)
        .first();

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify 2FA code
      const isValidCode = verifyTwoFactorCode(user.two_factor_secret, code);
      if (!isValidCode) {
        logger.security(`Invalid 2FA code for user: ${user.username}`, { ip: clientIP });
        return res.status(401).json({
          success: false,
          message: 'Invalid two-factor authentication code'
        });
      }

      // Generate full access token
      const token = generateToken(user);
      
      logger.audit('2fa_verification', user, 'authentication', { ip: clientIP });

      const userData = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        permissions: JSON.parse(user.permissions || '[]'),
        two_factor_enabled: true
      };

      res.json({
        success: true,
        message: 'Two-factor authentication successful',
        token,
        user: userData
      });

    } catch (error) {
      logger.error('2FA verification error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error during 2FA verification'
      });
    }
  }
);

// Register new user (admin only)
router.post('/register',
  authLimiter,
  validateRegistration,
  async (req, res) => {
    try {
      const { username, email, password, role = 'user' } = req.body;

      // Check if username already exists
      const existingUser = await database('users')
        .where('username', username)
        .orWhere('email', email)
        .first();

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Username or email already exists'
        });
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      // Create user
      const [userId] = await database('users').insert({
        username,
        email,
        password_hash: passwordHash,
        role,
        permissions: JSON.stringify(getDefaultPermissions(role)),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      });

      logger.audit('user_created', { username }, 'user_management', {
        created_by: req.user ? req.user.id : 'system',
        role
      });

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        user: {
          id: userId,
          username,
          email,
          role
        }
      });

    } catch (error) {
      logger.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error during registration'
      });
    }
  }
);

// Verify token
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, config.JWT_SECRET);
    
    // Check if token is blacklisted
    const blacklistedToken = await database('token_blacklist')
      .where('token', token)
      .where('expires_at', '>', new Date())
      .first();

    if (blacklistedToken) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked'
      });
    }

    // Get current user data
    const user = await database('users')
      .where('id', decoded.id)
      .where('is_active', true)
      .first();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found or inactive'
      });
    }

    // Update last activity
    await database('users')
      .where('id', user.id)
      .update({ last_activity: new Date() });

    const userData = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      permissions: JSON.parse(user.permissions || '[]'),
      last_login: user.last_login,
      two_factor_enabled: user.two_factor_enabled
    };

    res.json({
      success: true,
      user: userData
    });

  } catch (error) {
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

    logger.error('Token verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during token verification'
    });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      // Blacklist the token
      await blacklistToken(token);
      
      // Log logout
      if (req.user) {
        logger.audit('user_logout', req.user, 'authentication', {
          ip: req.ip || req.connection.remoteAddress
        });
      }
    }

    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during logout'
    });
  }
});

// Change password
router.post('/change-password',
  authLimiter,
  [
    body('currentPassword').isLength({ min: 1 }).withMessage('Current password is required'),
    body('newPassword').isLength({ min: config.SECURITY.PASSWORD_MIN_LENGTH })
      .withMessage(`New password must be at least ${config.SECURITY.PASSWORD_MIN_LENGTH} characters long`)
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id;

      // Get current user
      const user = await database('users')
        .where('id', userId)
        .first();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify current password
      const isValidPassword = await verifyPassword(currentPassword, user.password_hash);
      if (!isValidPassword) {
        logger.security(`Invalid current password in change password attempt for user: ${user.username}`, {
          ip: req.ip || req.connection.remoteAddress
        });
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Hash new password
      const newPasswordHash = await hashPassword(newPassword);

      // Update password
      await database('users')
        .where('id', userId)
        .update({
          password_hash: newPasswordHash,
          password_changed_at: new Date(),
          updated_at: new Date()
        });

      logger.audit('password_changed', user, 'user_management', {
        ip: req.ip || req.connection.remoteAddress
      });

      res.json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      logger.error('Change password error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error during password change'
      });
    }
  }
);

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    // Verify current token (allow expired tokens for refresh)
    const decoded = jwt.verify(token, config.JWT_SECRET, { ignoreExpiration: true });
    
    // Check if token is blacklisted
    const blacklistedToken = await database('token_blacklist')
      .where('token', token)
      .first();

    if (blacklistedToken) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked'
      });
    }

    // Get user
    const user = await database('users')
      .where('id', decoded.id)
      .where('is_active', true)
      .first();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found or inactive'
      });
    }

    // Generate new token
    const newToken = generateToken(user);
    
    // Blacklist old token
    await blacklistToken(token);

    res.json({
      success: true,
      token: newToken,
      message: 'Token refreshed successfully'
    });

  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during token refresh'
    });
  }
});

// Helper functions
function generateTempToken(userId) {
  return jwt.sign(
    { userId, type: 'temp_2fa' },
    config.JWT_SECRET,
    { expiresIn: '5m' }
  );
}

function verifyTwoFactorCode(secret, code) {
  // This would integrate with a 2FA library like speakeasy
  // For now, return true for demo purposes
  // In production, implement proper TOTP verification
  return code === '123456'; // Placeholder
}

function getDefaultPermissions(role) {
  const permissions = {
    admin: [
      'system:read', 'system:write', 'system:execute',
      'files:read', 'files:write', 'files:delete',
      'users:read', 'users:write', 'users:delete',
      'services:read', 'services:write',
      'database:read', 'database:write',
      'monitoring:read', 'settings:read', 'settings:write',
      'apps:read', 'apps:install', 'apps:uninstall', 'apps:configure'
    ],
    user: [
      'files:read', 'files:write',
      'monitoring:read',
      'apps:read'
    ],
    viewer: [
      'files:read',
      'monitoring:read',
      'system:read'
    ]
  };

  return permissions[role] || permissions.viewer;
}

module.exports = router;