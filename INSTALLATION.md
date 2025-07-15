# ServerPanel Pro - Installation Guide

## 📋 Prerequisites

### System Requirements

**Minimum Requirements:**
- **OS**: Linux (Ubuntu 20.04+, CentOS 8+, Debian 11+) or Windows Server 2019+
- **CPU**: 2 cores
- **RAM**: 4GB
- **Storage**: 20GB free space
- **Network**: Internet connection for package downloads

**Recommended Requirements:**
- **OS**: Ubuntu 22.04 LTS or Rocky Linux 9
- **CPU**: 4+ cores
- **RAM**: 8GB+
- **Storage**: 50GB+ SSD
- **Network**: Static IP address

### Software Prerequisites

- **Node.js**: 18.x or later
- **npm**: 8.x or later  
- **Database**: MySQL 8.0+, PostgreSQL 15+, or SQLite 3
- **Redis**: 7.x (optional but recommended)
- **Git**: For cloning the repository

## 🚀 Installation Methods

### Method 1: Docker Installation (Recommended)

Docker installation is the fastest and most reliable method for production deployments.

#### 1. Install Docker and Docker Compose

**Ubuntu/Debian:**
```bash
# Update package index
sudo apt update

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

**CentOS/RHEL/Rocky Linux:**
```bash
# Install Docker
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

#### 2. Clone and Deploy

```bash
# Clone the repository
git clone https://github.com/your-org/serverpanel-pro.git
cd serverpanel-pro

# Copy environment configuration
cp .env.example .env

# Edit configuration (see Configuration section below)
nano .env

# Start with basic services
docker compose up -d

# Or start with monitoring and logging
docker compose --profile monitoring --profile logging up -d

# Or start everything including mail server
docker compose --profile monitoring --profile logging --profile mail up -d
```

#### 3. Initial Setup

```bash
# Check if services are running
docker compose ps

# View logs
docker compose logs -f serverpanel

# Access the application
open http://localhost:3000
```

### Method 2: Manual Installation

For custom deployments or development environments.

#### 1. Install Node.js

