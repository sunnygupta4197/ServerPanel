# ServerPanel Pro - Windows Service Installation Script
# Run as Administrator

param(
    [Parameter(Mandatory=$false)]
    [string]$ServiceName = "ServerPanelPro",
    
    [Parameter(Mandatory=$false)]
    [string]$ServiceDisplayName = "ServerPanel Pro",
    
    [Parameter(Mandatory=$false)]
    [string]$ServiceDescription = "Server management panel for Windows",
    
    [Parameter(Mandatory=$false)]
    [string]$InstallPath = "C:\ServerPanel\serverpanel-pro",
    
    [Parameter(Mandatory=$false)]
    [string]$ServiceUser = "NT AUTHORITY\LocalService",
    
    [Parameter(Mandatory=$false)]
    [string]$NodePath = "",
    
    [Parameter(Mandatory=$false)]
    [switch]$Uninstall
)

# Check if running as Administrator
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script must be run as Administrator. Right-click and 'Run as Administrator'"
    exit 1
}

# Functions
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Host $logMessage
    Add-Content -Path "$env:TEMP\serverpanel-install.log" -Value $logMessage
}

function Test-ServiceExists {
    param([string]$Name)
    return (Get-Service -Name $Name -ErrorAction SilentlyContinue) -ne $null
}

function Test-NodeInstalled {
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            Write-Log "Node.js version detected: $nodeVersion"
            return $true
        }
    } catch {
        return $false
    }
    return $false
}

function Install-NodeJS {
    Write-Log "Node.js not found. Installing Node.js LTS..."
    
    $nodeUrl = "https://nodejs.org/dist/v18.19.0/node-v18.19.0-x64.msi"
    $nodeInstaller = "$env:TEMP\node-installer.msi"
    
    try {
        Write-Log "Downloading Node.js installer..."
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller -UseBasicParsing
        
        Write-Log "Installing Node.js..."
        Start-Process msiexec.exe -ArgumentList "/i", $nodeInstaller, "/quiet", "/norestart" -Wait
        
        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
        
        Remove-Item $nodeInstaller -Force
        Write-Log "Node.js installed successfully"
        return $true
    } catch {
        Write-Log "Failed to install Node.js: $_" "ERROR"
        return $false
    }
}

function Install-Prerequisites {
    Write-Log "Installing prerequisites..."
    
    # Check and install Node.js
    if (-not (Test-NodeInstalled)) {
        if (-not (Install-NodeJS)) {
            throw "Failed to install Node.js"
        }
    }
    
    # Install node-windows for service management
    Write-Log "Installing node-windows..."
    try {
        npm install -g node-windows
        Write-Log "node-windows installed successfully"
    } catch {
        Write-Log "Failed to install node-windows: $_" "ERROR"
        throw
    }
    
    # Install PM2 for process management
    Write-Log "Installing PM2..."
    try {
        npm install -g pm2
        npm install -g pm2-windows-startup
        Write-Log "PM2 installed successfully"
    } catch {
        Write-Log "Failed to install PM2: $_" "ERROR"
        throw
    }
}

