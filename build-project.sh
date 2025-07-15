#!/bin/bash

# ServerPanel Pro - Complete Project Builder
# This script creates the entire ServerPanel Pro project structure

set -euo pipefail

PROJECT_NAME="serverpanel-pro"
BASE_DIR=$(pwd)
PROJECT_DIR="$BASE_DIR/$PROJECT_NAME"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

# Check if project directory exists
if [ -d "$PROJECT_DIR" ]; then
    warn "Directory $PROJECT_DIR already exists."
    read -p "Do you want to remove it and start fresh? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$PROJECT_DIR"
        log "Removed existing directory"
    else
        error "Aborted by user"
    fi
fi

log "Creating ServerPanel Pro project structure..."

# Create main project directory
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Create directory structure
log "Creating directory structure..."
mkdir -p src/{config,middleware,routes,services,sockets,utils}
mkdir -p public/{css,js,images/{icons,backgrounds},fonts}
mkdir -p migrations seeds tests/fixtures
mkdir -p scripts windows/config
mkdir -p docker/{windows,nginx/conf.d,mysql,redis}
mkdir -p docs/images configs
mkdir -p certificates logs uploads/temp backups data

# Create package.json
log "Creating package.json..."
cat > package.json << 'EOF'
{
  "name": "serverpanel-pro",
  "version": "1.0.0",
  "description": "Production-ready cross-platform server management panel",
  "main": "src/app.js",
  "scripts": {
    "start": "node src/app.js",
    "dev": "nodemon src/app.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "build": "webpack --mode production",
    "migrate": "knex migrate:latest",
    "migrate:rollback": "knex migrate:rollback",
    "migrate:status": "knex migrate:status",
    "seed": "knex seed:run",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write src/",
    "docker:build": "docker build -t serverpanel-pro .",
    "docker:run": "docker run -p 3000:3000 serverpanel-pro",
    "pm2:start": "pm2 start ecosystem.config.js",
    "pm2:stop": "pm2 stop ecosystem.config.js",
    "pm2:restart": "pm2 restart ecosystem.config.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "compression": "^1.7.4",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "joi": "^17.11.0",
    "multer": "^1.4.5-lts.1",
    "socket.io": "^4.7.4",
    "knex": "^3.0.1",
    "sqlite3": "^5.1.6",
    "mysql2": "^3.6.5",
    "pg": "^8.11.3",
    "node-cron": "^3.0.3",
    "winston": "^3.11.0",
    "express-winston": "^4.2.0",
    "systeminformation": "^5.21.20",
    "node-ssh": "^13.1.0",
    "archiver": "^6.0.1",
    "unzipper": "^0.10.14",
    "chokidar": "^3.5.3",
    "pm2": "^5.3.0",
    "dotenv": "^16.3.1",
    "express-validator": "^7.0.1",
    "morgan": "^1.10.0",
    "cookie-parser": "^1.4.6",
    "express-session": "^1.17.3",
    "connect-redis": "^7.1.0",
    "redis": "^4.6.10",
    "nodemailer": "^6.9.7",
    "sharp": "^0.33.0",
    "pdf-parse": "^1.1.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2",
    "jest": "^29.7.0",
    "supertest": "^6.3.3",
    "webpack": "^5.89.0",
    "webpack-cli": "^5.1.4",
    "eslint": "^8.54.0",
    "prettier": "^3.1.0",
    "@types/node": "^20.10.0"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "keywords": [
    "server-management",
    "cpanel-alternative",
    "web-hosting",
    "system-administration",
    "cross-platform",
    "monitoring",
    "file-manager"
  ],
  "author": "ServerPanel Pro Team",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-org/serverpanel-pro.git"
  },
  "bugs": {
    "url": "https://github.com/your-org/serverpanel-pro/issues"
  },
  "homepage": "https://serverpanel-pro.com"
}
EOF

# Create .env.example
log "Creating .env.example..."
cat > .env.example << 'EOF'
# ServerPanel Pro Configuration
NODE_ENV=production
PORT=3000
APP_NAME="ServerPanel Pro"

# Security - CHANGE THESE IN PRODUCTION!
JWT_SECRET=your_super_secure_jwt_secret_change_in_production_minimum_32_chars
SESSION_SECRET=your_super_secure_session_secret_change_in_production_minimum_32_chars
BCRYPT_ROUNDS=12