**Using NodeSource repository (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Using package manager (CentOS/RHEL):**
```bash
sudo dnf module install nodejs:18/common
```

#### 2. Install Database

**MySQL 8.0:**
```bash
# Ubuntu/Debian
sudo apt install mysql-server

# CentOS/RHEL
sudo dnf install mysql-server

# Start and enable
sudo systemctl start mysqld
sudo systemctl enable mysqld

# Secure installation
sudo mysql_secure_installation

# Create database and user
mysql -u root -p
CREATE DATABASE serverpanel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'serverpanel'@'localhost' IDENTIFIED BY 'secure_password';
GRANT ALL PRIVILEGES ON serverpanel.* TO 'serverpanel'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

**PostgreSQL 15:**
```bash
# Ubuntu/Debian
sudo apt install postgresql postgresql-contrib

# CentOS/RHEL
sudo dnf install postgresql-server postgresql-contrib

# Initialize and start
sudo postgresql-setup --initdb
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql
CREATE DATABASE serverpanel;
CREATE USER serverpanel WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE serverpanel TO serverpanel;
\q
```

#### 3. Install Redis (Optional)

```bash
# Ubuntu/Debian
sudo apt install redis-server

# CentOS/RHEL
sudo dnf install redis

# Start and enable
sudo systemctl start redis
sudo systemctl enable redis
```

#### 4. Clone and Setup Application

```bash
# Clone repository
git clone https://github.com/your-org/serverpanel-pro.git
cd serverpanel-pro

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
nano .env  # Edit configuration

# Run database migrations
npm run migrate

# Seed initial data (optional)
npm run seed

# Build application (if needed)
npm run build

# Start application
npm start
```

### Method 3: PM2 Production Deployment

For production environments without Docker.

#### 1. Install PM2

```bash
npm install -g pm2
```

#### 2. Create PM2 Configuration

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'serverpanel-pro',
    script: 'src/app.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
}
```

#### 3. Deploy with PM2

```bash
# Start application
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup auto-startup
pm2 startup
# Follow the instructions displayed

# Monitor application
pm2 monit
```

## ⚙️ Configuration

### Environment Variables

Edit the `.env` file with your specific configuration:

```bash
# Basic Configuration
NODE_ENV=production
PORT=3000

# Security (IMPORTANT: Change these!)
JWT_SECRET=your_super_secure_jwt_secret_at_least_32_characters_long
SESSION_SECRET=your_super_secure_session_secret_at_least_32_characters_long

# Database
DB_CLIENT=mysql
DB_HOST=localhost
DB_PORT=3306
DB_USER=serverpanel
DB_PASSWORD=your_secure_database_password
DB_NAME=serverpanel

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# Email (Optional)
SMTP_HOST=your.smtp.server
SMTP_PORT=587
SMTP_USER=your_email@domain.com
SMTP_PASS=your_email_password
EMAIL_FROM=noreply@yourdomain.com
```

### Database Setup

#### MySQL Configuration

1. **Create database:**
```sql
CREATE DATABASE serverpanel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'serverpanel'@'localhost' IDENTIFIED BY 'secure_password';
GRANT ALL PRIVILEGES ON serverpanel.* TO 'serverpanel'@'localhost';
FLUSH PRIVILEGES;
```

2. **Optimize for ServerPanel Pro** - Add to `/etc/mysql/mysql.conf.d/mysqld.cnf`:
```ini
[mysqld]
innodb_buffer_pool_size = 2G
innodb_log_file_size = 256M
innodb_flush_log_at_trx_commit = 2
query_cache_type = 1
query_cache_size = 256M
```

#### PostgreSQL Configuration

1. **Create database:**
```sql
CREATE DATABASE serverpanel;
CREATE USER serverpanel WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE serverpanel TO serverpanel;
```

2. **Configure authentication** - Edit `/etc/postgresql/15/main/pg_hba.conf`:
```
local   serverpanel     serverpanel                     md5
host    serverpanel     serverpanel     127.0.0.1/32    md5
```

### Web Server Configuration

#### Nginx Reverse Proxy

Create `/etc/nginx/sites-available/serverpanel`:
```nginx
server {
    listen 80;
    server_name panel.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name panel.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/serverpanel /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### Apache Reverse Proxy

Create `/etc/apache2/sites-available/serverpanel.conf`:
```apache
<VirtualHost *:80>
    ServerName panel.yourdomain.com
    Redirect permanent / https://panel.yourdomain.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName panel.yourdomain.com
    
    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/key.pem
    
    ProxyPreserveHost On
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
    
    # WebSocket support
    RewriteEngine on
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) "ws://localhost:3000/$1" [P,L]
</VirtualHost>
```

Enable modules and site:
```bash
sudo a2enmod ssl rewrite proxy proxy_http proxy_wstunnel
sudo a2ensite serverpanel
sudo systemctl reload apache2
```

### SSL/TLS Configuration

#### Using Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx  # For Nginx
# OR
sudo apt install certbot python3-certbot-apache # For Apache

# Get certificate
sudo certbot --nginx -d panel.yourdomain.com    # For Nginx
# OR
sudo certbot --apache -d panel.yourdomain.com   # For Apache

# Test auto-renewal
sudo certbot renew --dry-run
```

#### Using Custom Certificates

```bash
# Create certificates directory
sudo mkdir -p /etc/serverpanel/ssl

# Copy your certificates
sudo cp your-cert.pem /etc/serverpanel/ssl/cert.pem
sudo cp your-key.pem /etc/serverpanel/ssl/key.pem

# Set permissions
sudo chmod 600 /etc/serverpanel/ssl/key.pem
sudo chmod 644 /etc/serverpanel/ssl/cert.pem

# Update .env file
SSL_ENABLED=true
SSL_CERT_PATH=/etc/serverpanel/ssl/cert.pem
SSL_KEY_PATH=/etc/serverpanel/ssl/key.pem
```

## 🔐 Initial Setup

### 1. Access the Application

Open your browser and navigate to:
- Development: `http://localhost:3000`
- Production: `https://panel.yourdomain.com`

### 2. First Run Setup

On first access, you'll be prompted to create an admin account:

1. **Admin Account Creation**
   - Username: Choose a secure username (avoid 'admin', 'root')
   - Email: Your administrative email
   - Password: Strong password (minimum 8 characters, mixed case, numbers, symbols)
   - Confirm Password: Re-enter password

2. **System Configuration**
   - Server Name: A friendly name for your server
   - Domain: Your server's domain name
   - Timezone: Select your timezone
   - Language: Choose interface language

3. **Security Settings**
   - Two-Factor Authentication: Recommended to enable
   - Session Timeout: Configure session duration
   - Login Attempts: Set failed login threshold

### 3. Post-Installation Security

#### Change Default Passwords
```bash
# Generate secure passwords
openssl rand -base64 32  # For JWT_SECRET
openssl rand -base64 32  # For SESSION_SECRET
openssl rand -base64 16  # For database passwords
```

#### Set File Permissions
```bash
# Application files
sudo chown -R serverpanel:serverpanel /opt/serverpanel-pro
sudo chmod -R 755 /opt/serverpanel-pro
sudo chmod 600 /opt/serverpanel-pro/.env

# Log files
sudo chmod 755 /var/log/serverpanel
sudo chmod 644 /var/log/serverpanel/*.log

# Certificates
sudo chmod 600 /etc/serverpanel/ssl/*.key
sudo chmod 644 /etc/serverpanel/ssl/*.pem
```

#### Firewall Configuration
```bash
# Ubuntu/Debian (UFW)
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 3000/tcp    # ServerPanel (if direct access needed)
sudo ufw enable

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

## 🔧 Service Management

### Systemd Service (Manual Installation)

Create `/etc/systemd/system/serverpanel.service`:
```ini
[Unit]
Description=ServerPanel Pro
Documentation=https://github.com/your-org/serverpanel-pro
After=network.target mysql.service redis.service

[Service]
Type=simple
User=serverpanel
WorkingDirectory=/opt/serverpanel-pro
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/app.js
Restart=on-failure
RestartSec=10
LimitNOFILE=65536

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=serverpanel

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/serverpanel-pro/uploads /opt/serverpanel-pro/logs /opt/serverpanel-pro/data

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable serverpanel
sudo systemctl start serverpanel
sudo systemctl status serverpanel
```

### Docker Service Management

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# Restart specific service
docker compose restart serverpanel

# View logs
docker compose logs -f serverpanel

# Scale services
docker compose up -d --scale serverpanel=3

# Update services
docker compose pull
docker compose up -d
```

## 📊 Monitoring and Maintenance

### Health Checks

```bash
# Application health
curl http://localhost:3000/health

# Database connection
docker compose exec mysql mysqladmin ping

# Redis connection
docker compose exec redis redis-cli ping
```

### Log Management

#### Application Logs
```bash
# View real-time logs
tail -f /var/log/serverpanel/app.log

# Search logs
grep "ERROR" /var/log/serverpanel/app.log

# Rotate logs (add to crontab)
0 0 * * * /usr/sbin/logrotate /etc/logrotate.d/serverpanel
```

#### Log Rotation Configuration
Create `/etc/logrotate.d/serverpanel`:
```
/var/log/serverpanel/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 644 serverpanel serverpanel
    postrotate
        systemctl reload serverpanel
    endscript
}
```

### Backup Strategy

#### Automated Backup Script
Create `/opt/serverpanel-pro/scripts/backup.sh`:
```bash
#!/bin/bash
set -e

BACKUP_DIR="/opt/backups/serverpanel"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="serverpanel_backup_${DATE}"

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Database backup
mysqldump -u serverpanel -p${DB_PASSWORD} serverpanel > "${BACKUP_DIR}/${BACKUP_NAME}_database.sql"

# Application files backup
tar -czf "${BACKUP_DIR}/${BACKUP_NAME}_files.tar.gz" \
    /opt/serverpanel-pro/uploads \
    /opt/serverpanel-pro/certificates \
    /opt/serverpanel-pro/.env

# Clean old backups (keep 7 days)
find "${BACKUP_DIR}" -name "serverpanel_backup_*" -mtime +7 -delete

echo "Backup completed: ${BACKUP_NAME}"
```

