# 🪟 ServerPanel Pro - Windows Installation Guide

Complete guide for installing and configuring ServerPanel Pro on Windows Server.

## 📋 Prerequisites

### System Requirements

**Minimum Requirements:**
- **OS**: Windows Server 2019+ or Windows 10/11 Pro
- **CPU**: 2 cores
- **RAM**: 4GB
- **Storage**: 20GB free space
- **Network**: Internet connection

**Recommended Requirements:**
- **OS**: Windows Server 2022
- **CPU**: 4+ cores
- **RAM**: 8GB+
- **Storage**: 50GB+ SSD
- **Network**: Static IP address

### Software Prerequisites

- **PowerShell 5.1+** (included with Windows)
- **Administrator privileges**
- **Windows Defender or antivirus exceptions** (optional but recommended)

## 🚀 Installation Methods

### Method 1: Automated Installation (Recommended)

The easiest way to install ServerPanel Pro on Windows using our automated installer.

#### 1. Download and Run Installer

```powershell
# Download installer (run as Administrator)
Invoke-WebRequest -Uri "https://github.com/your-org/serverpanel-pro/raw/main/windows/install-service.ps1" -OutFile "install-serverpanel.ps1"

# Run installer
.\install-serverpanel.ps1

# Or with custom parameters
.\install-serverpanel.ps1 -InstallPath "D:\ServerPanel\serverpanel-pro" -ServiceName "MyServerPanel"
```

#### 2. What the Installer Does

- ✅ Installs Node.js 18+ if not present
- ✅ Downloads latest ServerPanel Pro code
- ✅ Creates Windows service
- ✅ Sets up database and default configuration
- ✅ Configures Windows Firewall
- ✅ Sets up proper file permissions
- ✅ Starts the service automatically

### Method 2: Manual Installation

For custom setups or when you want full control over the installation process.

#### 1. Install Node.js

```powershell
# Download Node.js LTS from https://nodejs.org
# Or install via Chocolatey
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

choco install nodejs -y
```

#### 2. Create Application Directory

```powershell
# Create directories
New-Item -ItemType Directory -Path "C:\ServerPanel\serverpanel-pro" -Force
New-Item -ItemType Directory -Path "C:\ServerPanel\serverpanel-pro\logs" -Force
New-Item -ItemType Directory -Path "C:\ServerPanel\serverpanel-pro\uploads" -Force
New-Item -ItemType Directory -Path "C:\ServerPanel\serverpanel-pro\backups" -Force
New-Item -ItemType Directory -Path "C:\ServerPanel\serverpanel-pro\data" -Force

# Set location
Set-Location "C:\ServerPanel\serverpanel-pro"
```

#### 3. Download Application

```powershell
# Clone from Git
git clone https://github.com/your-org/serverpanel-pro.git .

# Or download ZIP
$zipUrl = "https://github.com/your-org/serverpanel-pro/archive/refs/heads/main.zip"
Invoke-WebRequest -Uri $zipUrl -OutFile "serverpanel-pro.zip"
Expand-Archive -Path "serverpanel-pro.zip" -DestinationPath "." -Force
Move-Item "serverpanel-pro-main\*" "." -Force
Remove-Item "serverpanel-pro-main" -Recurse -Force
Remove-Item "serverpanel-pro.zip" -Force
```

#### 4. Install Dependencies

```powershell
# Install Node.js dependencies
npm install --production

# Install global packages for Windows service management
npm install -g node-windows pm2
```

#### 5. Configure Application

```powershell
# Copy example configuration
Copy-Item ".env.example" ".env"

# Edit configuration (use notepad or your preferred editor)
notepad .env
```

**Essential Windows Configuration (.env):**