# Database Configuration
DB_CLIENT=sqlite3
DB_FILE=./data/serverpanel.db
# For MySQL:
# DB_CLIENT=mysql
# DB_HOST=localhost
# DB_PORT=3306
# DB_USER=serverpanel
# DB_PASSWORD=your_secure_password
# DB_NAME=serverpanel

# Redis Configuration (optional)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# File Upload Settings
MAX_FILE_SIZE=100MB
UPLOAD_PATH=./uploads
TEMP_PATH=/tmp/serverpanel
ALLOWED_EXTENSIONS=.txt,.log,.conf,.json,.xml,.yml,.yaml,.js,.css,.html,.php,.py,.sh,.sql

# System Paths
WEB_ROOT=/var/www/html
LOGS_PATH=./logs
BACKUPS_PATH=./backups
CONFIGS_PATH=./configs
CERTS_PATH=./certificates

# Monitoring Settings
MONITOR_INTERVAL=30000
MONITOR_RETENTION=30
ALERTS_ENABLED=true
CPU_THRESHOLD=80.0
MEMORY_THRESHOLD=85.0
DISK_THRESHOLD=90.0

# Security Settings
RATE_LIMIT_MAX=100
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_TIME=900000
PASSWORD_MIN_LENGTH=8

# Feature Toggles
FEATURE_FILE_MANAGER=true
FEATURE_DATABASE=true
FEATURE_SERVICES=true
FEATURE_MONITORING=true
FEATURE_BACKUP=true
FEATURE_USERS=true

# SSL Configuration
SSL_ENABLED=false
SSL_CERT_PATH=./certificates/cert.pem
SSL_KEY_PATH=./certificates/key.pem

# Email Configuration
SMTP_HOST=localhost
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=noreply@localhost
EOF

# Create knexfile.js
log "Creating database configuration..."
cat > knexfile.js << 'EOF'
require('dotenv').config();

module.exports = {
  development: {
    client: process.env.DB_CLIENT || 'sqlite3',
    connection: {
      filename: process.env.DB_FILE || './data/serverpanel.db'
    },
    useNullAsDefault: true,
    migrations: {
      directory: './migrations'
    },
    seeds: {
      directory: './seeds'
    }
  },

  production: {
    client: process.env.DB_CLIENT || 'sqlite3',
    connection: process.env.DB_CLIENT === 'sqlite3' ? {
      filename: process.env.DB_FILE || './data/serverpanel.db'
    } : {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    },
    useNullAsDefault: true,
    migrations: {
      directory: './migrations'
    },
    seeds: {
      directory: './seeds'
    },
    pool: {
      min: 2,
      max: 10
    }
  }
};
EOF

# Create PM2 ecosystem config
log "Creating PM2 configuration..."
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'serverpanel-pro',
    script: 'src/app.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    node_args: '--max_old_space_size=1024'
  }]
};
EOF