Add to crontab:
```bash
# Daily backup at 2 AM
0 2 * * * /opt/serverpanel-pro/scripts/backup.sh >> /var/log/serverpanel/backup.log 2>&1
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Application Won't Start
```bash
# Check logs
docker compose logs serverpanel
# OR
journalctl -u serverpanel -f

# Common causes:
# - Database connection issues
# - Port already in use
# - Missing environment variables
# - File permission problems
```

#### 2. Database Connection Issues
```bash
# Test MySQL connection
mysql -h localhost -u serverpanel -p serverpanel

# Test PostgreSQL connection
psql -h localhost -U serverpanel -d serverpanel

# Check if database service is running
sudo systemctl status mysql
sudo systemctl status postgresql
```

#### 3. Permission Denied Errors
```bash
# Fix file permissions
sudo chown -R serverpanel:serverpanel /opt/serverpanel-pro
sudo chmod -R 755 /opt/serverpanel-pro
sudo chmod 600 /opt/serverpanel-pro/.env
```

#### 4. Port Already in Use
```bash
# Find what's using the port
sudo netstat -tulpn | grep :3000
sudo lsof -i :3000

# Kill the process
sudo kill -9 <PID>

# Or change the port in .env
PORT=3001
```

#### 5. SSL Certificate Issues
```bash
# Test certificate
openssl x509 -in /path/to/cert.pem -text -noout

# Check certificate expiry
openssl x509 -in /path/to/cert.pem -noout -dates

# Verify certificate chain
openssl verify -CAfile /path/to/ca.pem /path/to/cert.pem
```

### Performance Optimization

#### Node.js Optimization
```bash
# Increase memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Enable clustering
WORKERS=auto  # In .env file
```

#### Database Optimization

**MySQL:**
```sql
-- Check slow queries
SHOW VARIABLES LIKE 'slow_query_log';
SET GLOBAL slow_query_log = 'ON';

-- Optimize tables
OPTIMIZE TABLE users, login_attempts, system_stats;

-- Add indexes for common queries
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_login_attempts_timestamp ON login_attempts(attempted_at);
```

**PostgreSQL:**
```sql
-- Enable query logging
ALTER SYSTEM SET log_statement = 'all';
SELECT pg_reload_conf();

-- Analyze tables
ANALYZE users, login_attempts, system_stats;

-- Create indexes
CREATE INDEX CONCURRENTLY idx_users_username ON users(username);
CREATE INDEX CONCURRENTLY idx_login_attempts_timestamp ON login_attempts(attempted_at);
```

## 🔄 Updates and Upgrades

### Docker Updates
```bash
# Pull latest images
docker compose pull

# Recreate containers with new images
docker compose up -d

# Clean old images
docker image prune
```

### Manual Updates
```bash
# Backup before updating
./scripts/backup.sh

# Pull latest code
git fetch origin
git checkout main
git pull origin main

# Update dependencies
npm install

# Run migrations
npm run migrate

# Restart application
sudo systemctl restart serverpanel
```

### Version Rollback
```bash
# Rollback to previous version
git checkout <previous-commit-hash>
npm install
npm run migrate:rollback
sudo systemctl restart serverpanel

# Restore from backup if needed
mysql -u serverpanel -p serverpanel < /path/to/backup.sql
```

## 📚 Additional Resources

### Documentation
- [API Documentation](./docs/API.md)
- [User Guide](./docs/USER_GUIDE.md)
- [Developer Guide](./docs/DEVELOPER.md)
- [Security Guide](./docs/SECURITY.md)

### Support
- GitHub Issues: https://github.com/your-org/serverpanel-pro/issues
- Documentation: https://docs.serverpanel-pro.com
- Community Forum: https://forum.serverpanel-pro.com

### Contributing
- [Contributing Guidelines](./CONTRIBUTING.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Development Setup](./docs/DEVELOPMENT.md)

---

## 📝 License

ServerPanel Pro is released under the MIT License. See [LICENSE](./LICENSE) for details.

## 🙏 Acknowledgments

- Node.js and Express.js communities
- All contributors and beta testers
- Open source projects that made this possible