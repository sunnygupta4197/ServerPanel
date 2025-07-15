const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, param, query, validationResult } = require('express-validator');
const { requireRole, requirePermission } = require('../middleware/authMiddleware');
const { validateUserManagement } = require('../middleware/validationMiddleware');
const logger = require('../config/logger');
const config = require('../config/config');
const database = require('../config/database');

// Get all users
router.get('/', requirePermission('users:read'), async (req, res) => {
  try {
    const { page = 1, limit = 50, search, role, status } = req.query;
    const offset = (page - 1) * limit;

    let query = database('users')
      .select('id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active', 'last_login', 'created_at')
      .orderBy('created_at', 'desc');

    // Apply filters
    if (search) {
      query = query.where(function() {
        this.where('username', 'like', `%${search}%`)
          .orWhere('email', 'like', `%${search}%`)
          .orWhere('first_name', 'like', `%${search}%`)
          .orWhere('last_name', 'like', `%${search}%`);
      });
    }

    if (role) {
      query = query.where('role', role);
    }

    if (status === 'active') {
      query = query.where('is_active', true);
    } else if (status === 'inactive') {
      query = query.where('is_active', false);
    }

    // Get total count
    const countQuery = query.clone();
    const [{ count }] = await countQuery.count('id as count');

    // Apply pagination
    const users = await query.limit(limit).offset(offset);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(count),
          pages: Math.ceil(count / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Error getting users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve users'
    });
  }
});

// Get specific user
router.get('/:id', requirePermission('users:read'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await database('users')
      .select('id', 'username', 'email', 'first_name', 'last_name', 'role', 'permissions', 'is_active', 'last_login', 'last_activity', 'created_at', 'updated_at')
      .where('id', id)
      .first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Parse permissions
    user.permissions = JSON.parse(user.permissions || '[]');

    // Get user's recent activity
    const recentActivity = await database('activity_logs')
      .select('action', 'resource_type', 'resource_id', 'details', 'performed_at')
      .where('user_id', id)
      .orderBy('performed_at', 'desc')
      .limit(10);

    // Get user's login attempts
    const loginAttempts = await database('login_attempts')
      .select('ip_address', 'success', 'attempted_at')
      .where('username', user.username)
      .orderBy('attempted_at', 'desc')
      .limit(5);

    res.json({
      success: true,
      data: {
        user,
        recentActivity,
        loginAttempts
      }
    });
  } catch (error) {
    logger.error('Error getting user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user'
    });
  }
});

// Create new user
router.post('/', 
  requirePermission('users:write'),
  [
    body('username').isLength({ min: 3, max: 50 }).matches(/^[a-zA-Z0-9_.-]+$/),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: config.SECURITY.PASSWORD_MIN_LENGTH }),
    body('first_name').optional().isLength({ max: 50 }),
    body('last_name').optional().isLength({ max: 50 }),
    body('role').isIn(['admin', 'user', 'viewer']),
    body('permissions').optional().isArray(),
    body('is_active').optional().isBoolean()
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

      const { username, email, password, first_name, last_name, role, permissions, is_active = true } = req.body;

      // Check if username or email already exists
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
      const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

      // Get default permissions for role
      const defaultPermissions = getDefaultPermissions(role);
      const userPermissions = permissions || defaultPermissions;

      // Create user
      const [userId] = await database('users').insert({
        username,
        email,
        password_hash: passwordHash,
        first_name,
        last_name,
        role,
        permissions: JSON.stringify(userPermissions),
        is_active,
        created_at: new Date(),
        updated_at: new Date()
      });

      // Log user creation
      await database('activity_logs').insert({
        user_id: req.user.id,
        action: 'user_created',
        resource_type: 'user',
        resource_id: userId.toString(),
        details: JSON.stringify({
          username,
          email,
          role,
          created_by: req.user.username
        }),
        ip_address: req.ip,
        performed_at: new Date()
      });

      logger.info(`User created: ${username} by ${req.user.username}`);

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: {
          id: userId,
          username,
          email,
          role
        }
      });
    } catch (error) {
      logger.error('Error creating user:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create user'
      });
    }
  }
);