function Setup-Directories {
    Write-Log "Setting up directories..."
    
    $directories = @(
        $InstallPath,
        "$InstallPath\logs",
        "$InstallPath\uploads",
        "$InstallPath\backups",
        "$InstallPath\data",
        "$InstallPath\certificates",
        "C:\ProgramData\ServerPanel"
    )
    
    foreach ($dir in $directories) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-Log "Created directory: $dir"
        }
    }
    
    # Set permissions
    try {
        $acl = Get-Acl $InstallPath
        $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule("IIS_IUSRS", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
        $acl.SetAccessRule($accessRule)
        $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule("NETWORK SERVICE", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
        $acl.SetAccessRule($accessRule)
        Set-Acl -Path $InstallPath -AclObject $acl
        Write-Log "Permissions set on $InstallPath"
    } catch {
        Write-Log "Warning: Could not set directory permissions: $_" "WARNING"
    }
}

function Install-Application {
    Write-Log "Installing ServerPanel Pro application..."
    
    # Download or copy application files
    if (Test-Path ".\src\app.js") {
        Write-Log "Copying application files from current directory..."
        Copy-Item -Path ".\*" -Destination $InstallPath -Recurse -Force -Exclude @(".git", "node_modules", "tests")
    } else {
        Write-Log "Downloading application from GitHub..."
        $zipUrl = "https://github.com/your-org/serverpanel-pro/archive/refs/heads/main.zip"
        $zipFile = "$env:TEMP\serverpanel-pro.zip"
        
        try {
            Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile -UseBasicParsing
            Expand-Archive -Path $zipFile -DestinationPath $env:TEMP -Force
            Copy-Item -Path "$env:TEMP\serverpanel-pro-main\*" -Destination $InstallPath -Recurse -Force
            Remove-Item $zipFile -Force
            Remove-Item "$env:TEMP\serverpanel-pro-main" -Recurse -Force
        } catch {
            Write-Log "Failed to download application: $_" "ERROR"
            throw
        }
    }
    
    # Install npm dependencies
    Write-Log "Installing npm dependencies..."
    Set-Location $InstallPath
    try {
        npm install --production
        Write-Log "Dependencies installed successfully"
    } catch {
        Write-Log "Failed to install dependencies: $_" "ERROR"
        throw
    }
}

function Setup-Configuration {
    Write-Log "Setting up configuration..."
    
    $envFile = "$InstallPath\.env"
    
    if (-not (Test-Path $envFile)) {
        Write-Log "Creating default configuration file..."
        
        $config = @"
# ServerPanel Pro Configuration - Windows
NODE_ENV=production
PORT=3000

# Security - CHANGE THESE IN PRODUCTION!
JWT_SECRET=change_this_jwt_secret_in_production_windows_$(Get-Random)
SESSION_SECRET=change_this_session_secret_in_production_windows_$(Get-Random)

# Database (SQLite for easy setup)
DB_CLIENT=sqlite3
DB_FILE=$($InstallPath.Replace('\', '\\'))\\data\\serverpanel.db

# Paths (Windows)
WEB_ROOT=C:\\inetpub\\wwwroot
UPLOAD_PATH=$($InstallPath.Replace('\', '\\'))\\uploads
LOGS_PATH=$($InstallPath.Replace('\', '\\'))\\logs
BACKUPS_PATH=$($InstallPath.Replace('\', '\\'))\\backups

# System
SYSTEM_LOG_DIR=C:\\Windows\\System32\\LogFiles
SERVICE_MANAGER=windows

# Features
FEATURE_FILE_MANAGER=true
FEATURE_DATABASE=true
FEATURE_SERVICES=true
FEATURE_MONITORING=true
FEATURE_BACKUP=true
FEATURE_USERS=true

# Windows specific
WINDOWS_SERVICES_ENABLED=true
POWERSHELL_ENABLED=true
IIS_INTEGRATION=true
"@
        
        Set-Content -Path $envFile -Value $config
        Write-Log "Configuration file created: $envFile"
    } else {
        Write-Log "Configuration file already exists: $envFile"
    }
}

function Setup-Database {
    Write-Log "Setting up database..."
    
    Set-Location $InstallPath
    
    try {
        # Run migrations
        npm run migrate
        Write-Log "Database migrations completed"
        
        # Run seeds
        npm run seed
        Write-Log "Database seeded with default data"
        
        Write-Log "Database setup completed successfully"
    } catch {
        Write-Log "Database setup failed: $_" "ERROR"
        throw
    }
}

function Install-WindowsService {
    Write-Log "Installing Windows service..."
    
    # Create service wrapper script
    $serviceScript = @"
const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
    name: '$ServiceName',
    description: '$ServiceDescription',
    script: path.join(__dirname, 'src', 'app.js'),
    nodeOptions: [
        '--max_old_space_size=2048'
    ],
    env: {
        name: 'NODE_ENV',
        value: 'production'
    },
    wait: 2,
    grow: 0.5,
    maxRestarts: 10
});

// Listen for the "install" event, which indicates the process is available as a service.
svc.on('install', function() {
    console.log('$ServiceDisplayName installed successfully');
    svc.start();
});

svc.on('start', function() {
    console.log('$ServiceDisplayName started successfully');
});

svc.on('stop', function() {
    console.log('$ServiceDisplayName stopped');
});

svc.on('error', function(err) {
    console.error('Service error:', err);
});

// Install the service
svc.install();
"@
    
    Set-Content -Path "$InstallPath\install-service.js" -Value $serviceScript
    
    # Install the service
    Set-Location $InstallPath
    try {
        node install-service.js
        Write-Log "Windows service installed successfully"
        
        # Wait for service to start
        Start-Sleep -Seconds 10
        
        # Check service status
        $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($service -and $service.Status -eq 'Running') {
            Write-Log "Service is running successfully"
        } else {
            Write-Log "Service installed but not running. Check logs for issues." "WARNING"
        }
    } catch {
        Write-Log "Failed to install Windows service: $_" "ERROR"
        throw
    }
}

function Setup-Firewall {
    Write-Log "Configuring Windows Firewall..."
    
    try {
        $port = 3000
        $ruleName = "ServerPanel Pro HTTP"
        
        # Remove existing rule if it exists
        Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
        
        # Add new firewall rule
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow
        Write-Log "Firewall rule added for port $port"
    } catch {
        Write-Log "Failed to configure firewall: $_" "WARNING"
    }
}

function Setup-IISIntegration {
    Write-Log "Setting up IIS integration..."
    
    try {
        # Check if IIS is installed
        $iisFeature = Get-WindowsFeature -Name IIS-WebServerRole -ErrorAction SilentlyContinue
        if ($iisFeature -and $iisFeature.InstallState -eq 'Installed') {
            Write-Log "IIS detected, setting up reverse proxy..."
            
            # Install URL Rewrite and ARR if not present
            Write-Log "Note: Please install IIS URL Rewrite and Application Request Routing modules manually"
            Write-Log "Download from: https://www.iis.net/downloads/microsoft/url-rewrite"
            Write-Log "Download from: https://www.iis.net/downloads/microsoft/application-request-routing"
            
            # Create web.config for reverse proxy
            $webConfig = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <system.webServer>
        <rewrite>
            <rules>
                <rule name="ServerPanel Pro Reverse Proxy" stopProcessing="true">
                    <match url="(.*)" />
                    <action type="Rewrite" url="http://localhost:3000/{R:1}" />
                </rule>
            </rules>
        </rewrite>
    </system.webServer>
</configuration>
"@
            
            $iisPath = "C:\inetpub\wwwroot\serverpanel"
            if (-not (Test-Path $iisPath)) {
                New-Item -ItemType Directory -Path $iisPath -Force | Out-Null
            }
            Set-Content -Path "$iisPath\web.config" -Value $webConfig
            Write-Log "IIS reverse proxy configuration created"
        } else {
            Write-Log "IIS not installed, skipping IIS integration"
        }
    } catch {
        Write-Log "IIS integration setup failed: $_" "WARNING"
    }
}

function Uninstall-Service {
    Write-Log "Uninstalling ServerPanel Pro service..."
    
    try {
        # Stop and remove Windows service
        if (Test-ServiceExists $ServiceName) {
            $service = Get-Service -Name $ServiceName
            if ($service.Status -eq 'Running') {
                Stop-Service -Name $ServiceName -Force
                Write-Log "Service stopped"
            }
            
            # Create uninstall script
            $uninstallScript = @"
const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
    name: '$ServiceName',
    script: path.join(__dirname, 'src', 'app.js')
});

svc.on('uninstall', function() {
    console.log('$ServiceDisplayName uninstalled successfully');
});

svc.uninstall();
"@
            
            Set-Content -Path "$InstallPath\uninstall-service.js" -Value $uninstallScript
            Set-Location $InstallPath
            node uninstall-service.js
            
            Write-Log "Service uninstalled successfully"
        } else {
            Write-Log "Service not found"
        }
        
        # Remove firewall rule
        Remove-NetFirewallRule -DisplayName "ServerPanel Pro HTTP" -ErrorAction SilentlyContinue
        Write-Log "Firewall rule removed"
        
        # Optionally remove application files
        $removeFiles = Read-Host "Remove application files? (y/N)"
        if ($removeFiles -eq 'y' -or $removeFiles -eq 'Y') {
            Remove-Item -Path $InstallPath -Recurse -Force
            Write-Log "Application files removed"
        }
        
    } catch {
        Write-Log "Uninstall failed: $_" "ERROR"
        throw
    }
}

function Test-Installation {
    Write-Log "Testing installation..."
    
    try {
        # Test service status
        $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($service) {
            Write-Log "Service status: $($service.Status)"
        } else {
            throw "Service not found"
        }
        
        # Test HTTP endpoint
        Start-Sleep -Seconds 5
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 10
            if ($response.StatusCode -eq 200) {
                Write-Log "HTTP endpoint test passed"
            } else {
                throw "HTTP endpoint returned status code: $($response.StatusCode)"
            }
        } catch {
            Write-Log "HTTP endpoint test failed: $_" "WARNING"
        }
        
        Write-Log "Installation test completed"
        
    } catch {
        Write-Log "Installation test failed: $_" "ERROR"
        throw
    }
}

function Show-PostInstallInfo {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  ServerPanel Pro Installation Complete" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Service Name: $ServiceName" -ForegroundColor Cyan
    Write-Host "Install Path: $InstallPath" -ForegroundColor Cyan
    Write-Host "Web Interface: http://localhost:3000" -ForegroundColor Cyan
    Write-Host "Config File: $InstallPath\.env" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Default Login Credentials:" -ForegroundColor Yellow
    Write-Host "  Username: admin" -ForegroundColor Yellow
    Write-Host "  Password: admin123!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "IMPORTANT SECURITY NOTES:" -ForegroundColor Red
    Write-Host "1. Change default passwords immediately" -ForegroundColor Red
    Write-Host "2. Update JWT_SECRET and SESSION_SECRET in .env" -ForegroundColor Red
    Write-Host "3. Configure HTTPS for production use" -ForegroundColor Red
    Write-Host "4. Review firewall settings" -ForegroundColor Red
    Write-Host ""
    Write-Host "Service Management Commands:" -ForegroundColor Cyan
    Write-Host "  Start:   Start-Service $ServiceName" -ForegroundColor White
    Write-Host "  Stop:    Stop-Service $ServiceName" -ForegroundColor White
    Write-Host "  Restart: Restart-Service $ServiceName" -ForegroundColor White
    Write-Host "  Status:  Get-Service $ServiceName" -ForegroundColor White
    Write-Host ""
    Write-Host "Log Files:" -ForegroundColor Cyan
    Write-Host "  Application: $InstallPath\logs\" -ForegroundColor White
    Write-Host "  Service: C:\ProgramData\$ServiceName\daemon\" -ForegroundColor White
    Write-Host ""
}

# Main execution
try {
    Write-Log "Starting ServerPanel Pro installation for Windows..."
    
    if ($Uninstall) {
        Uninstall-Service
        Write-Log "Uninstallation completed successfully"
        exit 0
    }
    
    # Check if service already exists
    if (Test-ServiceExists $ServiceName) {
        $overwrite = Read-Host "Service '$ServiceName' already exists. Overwrite? (y/N)"
        if ($overwrite -ne 'y' -and $overwrite -ne 'Y') {
            Write-Log "Installation cancelled by user"
            exit 0
        }
        Write-Log "Stopping existing service..."
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    }
    
    # Installation steps
    Install-Prerequisites
    Setup-Directories
    Install-Application
    Setup-Configuration
    Setup-Database
    Install-WindowsService
    Setup-Firewall
    Setup-IISIntegration
    Test-Installation
    
    Show-PostInstallInfo
    
    Write-Log "ServerPanel Pro installation completed successfully!"
    
} catch {
    Write-Log "Installation failed: $_" "ERROR"
    Write-Host ""
    Write-Host "Installation failed. Check the log file at: $env:TEMP\serverpanel-install.log" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    exit 1
}