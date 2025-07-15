// ecosystem.config.js - PM2 Configuration
module.exports = {
  apps: [
    {
      name: 'serverpanel-pro',
      script: 'src/app.js',
      cwd: __dirname,
      instances: process.env.NODE_ENV === 'production' ? 'max' : 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000
      },
      // Logging
      log_file: 'logs/combined.log',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Monitoring
      min_uptime: '10s',
      max_restarts: 10,
      
      // Memory management
      max_memory_restart: '1G',
      
      // Advanced features
      watch: process.env.NODE_ENV === 'development',
      ignore_watch: [
        'node_modules',
        'logs',
        'uploads',
        'backups',
        'data',
        'certificates'
      ],
      
      // Auto restart
      autorestart: true,
      
      // Graceful shutdown
      kill_timeout: 5000,
      
      // Health monitoring
      health_check_grace_period: 3000,
      
      // Node.js options
      node_args: [
        '--max-old-space-size=2048'
      ],
      
      // Environment variables
      env_file: '.env',
      
      // Process management
      pid_file: 'logs/serverpanel-pro.pid',
      
      // Cron restart (restart at 4 AM daily)
      cron_restart: '0 4 * * *',
      
      // Source map support
      source_map_support: true,
      
      // Instance variables
      instance_var: 'INSTANCE_ID',
      
      // Graceful start
      wait_ready: true,
      listen_timeout: 8000,
      
      // Deployment
      post_update: ['npm install', 'npm run migrate'],
      
      // Interpreter
      interpreter: 'node',
      
      // Arguments
      args: [],
      
      // Automation
      automation: false,
      
      // Logs
      log_type: 'json',
      
      // Cluster mode options
      increment_var: 'PORT',
      
      // Watch options
      watch_options: {
        followSymlinks: false,
        usePolling: false
      }
    }
  ],

  deploy: {
    production: {
      user: 'serverpanel',
      host: ['production-server.com'],
      ref: 'origin/main',
      repo: 'git@github.com:serverpanel/serverpanel-pro.git',
      path: '/var/www/serverpanel-pro',
      'post-deploy': 'npm install && npm run migrate && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'apt-get update && apt-get install -y git',
      'post-setup': 'ls -la',
      'pre-deploy-local': 'echo "This is a local executed command"'
    },
    
    staging: {
      user: 'serverpanel',
      host: ['staging-server.com'],
      ref: 'origin/develop',
      repo: 'git@github.com:serverpanel/serverpanel-pro.git',
      path: '/var/www/serverpanel-pro-staging',
      'post-deploy': 'npm install && npm run migrate && pm2 reload ecosystem.config.js --env staging',
      env: {
        NODE_ENV: 'staging'
      }
    }
  }
};