# Create Jest configuration
log "Creating test configuration..."
cat > jest.config.js << 'EOF'
module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/config/**',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  verbose: true
};
EOF

# Create .gitignore
log "Creating .gitignore..."
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Environment variables
.env
.env.local
.env.production

# Logs
logs/
*.log

# Runtime data
data/
uploads/
backups/
certificates/*.pem
certificates/*.key
certificates/*.crt

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# nyc test coverage
.nyc_output

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# IDE files
.vscode/
.idea/
*.swp
*.swo
*~

# PM2
.pm2/

# Docker
.dockerignore

# Temporary files
temp/
tmp/
*.tmp
*.temp

# Build output
dist/
build/

# Cache
.cache/
.parcel-cache/

# Local configuration
config/local.js
EOF

# Create .dockerignore
log "Creating .dockerignore..."
cat > .dockerignore << 'EOF'
node_modules
npm-debug.log
.git
.gitignore
README.md
.env
.env.example
.nyc_output
coverage
logs/*
uploads/*
backups/*
data/*
certificates/*.pem
certificates/*.key
.vscode
.idea
*.swp
*.swo
*~
EOF

# Create README.md
log "Creating README.md..."
cat > README.md << 'EOF'
# 🚀 ServerPanel Pro

[![Node.js Version](https://img.shields.io/badge/node.js-18.x-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://docker.com/)

**ServerPanel Pro** is a modern, production-ready server management panel that serves as a comprehensive alternative to cPanel. Built with Node.js, it provides cross-platform support for both Windows and Linux environments.

## ✨ Features

- 🖥️ **Cross-Platform**: Native Windows and Linux support
- 📊 **Real-time Monitoring**: Live system metrics and performance charts
- 📁 **File Manager**: Complete web-based file management
- 🔧 **Service Management**: Start, stop, restart system services
- 👥 **User Management**: Role-based access control
- 🔒 **Security**: Modern authentication and authorization
- 🐳 **Docker Ready**: Container support and deployment
- 📱 **Mobile Responsive**: Works on all devices
- 🆓 **Open Source**: Free alternative to expensive control panels

## 🚀 Quick Start

### Docker Installation (Recommended)

```bash
# Clone the repository
git clone https://github.com/your-org/serverpanel-pro.git
cd serverpanel-pro

# Copy environment configuration
cp .env.example .env

# Start with Docker
docker-compose up -d

# Access the panel
open http://localhost:3000
```

### Manual Installation

```bash
# Install dependencies
npm install

# Setup database
npm run migrate
npm run seed

# Start the application
npm start
```

## 📚 Documentation

- [Installation Guide](docs/INSTALLATION.md)
- [Windows Setup](docs/WINDOWS.md)
- [API Documentation](docs/API.md)
- [Security Guide](docs/SECURITY.md)

## 🔐 Default Credentials

- **Username**: admin
- **Password**: admin123!

**⚠️ Change these immediately after first login!**

## 🤝 Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for contribution guidelines.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built with ❤️ using Node.js, Express, and modern web technologies.
EOF

# Create LICENSE
log "Creating MIT License..."
cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2024 ServerPanel Pro

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF

# Create basic favicon.ico (placeholder)
log "Creating favicon placeholder..."
# Create a simple 16x16 pixel favicon placeholder
echo -e "\x00\x00\x01\x00\x01\x00\x10\x10\x00\x00\x01\x00\x08\x00h\x05\x00\x00\x16\x00\x00\x00" > public/favicon.ico

# Create basic CSS files
log "Creating CSS files..."
cat > public/css/main.css << 'EOF'
/* ServerPanel Pro - Main Stylesheet */
:root {
    --primary: #3b82f6;
    --primary-dark: #1d4ed8;
    --secondary: #6b7280;
    --success: #10b981;
    --warning: #f59e0b;
    --error: #ef4444;
    --background: #0f172a;
    --surface: #1e293b;
    --surface-light: #334155;
    --text-primary: #f8fafc;
    --text-secondary: #cbd5e1;
    --border: #374151;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--background);
    color: var(--text-primary);
    line-height: 1.6;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1rem;
}

.btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
}

.btn-primary {
    background: var(--primary);
    color: white;
}

.btn-primary:hover {
    background: var(--primary-dark);
}

.card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    overflow: hidden;
}

.card-header {
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
}

.card-body {
    padding: 1.5rem;
}

.grid {
    display: grid;
    gap: 1.5rem;
}

.grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
.grid-cols-3 { grid-template-columns: repeat(3, 1fr); }
.grid-cols-4 { grid-template-columns: repeat(4, 1fr); }

@media (max-width: 768px) {
    .grid-cols-2,
    .grid-cols-3,
    .grid-cols-4 {
        grid-template-columns: 1fr;
    }
}
EOF