```bash
# Basic Settings
NODE_ENV=production
PORT=3000

# Security (CHANGE THESE!)
JWT_SECRET=your_super_secure_jwt_secret_for_windows_production
SESSION_SECRET=your_super_secure_session_secret_for_windows_production

# Database (SQLite for easy setup)
DB_CLIENT=sqlite3
DB_FILE=C:\ServerPanel\serverpanel-pro\data\serverpanel.db

# Windows-specific paths
WEB_ROOT=C:\inetpub\wwwroot
UPLOAD_PATH=C:\ServerPanel\serverpanel-pro\uploads
LOGS_PATH=C:\ServerPanel\serverpanel-pro\logs
BACKUPS_PATH=C:\ServerPanel\serverpanel-pro\backups

# System configuration
SYSTEM_PLATFORM=windows
SERVICE_MANAGER=windows
POWERSHELL_ENABLED=true
WINDOWS_SERVICES_ENABLED=true

# Features
FEATURE_FILE_MANAGER=true
FEATURE_DATABASE=true
FEATURE_SERVICES=true
FEATURE_MONITORING=true
FEATURE_BACKUP=true
```

#### 6. Setup Database

```powershell
# Run database migrations
npm run migrate

# Seed with default data
npm run seed
```

#### 7. Install as Windows Service

Create `install-service.js`:

```javascript
const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
    name: 'ServerPanelPro',
    description: 'ServerPanel Pro - Server Management Panel',
    script: path.join(__dirname, 'src', 'app.js'),
    nodeOptions: [
        '--max_old_space_size=1024'
    ],
    env: [{
        name: 'NODE_ENV',
        value: 'production'
    }],
    wait: 2,
    grow: 0.5,
    maxRestarts: 5
});

// Listen for the "install" event
svc.on('install', function() {
    console.log('ServerPanel Pro service installed successfully');
    svc.start();
});

svc.on('start', function() {
    console.log('ServerPanel Pro service started successfully');
});

// Install the service
svc.install();
```

Then run:

```powershell
node install-service.js
```

### Method 3: Docker Installation

Run ServerPanel Pro using Docker on Windows.

#### 1. Install Docker Desktop

Download and install Docker Desktop for Windows from https://docker.com

#### 2. Run Container

```powershell
# Create data directories
New-Item -ItemType Directory -Path "C:\ServerPanel\data" -Force
New-Item -ItemType Directory -Path "C:\ServerPanel\logs" -Force

# Run container
docker run -d `
    --name serverpanel-pro `
    -p 3000:3000 `
    -v "C:\ServerPanel\data:C:\ServerPanel\data" `
    -v "C:\ServerPanel\logs:C:\ServerPanel\logs" `
    -e NODE_ENV=production `
    serverpanel/pro:windows-latest

# Check status
docker ps
docker logs serverpanel-pro
```

## ⚙️ Configuration

### Windows-Specific Settings

#### Firewall Configuration

```powershell
# Add firewall rule for HTTP access
New-NetFirewallRule -DisplayName "ServerPanel Pro HTTP" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow

# Add firewall rule for HTTPS (if using SSL)
New-NetFirewallRule -DisplayName "ServerPanel Pro HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

#### Windows Services Integration

ServerPanel Pro can manage Windows services. Ensure the service account has appropriate permissions:

```powershell
# Grant service logon rights to service account
secedit /export /cfg C:\temp\secpol.cfg
(Get-Content C:\temp\secpol.cfg) -replace 'SeServiceLogonRight = .*', 'SeServiceLogonRight = *S-1-5-20,*S-1-5-32-544' | Set-Content C:\temp\secpol.cfg
secedit /configure /db secedit.sdb /cfg C:\temp\secpol.cfg
```

#### IIS Integration (Optional)

If you want to use IIS as a reverse proxy:

1. **Install IIS with required features:**

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole, IIS-WebServer, IIS-CommonHttpFeatures, IIS-HttpErrors, IIS-HttpLogging, IIS-RequestFiltering, IIS-StaticContent, IIS-DefaultDocument, IIS-DirectoryBrowsing
```

2. **Install URL Rewrite and ARR modules** from Microsoft IIS website

