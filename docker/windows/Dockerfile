# Windows Server Core base image for ServerPanel Pro
FROM mcr.microsoft.com/windows/servercore:ltsc2022

# Set PowerShell as the default shell
SHELL ["powershell", "-Command", "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue';"]

# Install Chocolatey package manager
RUN Set-ExecutionPolicy Bypass -Scope Process -Force; \
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; \
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install Node.js and Git
RUN choco install nodejs.install git -y --no-progress

# Install Visual C++ Build Tools (required for some npm packages)
RUN choco install visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools" -y --no-progress

# Create application directory
RUN New-Item -ItemType Directory -Path C:\ServerPanel -Force

# Set working directory
WORKDIR C:/ServerPanel

# Create application user
RUN $password = ConvertTo-SecureString 'P@ssw0rd123!' -AsPlainText -Force; \
    New-LocalUser -Name 'serverpanel' -Password $password -FullName 'ServerPanel Service' -Description 'ServerPanel Pro service account'; \
    Add-LocalGroupMember -Group 'Users' -Member 'serverpanel'

# Create necessary directories
RUN New-Item -ItemType Directory -Path C:\ServerPanel\logs -Force; \
    New-Item -ItemType Directory -Path C:\ServerPanel\uploads -Force; \
    New-Item -ItemType Directory -Path C:\ServerPanel\backups -Force; \
    New-Item -ItemType Directory -Path C:\ServerPanel\data -Force; \
    New-Item -ItemType Directory -Path C:\ServerPanel\certificates -Force; \
    New-Item -ItemType Directory -Path C:\ProgramData\ServerPanel -Force

# Copy package files first for better caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production --no-audit --no-fund

# Copy application code
COPY . .

# Set file permissions for serverpanel user
RUN $acl = Get-Acl C:\ServerPanel; \
    $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule('serverpanel','FullControl','ContainerInherit,ObjectInherit','None','Allow'); \
    $acl.SetAccessRule($accessRule); \
    Set-Acl -Path C:\ServerPanel -AclObject $acl

# Install global npm packages for Windows service management
RUN npm install -g node-windows pm2

# Create Windows-specific configuration
RUN $config = @' \
NODE_ENV=production\
PORT=3000\
DB_CLIENT=sqlite3\
DB_FILE=C:\\ServerPanel\\data\\serverpanel.db\
SYSTEM_PLATFORM=windows\
SERVICE_MANAGER=windows\
WEB_ROOT=C:\\inetpub\\wwwroot\
LOGS_PATH=C:\\ServerPanel\\logs\
UPLOAD_PATH=C:\\ServerPanel\\uploads\
BACKUPS_PATH=C:\\ServerPanel\\backups\
POWERSHELL_ENABLED=true\
WINDOWS_SERVICES_ENABLED=true\
IIS_INTEGRATION=false\
'@; \
    Set-Content -Path C:\ServerPanel\.env -Value $config

# Run database migrations and seeds
RUN npm run migrate; npm run seed

# Create service installation script
RUN $serviceScript = @' \
const Service = require(''node-windows'').Service; \
const path = require(''path''); \
 \
const svc = new Service({ \
    name: ''ServerPanelPro'', \
    description: ''ServerPanel Pro - Server Management Panel'', \
    script: path.join(__dirname, ''src'', ''app.js''), \
    nodeOptions: [''--max_old_space_size=1024''], \
    env: [{ \
        name: ''NODE_ENV'', \
        value: ''production'' \
    }], \
    wait: 2, \
    grow: 0.5, \
    maxRestarts: 5 \
}); \
 \
svc.on(''install'', function() { \
    console.log(''ServerPanel Pro service installed''); \
    svc.start(); \
}); \
 \
svc.on(''start'', function() { \
    console.log(''ServerPanel Pro service started''); \
}); \
 \
svc.on(''error'', function(err) { \
    console.error(''Service error:'', err); \
}); \
 \
if (process.argv[2] === ''install'') { \
    svc.install(); \
} else if (process.argv[2] === ''uninstall'') { \
    svc.uninstall(); \
} else { \
    console.log(''Usage: node service.js [install|uninstall]''); \
} \
'@; \
    Set-Content -Path C:\ServerPanel\service.js -Value $serviceScript

# Create startup script
RUN $startupScript = @' \
# Start ServerPanel Pro \
Write-Host "Starting ServerPanel Pro..." \
 \
# Set environment variables \
$env:NODE_ENV = "production" \
$env:PORT = "3000" \
 \
# Change to application directory \
Set-Location C:\ServerPanel \
 \
# Start the application \
node src\app.js \
'@; \
    Set-Content -Path C:\ServerPanel\start.ps1 -Value $startupScript

# Create health check script
RUN $healthScript = @' \
try { \
    $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 10 \
    if ($response.StatusCode -eq 200) { \
        exit 0 \
    } else { \
        exit 1 \
    } \
} catch { \
    exit 1 \
} \
'@; \
    Set-Content -Path C:\ServerPanel\healthcheck.ps1 -Value $healthScript

# Expose port
EXPOSE 3000

# Create volume mount points
VOLUME ["C:/ServerPanel/data", "C:/ServerPanel/logs", "C:/ServerPanel/uploads", "C:/ServerPanel/backups"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD powershell -File C:\ServerPanel\healthcheck.ps1

# Set the user context
USER serverpanel

# Start the application
CMD ["powershell", "-File", "C:/ServerPanel/start.ps1"]