// Update user
router.put('/:id',
  requirePermission('users:write'),
  [
    param('id').isInt({ min: 1 }),
    body('username').optional().isLength({ min: 3, max: 50 }).matches(/^[a-zA-Z0-9_.-]+$/),
    body('email').optional().isEmail().normalizeEmail(),
    body('first_name').optional().isLength({ max: 50 }),
    body('last_name').optional().isLength({ max: 50 }),
    body('role').optional().isIn(['admin', 'user', 'viewer']),
    body('permissions').optional().isArray(),
    body('is_active').optional().isBoolean()
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

      const { id } = req.params;
      const { username, email, first_name, last_name, role, permissions, is_active } = req.body;

      // Get current user
      const currentUser = await database('users').where('id', id).first();
      if (!currentUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Prevent user from deactivating themselves
      if (parseInt(id) === req.user.id && is_active === false) {
        return res.status(400).json({
          success: false,
          message: 'Cannot deactivate your own account'
        });
      }

      // Check if username or email already exists (excluding current user)
      if (username || email) {
        const existingUser = await database('users')
          .where(function() {
            if (username) this.where('username', username);
            if (email) this.orWhere('email', email);
          })
          .where('id', '!=', id)
          .first();

        if (existingUser) {
          return res.status(409).json({
            success: false,
            message: 'Username or email already exists'
          });
        }
      }

      // Prepare update data
      const updateData = {
        updated_at: new Date()
      };

      if (username) updateData.username = username;
      if (email) updateData.email = email;
      if (first_name !== undefined) updateData.first_name = first_name;
      if (last_name !== undefined) updateData.last_name = last_name;
      if (role) updateData.role = role;
      if (permissions) updateData.permissions = JSON.stringify(permissions);
      if (is_active !== undefined) updateData.is_active = is_active;

      // Update user
      await database('users').where('id', id).update(updateData);

      // Log user update
      await database('activity_logs').insert({
        user_id: req.user.id,
        action: 'user_updated',
        resource_type: 'user',
        resource_id: id.toString(),
        details: JSON.stringify({
          username: username || currentUser.username,
          changes: updateData,
          updated_by: req.user.username
        }),
        ip_address: req.ip,
        performed_at: new Date()
      });

      logger.info(`User updated: ${username || currentUser.username} by ${req.user.username}`);

      res.json({
        success: true,
        message: 'User updated successfully'
      });
    } catch (error) {
      logger.error('Error updating user:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update user'
      });
    }
  }
);

// Delete user
router.delete('/:id',
  requirePermission('users:delete'),
  [
    param('id').isInt({ min: 1 })
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

      const { id } = req.params;

      // Prevent user from deleting themselves
      if (parseInt(id) === req.user.id) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete your own account'
        });
      }

      // Get user details before deletion
      const user = await database('users').where('id', id).first();
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Delete user
      await database('users').where('id', id).del();

      // Log user deletion
      await database('activity_logs').insert({
        user_id: req.user.id,
        action: 'user_deleted',
        resource_type: 'user',
        resource_id: id.toString(),
        details: JSON.stringify({
          username: user.username,
          email: user.email,
          role: user.role,
          deleted_by: req.user.username
        }),
        ip_address: req.ip,
        performed_at: new Date()
      });

      logger.info(`User deleted: ${user.username} by ${req.user.username}`);

      res.json({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting user:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete user'
      });
    }
  }
);

// Reset user password
router.post('/:id/reset-password',
  requirePermission('users:write'),
  [
    param('id').isInt({ min: 1 }),
    body('password').isLength({ min: config.SECURITY.PASSWORD_MIN_LENGTH })
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

      const { id } = req.params;
      const { password } = req.body;

      // Get user
      const user = await database('users').where('id', id).first();
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

      // Update password
      await database('users').where('id', id).update({
        password_hash: passwordHash,
        password_changed_at: new Date(),
        updated_at: new Date()
      });

      // Log password reset
      await database('activity_logs').insert({
        user_id: req.user.id,
        action: 'password_reset',
        resource_type: 'user',
        resource_id: id.toString(),
        details: JSON.stringify({
          username: user.username,
          reset_by: req.user.username
        }),
        ip_address: req.ip,
        performed_at: new Date()
      });

      logger.info(`Password reset for user: ${user.username} by ${req.user.username}`);

      res.json({
        success: true,
        message: 'Password reset successfully'
      });
    } catch (error) {
      logger.error('Error resetting password:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reset password'
      });
    }
  }
);