# Create basic JavaScript files
log "Creating JavaScript files..."
cat > public/js/app.js << 'EOF'
// ServerPanel Pro - Main Frontend Application
class ServerPanelApp {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.authToken = localStorage.getItem('authToken');
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.checkAuth();
    }
    
    setupEventListeners() {
        // Setup login form
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', this.handleLogin.bind(this));
        }
        
        // Setup navigation
        document.querySelectorAll('[data-page]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.showPage(link.dataset.page);
            });
        });
    }
    
    async handleLogin(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: formData.get('username'),
                    password: formData.get('password')
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.authToken = data.token;
                this.currentUser = data.user;
                localStorage.setItem('authToken', this.authToken);
                this.showDashboard();
            } else {
                this.showError(data.message);
            }
        } catch (error) {
            this.showError('Login failed. Please try again.');
        }
    }
    
    checkAuth() {
        if (this.authToken) {
            this.verifyToken();
        } else {
            this.showLogin();
        }
    }
    
    async verifyToken() {
        try {
            const response = await fetch('/api/auth/verify', {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
                this.showDashboard();
            } else {
                this.showLogin();
            }
        } catch (error) {
            this.showLogin();
        }
    }
    
    showLogin() {
        document.body.innerHTML = `
            <div class="login-container">
                <form id="loginForm" class="login-form">
                    <h1>ServerPanel Pro</h1>
                    <div class="form-group">
                        <input type="text" name="username" placeholder="Username" required>
                    </div>
                    <div class="form-group">
                        <input type="password" name="password" placeholder="Password" required>
                    </div>
                    <button type="submit" class="btn btn-primary">Sign In</button>
                </form>
            </div>
        `;
        this.setupEventListeners();
    }
    
    showDashboard() {
        this.initializeSocket();
        this.loadDashboard();
    }
    
    initializeSocket() {
        this.socket = io({
            auth: { token: this.authToken }
        });
        
        this.socket.on('systemStats', (stats) => {
            this.updateSystemStats(stats);
        });
    }
    
    updateSystemStats(stats) {
        // Update dashboard with real-time stats
        console.log('System stats updated:', stats);
    }
    
    showError(message) {
        alert(message); // Simple error display
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ServerPanelApp();
});
EOF

# Create simple SVG icons
log "Creating SVG icons..."
create_svg_icon() {
    local name="$1"
    local path="$2"
    cat > "public/images/icons/${name}.svg" << EOF
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${path}" fill="currentColor"/>
</svg>
EOF
}

# Dashboard icon
create_svg_icon "dashboard" "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"

# Files icon
create_svg_icon "files" "M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"

# System icon
create_svg_icon "system" "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"

# Monitoring icon
create_svg_icon "monitoring" "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"

# Services icon
create_svg_icon "services" "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

# Users icon
create_svg_icon "users" "M16 4c0-1.11.89-2 2-2s2 .89 2 2-.89 2-2 2-2-.89-2-2zm4 18v-6h2.5l-2.54-7.63A3.007 3.007 0 0 0 16.68 6.5c-.8 0-1.54.37-2.01.95l-.47-.76A2.996 2.996 0 0 0 11.5 5c-.8 0-1.54.37-2.01.95L9.02 6.71a3.008 3.008 0 0 0-2.34 2.02L4.14 16H6.5v6h2v-6h1.25l.4-2.5h-1.5L9.23 8.29c.18-.14.4-.22.64-.22s.46.08.64.22L11.1 13.5h-1.5l.4 2.5H11.5v6h2v-6h2.5l.4-2.5H15l.58-5.21c.18-.14.4-.22.64-.22s.46.08.64.22L17.44 13.5h-1.5l.4 2.5H18v6h2z"

# Settings icon
create_svg_icon "settings" "M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"

# Create a simple logo placeholder
log "Creating logo placeholder..."
cat > public/images/logo.png << 'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==
EOF

# Create build script for downloading additional assets
log "Creating asset download script..."
cat > scripts/download-assets.sh << 'EOF'
#!/bin/bash

# Download additional assets for ServerPanel Pro

BASE_DIR=$(dirname "$0")/../public

echo "Downloading web fonts..."
# Download Inter font files
mkdir -p "$BASE_DIR/fonts"
curl -L "https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiA.woff2" -o "$BASE_DIR/fonts/inter-regular.woff2"
curl -L "https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuI6fAZ9hiA.woff2" -o "$BASE_DIR/fonts/inter-medium.woff2"
curl -L "https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYAZ9hiA.woff2" -o "$BASE_DIR/fonts/inter-bold.woff2"

echo "Creating placeholder images..."
# Create placeholder background images
convert -size 1920x1080 gradient:blue-navy "$BASE_DIR/images/backgrounds/login-bg.jpg" 2>/dev/null || echo "Note: Install ImageMagick for better placeholder images"
convert -size 1920x1080 gradient:gray-darkgray "$BASE_DIR/images/backgrounds/dashboard-bg.jpg" 2>/dev/null || echo "Note: Install ImageMagick for better placeholder images"

