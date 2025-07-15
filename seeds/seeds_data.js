const bcrypt = require('bcryptjs');

exports.seed = async function(knex) {
  // Clear existing entries
  await knex('activity_logs').del();
  await knex('notifications').del();
  await knex('system_alerts').del();
  await knex('login_attempts').del();
  await knex('api_keys').del();
  await knex('server_configs').del();
  await knex('users').del();

  // Create default admin user
  const adminPassword = await bcrypt.hash('admin123!', 12);
  const [adminId] = await knex('users').insert({
    username: 'admin',
    email: 'admin@localhost',
    password_hash: adminPassword,
    first_name: 'System',
    last_name: 'Administrator',
    role: 'admin',
    permissions: JSON.stringify([
      'system:read', 'system:write', 'system:execute',
      'files:read', 'files:write', 'files:delete',
      'users:read', 'users:write', 'users:delete',
      'services:read', 'services:write',
      'database:read', 'database:write',
      'monitoring:read', 'settings:read', 'settings:write'
    ]),
    is_active: true,
    created_at: new Date(),
    updated_at: new Date()
  });

  // Create default user
  const userPassword = await bcrypt.hash('user123!', 12);
  const [userId] = await knex('users').insert({
    username: 'user',
    email: 'user@localhost',
    password_hash: userPassword,
    first_name: 'Default',
    last_name: 'User',
    role: 'user',
    permissions: JSON.stringify([
      'files:read', 'files:write',
      'monitoring:read'
    ]),
    is_active: true,
    created_at: new Date(),
    updated_at: new Date()
  });

  // Create viewer user
  const viewerPassword = await bcrypt.hash('viewer123!', 12);
  await knex('users').insert({
    username: 'viewer',
    email: 'viewer@localhost',
    password_hash: viewerPassword,
    first_name: 'Read Only',
    last_name: 'Viewer',
    role: 'viewer',
    permissions: JSON.stringify([
      'files:read',
      'monitoring:read',
      'system:read'
    ]),
    is_active: true,
    created_at: new Date(),
    updated_at: new Date()
  });

  // Insert default system configurations
  await knex('server_configs').insert([
    {
      config_key: 'system.name',
      config_value: 'ServerPanel Pro',
      config_type: 'string',
      description: 'Server display name',
      is_system: true,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'system.domain',
      config_value: 'localhost',
      config_type: 'string',
      description: 'Primary server domain',
      is_system: true,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'system.timezone',
      config_value: 'UTC',
      config_type: 'string',
      description: 'Server timezone',
      is_system: true,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'system.language',
      config_value: 'en',
      config_type: 'string',
      description: 'Default interface language',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'system.theme',
      config_value: 'dark',
      config_type: 'string',
      description: 'Default UI theme',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'monitoring.cpu_threshold',
      config_value: '80',
      config_type: 'number',
      description: 'CPU usage alert threshold (%)',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'monitoring.memory_threshold',
      config_value: '85',
      config_type: 'number',
      description: 'Memory usage alert threshold (%)',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'monitoring.disk_threshold',
      config_value: '90',
      config_type: 'number',
      description: 'Disk usage alert threshold (%)',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'monitoring.check_interval',
      config_value: '30000',
      config_type: 'number',
      description: 'Monitoring check interval (ms)',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'security.session_timeout',
      config_value: '86400000',
      config_type: 'number',
      description: 'Session timeout (ms)',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'security.max_login_attempts',
      config_value: '5',
      config_type: 'number',
      description: 'Maximum login attempts before lockout',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'security.lockout_duration',
      config_value: '900000',
      config_type: 'number',
      description: 'Account lockout duration (ms)',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'backup.enabled',
      config_value: 'true',
      config_type: 'boolean',
      description: 'Enable automatic backups',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'backup.retention_days',
      config_value: '7',
      config_type: 'number',
      description: 'Backup retention period (days)',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'backup.schedule',
      config_value: '0 2 * * *',
      config_type: 'string',
      description: 'Backup schedule (cron format)',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'email.enabled',
      config_value: 'false',
      config_type: 'boolean',
      description: 'Enable email functionality',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'ssl.auto_renew',
      config_value: 'true',
      config_type: 'boolean',
      description: 'Auto-renew SSL certificates',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'notifications.email_alerts',
      config_value: 'true',
      config_type: 'boolean',
      description: 'Send email alerts for system events',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'ui.items_per_page',
      config_value: '25',
      config_type: 'number',
      description: 'Default items per page in lists',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      config_key: 'files.max_upload_size',
      config_value: '104857600',
      config_type: 'number',
      description: 'Maximum file upload size (bytes)',
      is_system: false,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);

  // Create default API key for admin
  const crypto = require('crypto');
  const apiKey = crypto.randomBytes(32).toString('hex');
  
  await knex('api_keys').insert({
    user_id: adminId,
    name: 'Default Admin API Key',
    key: apiKey,
    permissions: JSON.stringify([
      'system:read', 'system:write',
      'files:read', 'files:write',
      'monitoring:read'
    ]),
    is_active: true,
    created_at: new Date(),
    updated_at: new Date()
  });

  // Create welcome notifications
  await knex('notifications').insert([
    {
      user_id: adminId,
      title: 'Welcome to ServerPanel Pro',
      message: 'Your server management panel has been successfully installed. Please review the security settings and change default passwords.',
      type: 'info',
      is_read: false,
      metadata: JSON.stringify({
        action: 'security_review',
        priority: 'high'
      }),
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      user_id: adminId,
      title: 'Security Reminder',
      message: 'Default passwords are in use. Please change them immediately for security.',
      type: 'warning',
      is_read: false,
      metadata: JSON.stringify({
        action: 'change_passwords',
        priority: 'critical'
      }),
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      user_id: userId,
      title: 'Welcome to ServerPanel Pro',
      message: 'Welcome! You can manage files and view system information. Contact your administrator for additional permissions.',
      type: 'info',
      is_read: false,
      metadata: JSON.stringify({
        action: 'getting_started',
        priority: 'low'
      }),
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);

  // Log the initial setup
  await knex('activity_logs').insert([
    {
      user_id: adminId,
      action: 'system_initialized',
      resource_type: 'system',
      resource_id: 'initial_setup',
      details: JSON.stringify({
        version: '1.0.0',
        setup_date: new Date().toISOString(),
        default_users_created: 3,
        default_configs_created: 20
      }),
      ip_address: '127.0.0.1',
      severity: 'info',
      performed_at: new Date()
    }
  ]);

  console.log('✅ Database seeded successfully!');
  console.log('📝 Default users created:');
  console.log('   - admin:admin123! (Administrator)');
  console.log('   - user:user123! (Regular User)'); 
  console.log('   - viewer:viewer123! (Read-only)');
  console.log('🔑 API Key created for admin user:', apiKey);
  console.log('⚠️  IMPORTANT: Change default passwords immediately!');
};