// Toggle user status
router.post('/:id/toggle-status',
  requirePermission('users:write'),
  [
    param('id').isInt({ min: 1 })
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

      const { id } = req.params;

      // Prevent user from deactivating themselves
      if (parseInt(id) === req.user.id) {
        return res.status(400).json({
          success: false,
          message: 'Cannot change your own account status'
        });
      }

      // Get current user
      const user = await database('users').where('id', id).first();
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Toggle status
      const newStatus = !user.is_active;
      await database('users').where('id', id).update({
        is_active: newStatus,
        updated_at: new Date()
      });

      // Log status change
      await database('activity_logs').insert({
        user_id: req.user.id,
        action: 'user_status_changed',
        resource_type: 'user',
        resource_id: id.toString(),
        details: JSON.stringify({
          username: user.username,
          old_status: user.is_active,
          new_status: newStatus,
          changed_by: req.user.username
        }),
        ip_address: req.ip,
        performed_at: new Date()
      });

      logger.info(`User status changed: ${user.username} -> ${newStatus ? 'active' : 'inactive'} by ${req.user.username}`);

      res.json({
        success: true,
        message: `User ${newStatus ? 'activated' : 'deactivated'} successfully`,
        data: {
          is_active: newStatus
        }
      });
    } catch (error) {
      logger.error('Error toggling user status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to toggle user status'
      });
    }
  }
);

// Get user activity
router.get('/:id/activity',
  requirePermission('users:read'),
  [
    param('id').isInt({ min: 1 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 })
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

      const { id } = req.params;
      const { page = 1, limit = 50 } = req.query;
      const offset = (page - 1) * limit;

      // Get user activity
      const activities = await database('activity_logs')
        .select('action', 'resource_type', 'resource_id', 'details', 'ip_address', 'performed_at')
        .where('user_id', id)
        .orderBy('performed_at', 'desc')
        .limit(limit)
        .offset(offset);

      // Get total count
      const [{ count }] = await database('activity_logs')
        .where('user_id', id)
        .count('id as count');

      res.json({
        success: true,
        data: {
          activities,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(count),
            pages: Math.ceil(count / limit)
          }
        }
      });
    } catch (error) {
      logger.error('Error getting user activity:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve user activity'
      });
    }
  }
);

// Get user sessions
router.get('/:id/sessions',
  requirePermission('users:read'),
  [
    param('id').isInt({ min: 1 })
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

      const { id } = req.params;

      // Get user login attempts
      const sessions = await database('login_attempts')
        .select('ip_address', 'success', 'attempted_at')
        .where('user_id', id)
        .orderBy('attempted_at', 'desc')
        .limit(20);

      res.json({
        success: true,
        data: {
          sessions
        }
      });
    } catch (error) {
      logger.error('Error getting user sessions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve user sessions'
      });
    }
  }
);

// Get user statistics
router.get('/stats/summary', requirePermission('users:read'), async (req, res) => {
  try {
    const stats = await database('users')
      .select(
        database.raw('COUNT(*) as total'),
        database.raw('COUNT(CASE WHEN is_active = true THEN 1 END) as active'),
        database.raw('COUNT(CASE WHEN is_active = false THEN 1 END) as inactive'),
        database.raw('COUNT(CASE WHEN role = "admin" THEN 1 END) as admins'),
        database.raw('COUNT(CASE WHEN role = "user" THEN 1 END) as users'),
        database.raw('COUNT(CASE WHEN role = "viewer" THEN 1 END) as viewers')
      )
      .first();

    // Get recent registrations
    const recentRegistrations = await database('users')
      .select('username', 'email', 'role', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(5);

    // Get login statistics
    const loginStats = await database('login_attempts')
      .select(
        database.raw('COUNT(*) as total_attempts'),
        database.raw('COUNT(CASE WHEN success = true THEN 1 END) as successful_logins'),
        database.raw('COUNT(CASE WHEN success = false THEN 1 END) as failed_attempts')
      )
      .where('attempted_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
      .first();

    res.json({
      success: true,
      data: {
        userStats: stats,
        recentRegistrations,
        loginStats: loginStats || { total_attempts: 0, successful_logins: 0, failed_attempts: 0 }
      }
    });
  } catch (error) {
    logger.error('Error getting user statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user statistics'
    });
  }
});

// Helper function to get default permissions
function getDefaultPermissions(role) {
  const permissions = {
    admin: [
      'system:read', 'system:write', 'system:execute',
      'files:read', 'files:write', 'files:delete',
      'users:read', 'users:write', 'users:delete',
      'services:read', 'services:write',
      'database:read', 'database:write',
      'monitoring:read', 'monitoring:write',
      'settings:read', 'settings:write'
    ],
    user: [
      'files:read', 'files:write',
      'monitoring:read',
      'system:read'
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