echo "Assets download completed!"
EOF
chmod +x scripts/download-assets.sh

# Create main application files (just stubs pointing to artifacts)
log "Creating main application files..."

# Note about copying from artifacts
cat > SETUP_INSTRUCTIONS.md << 'EOF'
# Setup Instructions

This script has created the basic project structure. To complete the setup:

1. Copy the following files from the artifacts provided:
   - src/app.js (Main application entry point)
   - src/config/*.js (Configuration files)
   - src/middleware/*.js (Middleware files)
   - src/routes/*.js (Route files)
   - migrations/*.js (Database migrations)
   - seeds/*.js (Database seed data)
   - tests/*.js (Test files)
   - public/index.html (Frontend interface)
   - docker-compose.yml (Docker configuration)

2. Install dependencies:
   ```bash
   npm install
   ```

3. Setup environment:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

4. Initialize database:
   ```bash
   npm run migrate
   npm run seed
   ```

5. Start the application:
   ```bash
   npm start
   ```

6. Access the panel:
   Open http://localhost:3000
   Default login: admin / admin123!

For complete files, please refer to the artifacts provided in the conversation.
EOF

# Create basic deployment files
log "Creating deployment configurations..."

# Create basic docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  serverpanel:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DB_CLIENT: sqlite3
      DB_FILE: /app/data/serverpanel.db
    volumes:
      - serverpanel_data:/app/data
      - serverpanel_logs:/app/logs
      - serverpanel_uploads:/app/uploads
      - serverpanel_backups:/app/backups
    restart: unless-stopped

volumes:
  serverpanel_data:
  serverpanel_logs:
  serverpanel_uploads:
  serverpanel_backups:
EOF

# Create basic Dockerfile
cat > Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p data logs uploads backups certificates

EXPOSE 3000

USER node

CMD ["npm", "start"]
EOF

# Create completion script
log "Creating completion script..."
cat > complete-setup.sh << 'EOF'
#!/bin/bash

echo "🚀 ServerPanel Pro Setup"
echo "========================="
echo ""
echo "Project structure created successfully!"
echo ""
echo "Next steps:"
echo "1. Copy the complete source files from the conversation artifacts"
echo "2. Run: npm install"
echo "3. Run: cp .env.example .env"
echo "4. Edit .env with your settings"
echo "5. Run: npm run migrate"
echo "6. Run: npm run seed"
echo "7. Run: npm start"
echo ""
echo "For complete setup instructions, see SETUP_INSTRUCTIONS.md"
echo ""
echo "Happy server management! 🎉"
EOF
chmod +x complete-setup.sh

# Create ZIP preparation script
log "Creating ZIP preparation script..."
cat > create-zip.sh << 'EOF'
#!/bin/bash

# Create a ZIP file of the complete project
PROJECT_NAME="serverpanel-pro"
ZIP_NAME="${PROJECT_NAME}-$(date +%Y%m%d).zip"

echo "Creating ZIP file: $ZIP_NAME"

# Exclude node_modules and other large/unnecessary files
zip -r "$ZIP_NAME" . \
    -x "node_modules/*" \
    -x ".git/*" \
    -x "*.log" \
    -x "data/*" \
    -x "uploads/*" \
    -x "backups/*" \
    -x "logs/*" \
    -x "coverage/*" \
    -x ".nyc_output/*"

echo "ZIP file created: $ZIP_NAME"
echo "Size: $(du -h "$ZIP_NAME" | cut -f1)"
EOF
chmod +x create-zip.sh

log "✅ ServerPanel Pro project structure created successfully!"
echo ""
echo "📁 Project location: $PROJECT_DIR"
echo "📊 Project size: $(du -sh "$PROJECT_DIR" | cut -f1)"
echo ""
echo "🔄 Next steps:"
echo "1. cd $PROJECT_NAME"
echo "2. Copy complete source files from conversation artifacts"
echo "3. npm install"
echo "4. cp .env.example .env"
echo "5. npm run migrate && npm run seed"
echo "6. npm start"
echo ""
echo "📋 See SETUP_INSTRUCTIONS.md for detailed setup steps"
echo ""
echo "🎉 Happy coding!"