3. **Create reverse proxy configuration** in `web.config`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <system.webServer>
        <rewrite>
            <rules>
                <rule name="ServerPanel Pro Reverse Proxy" stopProcessing="true">
                    <match url="(.*)" />
                    <action type="Rewrite" url="http://localhost:3000/{R:1}" />
                    <serverVariables>
                        <set name="HTTP_X_FORWARDED_PROTO" value="https" />
                        <set name="HTTP_X_FORWARDED_FOR" value="{REMOTE_ADDR}" />
                    </serverVariables>
                </rule>
            </rules>
        </rewrite>
        <security>
            <requestFiltering>
                <requestLimits maxAllowedContentLength="104857600" />
            </requestFiltering>
        </security>
    </system.webServer>
</configuration>
```

### PowerShell Execution Policy

ServerPanel Pro uses PowerShell for system management. Configure execution policy:

```powershell
# Set execution policy (run as Administrator)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine

# Or for more restrictive environments
Set-ExecutionPolicy -ExecutionPolicy AllSigned -Scope LocalMachine
```

## 🔒 Security Configuration

### Windows Defender Exclusions

Add exclusions for better performance:

```powershell
# Add folder exclusions
Add-MpPreference -ExclusionPath "C:\ServerPanel\serverpanel-pro"
Add-MpPreference -ExclusionPath "C:\ServerPanel\serverpanel-pro\node_modules"

# Add process exclusions
Add-MpPreference -ExclusionProcess "node.exe"
Add-MpPreference -ExclusionProcess "npm.exe"
```

### Service Account Security

Create dedicated service account:

```powershell
# Create service account
$password = ConvertTo-SecureString 'SecureP@ssw0rd123!' -AsPlainText -Force
New-LocalUser -Name 'ServerPanelService' -Password $password -FullName 'ServerPanel Service Account' -Description 'Service account for ServerPanel Pro'

# Grant necessary rights
Add-LocalGroupMember -Group 'Log on as a service' -Member 'ServerPanelService'
```

### File Permissions

Set proper file permissions:

```powershell
$acl = Get-Acl "C:\ServerPanel\serverpanel-pro"

