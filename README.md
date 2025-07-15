# 🚀 ServerPanel Pro

**Professional Server Management Panel with Comprehensive Monitoring and Administration Tools**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-supported-blue)](https://www.docker.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Screenshots](#screenshots)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Documentation](#api-documentation)
- [Development](#development)
- [Docker Deployment](#docker-deployment)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

## 🌟 Overview

ServerPanel Pro is a comprehensive server management solution designed for system administrators, developers, and IT professionals. It provides a modern, web-based interface for monitoring, managing, and maintaining servers with real-time updates, advanced security features, and extensive customization options.

### Key Highlights

- **Real-time Monitoring**: Live system metrics, alerts, and performance tracking
- **Multi-Platform Support**: Linux, Windows, and macOS compatibility
- **Modern UI**: Dark/Light themes with responsive design
- **Advanced Security**: Role-based access control, 2FA, and audit logging
- **Extensible Architecture**: Plugin system and REST API
- **Docker Ready**: Full containerization support

## ✨ Features

### 🖥️ System Management
- **System Information**: Hardware details, OS info, and network configuration
- **Process Management**: View, monitor, and control running processes
- **Service Control**: Start, stop, restart, and manage system services
- **Resource Monitoring**: Real-time CPU, memory, disk, and network usage
- **Performance Metrics**: Historical data and trending analysis

### 📁 File Management
- **Web File Manager**: Upload, download, edit, and organize files
- **Archive Operations**: Create and extract ZIP, TAR, and compressed archives
- **Permission Management**: Set file/directory permissions and ownership
- **Bulk Operations**: Copy, move, and delete multiple files
- **Search Functionality**: Find files and content across the filesystem

### 🔐 Security & Access Control
- **User Management**: Create, edit, and manage user accounts
- **Role-Based Permissions**: Admin, User, and Viewer roles with granular permissions
- **Two-Factor Authentication**: TOTP support for enhanced security
- **Audit Logging**: Comprehensive activity tracking and reporting
- **Session Management**: Active session monitoring and control

### 📊 Monitoring & Alerts
- **Real-time Dashboards**: Live system statistics and visualizations
- **Custom Alerts**: Configurable thresholds and notifications
- **Historical Data**: Long-term storage and analysis of metrics
- **Health Checks**: Automated system health monitoring
- **Performance Graphs**: Interactive charts and trending data

### 🛠️ Advanced Features
- **Database Management**: MySQL, PostgreSQL, and SQLite support
- **Backup System**: Automated backups with retention policies
- **SSL Certificate Management**: Let's Encrypt integration
- **API Access**: RESTful API for automation and integration
- **Plugin System**: Extend functionality with custom modules

## 📸 Screenshots

### Dashboard
![Dashboard](docs/images/dashboard-screenshot.png)

### File Manager
![File Manager](docs/images/file-manager-screenshot.png)

### Monitoring
![Monitoring](docs/images/monitoring-screenshot.png)

## 🚀 Installation

### Prerequisites

- **Node.js** 18.0.0 or higher
- **npm** 8.0.0 or higher
- **Database**: MySQL 8.0+, PostgreSQL 13+, or SQLite 3
- **Redis** (optional, for sessions and caching)

### Quick Install

```bash
# Clone the repository
git clone https://github.com/serverpanel/serverpanel-pro.git
cd serverpanel-pro

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit configuration
nano .env

# Set up database
npm run db:setup

# Start the application
npm start
```

### Production Install

```bash
# Install PM2 for process management
npm install -g pm2

# Build for production
npm run build

# Start with PM2
npm run pm2:start

# Monitor processes
npm run pm2:monit
```

## ⚙️ Configuration

### Environment Variables

Edit the `.env` file to configure ServerPanel Pro:

```env
# Application Settings
NODE_ENV=production
PORT=3000
APP_NAME="ServerPanel Pro"

# Security
JWT_SECRET=your_super_secure_jwt_secret_change_in_production
SESSION_SECRET=your_session_secret_change_in_production
BCRYPT_ROUNDS=12

# Database Configuration
DB_CLIENT=mysql
DB_HOST=localhost
DB_PORT=3306
DB_USER=serverpanel
DB_PASSWORD=secure_password
DB_NAME=serverpanel

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis_password

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

### Database Setup

#### MySQL
```sql
CREATE DATABASE serverpanel;
CREATE USER 'serverpanel'@'localhost' IDENTIFIED BY 'secure_password';
GRANT ALL PRIVILEGES ON serverpanel.* TO 'serverpanel'@'localhost';
FLUSH PRIVILEGES;
```

#### PostgreSQL
```sql
CREATE DATABASE serverpanel;
CREATE USER serverpanel WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE serverpanel TO serverpanel;
```

### First Run

1. Navigate to `http://localhost:3000`
2. Login with default credentials:
   - **Username**: `admin`
   - **Password**: `admin123!`
3. **⚠️ Important**: Change the default password immediately!

## 🎯 Usage

### Basic Operations

#### System Monitoring
```javascript
// Get real-time system stats
GET /api/system/stats

// View system information
GET /api/system/info

// Check system health
GET /api/monitoring/health
```

#### File Management
```javascript
// Browse directory
GET /api/files/browse?path=/var/www

// Upload file
POST /api/files/upload

// Download file
GET /api/files/download?path=/path/to/file
```

#### Service Management
```javascript
// List services
GET /api/services

// Control service
POST /api/services/nginx/restart

// View service logs
GET /api/services/nginx/logs
```

### API Examples

#### Authentication
```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123!"}'

# Use token for subsequent requests
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/system/stats
```

#### Monitoring
```bash
# Get system statistics
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/system/stats

# Get alerts
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/monitoring/alerts
```

## 📚 API Documentation

Complete API documentation is available at `/api/docs` when running the application.

### Authentication Endpoints
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/verify` - Verify token
- `POST /api/auth/refresh` - Refresh token

### System Endpoints
- `GET /api/system/info` - System information
- `GET /api/system/stats` - Real-time statistics
- `GET /api/system/processes` - Process list
- `POST /api/system/execute` - Execute command (admin only)

### File Management Endpoints
- `GET /api/files/browse` - Browse directories
- `POST /api/files/upload` - Upload files
- `GET /api/files/download` - Download files
- `POST /api/files/mkdir` - Create directory
- `DELETE /api/files/delete` - Delete files/directories

### Monitoring Endpoints
- `GET /api/monitoring/stats` - Monitoring data
- `GET /api/monitoring/alerts` - System alerts
- `GET /api/monitoring/health` - Health summary
- `POST /api/monitoring/config` - Update configuration

## 🛠️ Development

### Development Setup

```bash
# Install development dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Run linting
npm run lint

# Run type checking
npm run type-check
```

### Project Structure

```
serverpanel-pro/
├── src/                     # Main application source
│   ├── app.js              # Application entry point
│   ├── config/             # Configuration files
│   ├── middleware/         # Express middleware
│   ├── routes/             # API routes
│   ├── services/           # Business logic
│   ├── sockets/            # WebSocket handlers
│   └── utils/              # Utility functions
├── public/                 # Frontend assets
├── migrations/             # Database migrations
├── seeds/                  # Database seed data
├── tests/                  # Test files
├── docker/                 # Docker configuration
└── docs/                   # Documentation
```

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run integration tests
npm run test:integration

# Generate coverage report
npm run test:coverage
```

### Building

```bash
# Build for production
npm run build

# Build for development
npm run build:dev

# Clean build artifacts
npm run clean
```

## 🐳 Docker Deployment

### Quick Start with Docker

```bash
# Clone and configure
git clone https://github.com/serverpanel/serverpanel-pro.git
cd serverpanel-pro
cp .env.example .env

# Edit environment variables
nano .env

# Start with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f serverpanel
```

### Docker Compose Services

- **serverpanel**: Main application
- **mysql**: Database server
- **redis**: Cache and session store
- **nginx**: Reverse proxy
- **grafana**: Advanced monitoring
- **prometheus**: Metrics collection

### Custom Docker Build

```bash
# Build custom image
docker build -t serverpanel-pro .

# Run container
docker run -d \
  --name serverpanel \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  serverpanel-pro
```

## 🔐 Security

### Security Features

- **Authentication**: JWT tokens with configurable expiration
- **Authorization**: Role-based access control (RBAC)
- **Two-Factor Authentication**: TOTP support
- **Rate Limiting**: Protection against brute force attacks
- **Input Validation**: Comprehensive request validation
- **HTTPS**: SSL/TLS encryption support
- **Security Headers**: Helmet.js integration
- **Audit Logging**: All user actions are logged

### Security Best Practices

1. **Change Default Passwords**: Always change default credentials
2. **Use HTTPS**: Enable SSL/TLS in production
3. **Regular Updates**: Keep dependencies up to date
4. **Firewall Rules**: Restrict access to necessary ports
5. **Backup Strategy**: Regular backups and disaster recovery
6. **Monitor Logs**: Review audit logs regularly

### Recommended Security Setup

```bash
# Generate secure secrets
openssl rand -base64 32  # JWT_SECRET
openssl rand -base64 32  # SESSION_SECRET

# Set up SSL certificate
sudo certbot certonly --nginx -d yourdomain.com

# Configure firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Process

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

### Code Style

- **ESLint**: Follow the configured ESLint rules
- **Prettier**: Code formatting is enforced
- **JSDoc**: Document all functions and classes
- **Tests**: Write tests for new features

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Documentation
- [Installation Guide](docs/INSTALLATION.md)
- [Windows Setup](docs/WINDOWS.md)
- [API Reference](docs/API.md)
- [Security Guide](docs/SECURITY.md)

### Community
- **GitHub Issues**: [Report bugs and feature requests](https://github.com/serverpanel/serverpanel-pro/issues)
- **Discussions**: [Community discussions](https://github.com/serverpanel/serverpanel-pro/discussions)
- **Wiki**: [Additional documentation](https://github.com/serverpanel/serverpanel-pro/wiki)

### Commercial Support
For enterprise support, custom development, and consulting services, please contact:
- **Email**: support@serverpanel.pro
- **Website**: https://serverpanel.pro

## 🙏 Acknowledgments

- **Contributors**: Thanks to all contributors who have helped build ServerPanel Pro
- **Open Source**: Built with amazing open-source technologies
- **Community**: Special thanks to the Node.js and Express.js communities

---

**ServerPanel Pro** - Professional Server Management Made Simple

*Copyright © 2024 ServerPanel Pro Team. All rights reserved.*