# Add permissions for service account
$accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule('ServerPanelService','FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.SetAccessRule($accessRule)

# Add permissions for IIS if using IIS integration
$accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule('IIS_IUSRS','ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')
$acl.SetAccessRule($accessRule)

Set-Acl -Path "C:\ServerPanel\serverpanel-pro" -AclObject $acl
```

## 🔧 Service Management

### Windows Service Commands

```powershell
# Check service status
Get-Service ServerPanelPro

# Start service
Start-Service ServerPanelPro

# Stop service
Stop-Service ServerPanelPro

# Restart service
Restart-Service ServerPanelPro

# View service details
Get-Service ServerPanelPro | Format-List *

# View service dependencies
Get-Service ServerPanelPro -DependentServices
Get-Service ServerPanelPro -RequiredServices
```

### Event Log Monitoring

ServerPanel Pro logs to Windows Event Log:

```powershell
# View application events
Get-EventLog -LogName Application -Source "ServerPanelPro" -Newest 50

# Monitor events in real-time
Get-EventLog -LogName Application -Source "ServerPanelPro" -After (Get-Date).AddMinutes(-5)

# Export events to file
Get-EventLog -LogName Application -Source "ServerPanelPro" | Export-Csv -Path "C:\temp\serverpanel-events.csv"
```

## 🚀 Production Deployment

### Automated Deployment Script

Use our PowerShell deployment script for production updates:

```powershell
# Download deployment script
Invoke-WebRequest -Uri "https://github.com/your-org/serverpanel-pro/raw/main/scripts/deploy-windows.ps1" -OutFile "deploy-windows.ps1"

# Run deployment
.\deploy-windows.ps1

# Deploy specific branch
.\deploy-windows.ps1 -Branch "release/v1.2"

# Deploy with custom options
.\deploy-windows.ps1 -InstallPath "D:\Apps\ServerPanel" -SkipTests -Force
```

### SSL/TLS Setup

#### Option 1: IIS with Let's Encrypt

```powershell
# Install IIS SSL certificate
Import-Module WebAdministration

# Install certificate (replace with your certificate paths)
$cert = Import-PfxCertificate -FilePath "C:\certificates\serverpanel.pfx" -CertStoreLocation Cert:\LocalMachine\My -Password (ConvertTo-SecureString "password" -AsPlainText -Force)

# Bind certificate to IIS site
New-WebBinding -Name "Default Web Site" -Protocol https -Port 443
$binding = Get-WebBinding -Name "Default Web Site" -Protocol https
$binding.AddSslCertificate($cert.Thumbprint, "my")
```

#### Option 2: Direct HTTPS in Node.js

Update your `.env` file:

```bash
# Enable HTTPS
SSL_ENABLED=true
SSL_CERT_PATH=C:\certificates\cert.pem
SSL_KEY_PATH=C:\certificates\key.pem
PORT=443
```

## 📊 Monitoring & Performance

### Performance Counters

ServerPanel Pro provides Windows-specific performance monitoring:

```powershell
# View CPU usage
(Get-Counter "\Processor(_Total)\% Processor Time").CounterSamples.CookedValue

# View memory usage
(Get-Counter "\Memory\Available MBytes").CounterSamples.CookedValue

# View process count
(Get-Counter "\System\Processes").CounterSamples.CookedValue

# Monitor ServerPanel Pro process
Get-Process -Name "node" | Where-Object {$_.MainModule.FileName -like "*serverpanel*"}
```

### Windows Event Monitoring

Configure ServerPanel Pro to monitor Windows Event Logs:

```powershell
# Grant event log read permissions to service account
wevtutil sl Application /ca:O:BAG:SYD:(A;;0xf0007;;;SY)(A;;0x7;;;BA)(A;;0x7;;;SO)(A;;0x3;;;IU)(A;;0x3;;;SU)(A;;0x3;;;S-1-5-3)(A;;0x3;;;S-1-5-33)(A;;0x1;;;S-1-5-32-573)(A;;0x5;;;ServerPanelService)
```

### Resource Monitoring

Create PowerShell script for custom monitoring:

```powershell
# monitor-resources.ps1
while ($true) {
    $cpu = (Get-Counter "\Processor(_Total)\% Processor Time").CounterSamples.CookedValue
    $memory = (Get-Counter "\Memory\Available MBytes").CounterSamples.CookedValue
    $disk = (Get-Counter "\LogicalDisk(C:)\% Free Space").CounterSamples.CookedValue
    
    $data = @{
        timestamp = (Get-Date).ToString("o")
        cpu = [math]::Round($cpu, 2)
        memory = [math]::Round($memory, 2)
        disk = [math]::Round($disk, 2)
    }
    
    # Send to ServerPanel Pro API
    $json = $data | ConvertTo-Json
    Invoke-RestMethod -Uri "http://localhost:3000/api/monitoring/metrics" -Method Post -Body $json -ContentType "application/json"
    
    Start-Sleep -Seconds 30
}
```

## 🔄 Backup & Recovery

### Automated Backup Script

```powershell
# backup-serverpanel.ps1
param(
    [string]$BackupPath = "C:\ServerPanel\Backups",
    [int]$RetentionDays = 7
)

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupName = "serverpanel_backup_$timestamp"
$fullBackupPath = Join-Path $BackupPath $backupName

# Create backup directory
New-Item -ItemType Directory -Path $fullBackupPath -Force

# Stop service
Stop-Service ServerPanelPro

try {
    # Backup database
    Copy-Item "C:\ServerPanel\serverpanel-pro\data\serverpanel.db" "$fullBackupPath\database.db"
    
    # Backup application files
    $excludeList = @("node_modules", "logs", ".git")
    $source = "C:\ServerPanel\serverpanel-pro"
    
    robocopy $source "$fullBackupPath\app" /E /XD $excludeList /XF "*.log" /NFL /NDL /NP
    
    # Backup configuration
    Copy-Item "C:\ServerPanel\serverpanel-pro\.env" "$fullBackupPath\env.backup"
    
    # Create backup manifest
    $manifest = @{
        timestamp = $timestamp
        version = "1.0.0"  # You could get this from package.json
        size = (Get-ChildItem $fullBackupPath -Recurse | Measure-Object -Property Length -Sum).Sum
    }
    $manifest | ConvertTo-Json | Out-File "$fullBackupPath\manifest.json"
    
    Write-Host "Backup completed: $fullBackupPath"
    
    # Clean old backups
    Get-ChildItem $BackupPath -Directory | 
        Where-Object { $_.Name -like "serverpanel_backup_*" -and $_.CreationTime -lt (Get-Date).AddDays(-$RetentionDays) } |
        Remove-Item -Recurse -Force
        
} finally {
    # Start service
    Start-Service ServerPanelPro
}
```

### Schedule Backup Task

```powershell
# Create scheduled task for daily backup
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-File C:\ServerPanel\scripts\backup-serverpanel.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At "2:00 AM"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName "ServerPanel Pro Backup" -Action $action -Trigger $trigger -Settings $settings -Principal $principal
```

## 🚨 Troubleshooting

### Common Windows Issues

#### Service Won't Start

```powershell
# Check service status and dependencies
Get-Service ServerPanelPro | Format-List *

# Check event logs
Get-EventLog -LogName System -Source "Service Control Manager" -Newest 10 | Where-Object {$_.Message -like "*ServerPanel*"}

# Check file permissions
Get-Acl "C:\ServerPanel\serverpanel-pro" | Format-List

# Test Node.js application directly
Set-Location "C:\ServerPanel\serverpanel-pro"
node src\app.js
```

#### Port Already in Use

```powershell
# Find what's using port 3000
netstat -ano | findstr :3000

# Kill process by PID
taskkill /PID <PID> /F

# Or change port in .env file
```

#### Permission Denied Errors

```powershell
# Reset permissions
$acl = Get-Acl "C:\ServerPanel\serverpanel-pro"
$acl.SetOwner([System.Security.Principal.NTAccount]"Administrators")
Set-Acl -Path "C:\ServerPanel\serverpanel-pro" -AclObject $acl

# Grant full control to service account
icacls "C:\ServerPanel\serverpanel-pro" /grant "ServerPanelService:(OI)(CI)F"
```

#### Database Connection Issues

```powershell
# Check if database file exists and is accessible
Test-Path "C:\ServerPanel\serverpanel-pro\data\serverpanel.db"

# Check file permissions on database
Get-Acl "C:\ServerPanel\serverpanel-pro\data\serverpanel.db"

# Test SQLite connection
sqlite3 "C:\ServerPanel\serverpanel-pro\data\serverpanel.db" ".tables"
```

#### High CPU/Memory Usage

```powershell
# Monitor Node.js processes
Get-Process -Name "node" | Sort-Object CPU -Descending

# Check for memory leaks
Get-Process -Name "node" | Select-Object ProcessName, WorkingSet, VirtualMemorySize

# Restart service if needed
Restart-Service ServerPanelPro
```

### Log File Locations

- **Application Logs**: `C:\ServerPanel\serverpanel-pro\logs\`
- **Windows Event Log**: Applications and Services Logs → ServerPanelPro
- **Service Logs**: `C:\ProgramData\ServerPanelPro\daemon\`
- **IIS Logs**: `C:\inetpub\logs\LogFiles\` (if using IIS)

### Debug Mode

Enable debug logging:

```powershell
# Add to .env file
LOG_LEVEL=debug
DEBUG=serverpanel:*

# Restart service
Restart-Service ServerPanelPro

# Monitor logs
Get-Content "C:\ServerPanel\serverpanel-pro\logs\app.log" -Wait
```

## 🔧 Advanced Configuration

### Multi-Instance Setup

Run multiple ServerPanel Pro instances:

```powershell
# Create additional instance
Copy-Item "C:\ServerPanel\serverpanel-pro" "C:\ServerPanel\serverpanel-pro-dev" -Recurse

# Update configuration for second instance
$env = Get-Content "C:\ServerPanel\serverpanel-pro-dev\.env"
$env = $env -replace "PORT=3000", "PORT=3001"
$env = $env -replace "serverpanel.db", "serverpanel-dev.db"
Set-Content "C:\ServerPanel\serverpanel-pro-dev\.env" $env

# Install as separate service
# (modify install-service.js with different name and port)
```

### Load Balancer Integration

Configure with Windows Network Load Balancing:

```powershell
# Install NLB feature
Install-WindowsFeature -Name NLB -IncludeManagementTools

# Configure NLB cluster (example)
New-NlbCluster -InterfaceName "Ethernet" -ClusterName "ServerPanel-Cluster" -ClusterPrimaryIP "192.168.1.100"
```

### Performance Optimization

```powershell
# Optimize Node.js for Windows
$env:NODE_OPTIONS = "--max-old-space-size=4096 --max-semi-space-size=256"

# Set Windows performance options
powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  # High Performance

# Optimize network settings
netsh int tcp set global autotuninglevel=normal
netsh int tcp set global chimney=enabled
netsh int tcp set global rss=enabled
```

## 📚 Additional Resources

### Windows-Specific Features

1. **Windows Event Log Integration**: Monitor system events
2. **PowerShell Command Execution**: Administrative tasks
3. **Windows Service Management**: Start/stop/restart services
4. **Registry Access**: Read system configuration (read-only)
5. **Performance Counters**: Real-time system metrics
6. **Task Scheduler Integration**: Automated maintenance
7. **IIS Integration**: Web server management
8. **Windows Firewall Management**: Security configuration

### PowerShell Modules

Useful PowerShell modules for ServerPanel Pro:

```powershell
# Install useful modules
Install-Module -Name PSWindowsUpdate -Force
Install-Module -Name Carbon -Force
Install-Module -Name Posh-SSH -Force

# Import modules in ServerPanel Pro scripts
Import-Module PSWindowsUpdate
Import-Module Carbon
```

### Windows Server Roles

ServerPanel Pro can integrate with:

- **IIS (Web Server Role)**
- **DNS Server Role**
- **DHCP Server Role**
- **File and Storage Services**
- **Remote Desktop Services**
- **Windows Server Backup**

## 🔗 Support Resources

- **Windows-specific Issues**: [GitHub Issues](https://github.com/your-org/serverpanel-pro/issues) with `windows` label
- **PowerShell Help**: `Get-Help` command and [PowerShell Documentation](https://docs.microsoft.com/powershell/)
- **Windows Server Documentation**: [Microsoft Docs](https://docs.microsoft.com/windows-server/)
- **IIS Documentation**: [IIS Configuration Reference](https://docs.microsoft.com/iis/)

---

## 🏁 Quick Start Summary

```powershell
# 1. Download and run installer (as Administrator)
Invoke-WebRequest -Uri "https://github.com/your-org/serverpanel-pro/raw/main/windows/install-service.ps1" -OutFile "install.ps1"
.\install.ps1

# 2. Access application
# http://localhost:3000
# Default login: admin / admin123!

# 3. Manage service
Get-Service ServerPanelPro
Start-Service ServerPanelPro
Stop-Service ServerPanelPro

# 4. View logs
Get-Content "C:\ServerPanel\serverpanel-pro\logs\app.log" -Wait
```

**🎉 Your Windows server management panel is now ready!**