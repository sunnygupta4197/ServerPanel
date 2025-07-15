# ServerPanel Pro - Windows Production Deployment Script
# Run as Administrator

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$Branch = "main",
    
    [Parameter(Mandatory=$false)]
    [string]$InstallPath = "C:\ServerPanel\serverpanel-pro",
    
    [Parameter(Mandatory=$false)]
    [string]$ServiceName = "ServerPanelPro",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipBackup,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipTests,
    
    [Parameter(Mandatory=$false)]
    [switch]$Force,
    
    [Parameter(Mandatory=$false)]
    [switch]$DryRun
)

# Check if running as Administrator
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script must be run as Administrator"
    exit 1
}

# Global variables
$script:LogFile = "$env:TEMP\serverpanel-deploy-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
$script:BackupPath = ""
$script:StartTime = Get-Date

# Functions
function Write-Log {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Message,
        
        [Parameter(Mandatory=$false)]
        [ValidateSet("INFO", "WARNING", "ERROR", "SUCCESS")]
        [string]$Level = "INFO"
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    
    switch ($Level) {
        "INFO" { Write-Host $logMessage -ForegroundColor Cyan }
        "WARNING" { Write-Host $logMessage -ForegroundColor Yellow }
        "ERROR" { Write-Host $logMessage -ForegroundColor Red }
        "SUCCESS" { Write-Host $logMessage -ForegroundColor Green }
    }
    
    Add-Content -Path $script:LogFile -Value $logMessage
}

function Test-Prerequisites {
    Write-Log "Checking prerequisites..." "INFO"
    
    # Check Node.js
    try {
        $nodeVersion = node --version
        Write-Log "Node.js version: $nodeVersion" "INFO"
    } catch {
        Write-Log "Node.js is not installed or not in PATH" "ERROR"
        return $false
    }
    
    # Check Git
    try {
        $gitVersion = git --version
        Write-Log "Git version: $gitVersion" "INFO"
    } catch {
        Write-Log "Git is not installed or not in PATH" "ERROR"
        return $false
    }
    
    # Check npm
    try {
        $npmVersion = npm --version
        Write-Log "npm version: $npmVersion" "INFO"
    } catch {
        Write-Log "npm is not available" "ERROR"
        return $false
    }
    
    # Check disk space (minimum 2GB)
    $drive = (Get-Item $InstallPath).PSDrive
    $freeSpace = (Get-PSDrive $drive.Name).Free / 1GB
    if ($freeSpace -lt 2) {
        Write-Log "Insufficient disk space. Available: $([math]::Round($freeSpace, 2))GB, Required: 2GB" "ERROR"
        return $false
    }
    
    Write-Log "Prerequisites check completed successfully" "SUCCESS"
    return $true
}

function Test-ServiceExists {
    param([string]$Name)
    try {
        $service = Get-Service -Name $Name -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function New-Backup {
    if ($SkipBackup) {
        Write-Log "Skipping backup as requested" "WARNING"
        return $null
    }
    
    Write-Log "Creating backup..." "INFO"
    
    if ($DryRun) {
        Write-Log "[DRY RUN] Would create backup" "INFO"
        return "DryRunBackup"
    }
    
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupName = "serverpanel_backup_$timestamp"
    $script:BackupPath = "C:\ServerPanel\Backups\$backupName"
    
    try {
        # Create backup directory
        New-Item -ItemType Directory -Path $script:BackupPath -Force | Out-Null
        
        # Backup database
        if (Test-Path "$InstallPath\data\serverpanel.db") {
            Copy-Item "$InstallPath\data\serverpanel.db" "$script:BackupPath\database.db"
            Write-Log "Database backup created" "INFO"
        }
        
        # Backup application files (excluding node_modules and logs)
        $excludeItems = @("node_modules", "logs", ".git", "uploads\temp")
        $archivePath = "$script:BackupPath\app_files.zip"
        
        Compress-Archive -Path "$InstallPath\*" -DestinationPath $archivePath -Force
        Write-Log "Application files backup created" "INFO"
        
        # Backup configuration
        if (Test-Path "$InstallPath\.env") {
            Copy-Item "$InstallPath\.env" "$script:BackupPath\env.backup"
            Write-Log "Configuration backup created" "INFO"
        }
        
        # Create backup manifest
        $manifest = @{
            timestamp = $timestamp
            version = if (Test-Path "$InstallPath\.git") { 
                Push-Location $InstallPath
                $version = git rev-parse HEAD
                Pop-Location
                $version
            } else { "unknown" }
            branch = if (Test-Path "$InstallPath\.git") {
                Push-Location $InstallPath
                $branch = git rev-parse --abbrev-ref HEAD
                Pop-Location
                $branch
            } else { "unknown" }
            nodeVersion = node --version
            backupSize = (Get-ChildItem $script:BackupPath -Recurse | Measure-Object -Property Length -Sum).Sum
        }
        
        $manifest | ConvertTo-Json | Out-File "$script:BackupPath\manifest.json"
        
        Write-Log "Backup created successfully: $script:BackupPath" "SUCCESS"
        
        # Clean old backups (keep last 5)
        $oldBackups = Get-ChildItem "C:\ServerPanel\Backups" -Directory | 
                     Where-Object { $_.Name -like "serverpanel_backup_*" } | 
                     Sort-Object CreationTime -Descending | 
                     Select-Object -Skip 5
        
        if ($oldBackups) {
            $oldBackups | Remove-Item -Recurse -Force
            Write-Log "Cleaned $($oldBackups.Count) old backup(s)" "INFO"
        }
        
        return $script:BackupPath
        
    } catch {
        Write-Log "Backup creation failed: $($_.Exception.Message)" "ERROR"
        throw
    }
}

function Update-Code {
    Write-Log "Updating code from branch: $Branch" "INFO"
    
    if ($DryRun) {
        Write-Log "[DRY RUN] Would update code from $Branch branch" "INFO"
        return
    }
    
    try {
        Push-Location $InstallPath
        
        # Fetch latest changes
        git fetch origin
        
        # Check if branch exists
        $branchExists = git ls-remote --heads origin $Branch
        if (-not $branchExists) {
            throw "Branch '$Branch' does not exist on remote"
        }
        
        # Get current and target commit hashes
        $currentCommit = git rev-parse HEAD
        $targetCommit = git rev-parse "origin/$Branch"
        
        if ($currentCommit -eq $targetCommit) {
            Write-Log "Already up to date with origin/$Branch" "INFO"
        } else {
            Write-Log "Updating from $currentCommit to $targetCommit" "INFO"
            git checkout $Branch
            git pull origin $Branch
            Write-Log "Code updated successfully" "SUCCESS"
        }
        
    } catch {
        Write-Log "Code update failed: $($_.Exception.Message)" "ERROR"
        throw
    } finally {
        Pop-Location
    }
}

function Install-Dependencies {
    Write-Log "Installing/updating dependencies..." "INFO"
    
    if ($DryRun) {
        Write-Log "[DRY RUN] Would install npm dependencies" "INFO"
        return
    }
    
    try {
        Push-Location $InstallPath
        
        # Check if package files changed
        $packageChanged = $false
        try {
            $changedFiles = git diff HEAD~1 --name-only
            if ($changedFiles -contains "package.json" -or $changedFiles -contains "package-lock.json") {
                $packageChanged = $true
            }
        } catch {
            # If git diff fails, assume packages changed to be safe
            $packageChanged = $true
        }
        
        if ($packageChanged) {
            Write-Log "Package files changed, running fresh install..." "INFO"
            if (Test-Path "node_modules") {
                Remove-Item "node_modules" -Recurse -Force
            }
            npm ci --production --no-audit --no-fund
        } else {
            Write-Log "No package changes detected, verifying installation..." "INFO"
            npm ci --production --no-audit --no-fund
        }
        
        Write-Log "Dependencies installed successfully" "SUCCESS"
        
    } catch {
        Write-Log "Dependencies installation failed: $($_.Exception.Message)" "ERROR"
        throw
    } finally {
        Pop-Location
    }
}

function Invoke-Migrations {
    Write-Log "Running database migrations..." "INFO"
    
    if ($DryRun) {
        Write-Log "[DRY RUN] Would run database migrations" "INFO"
        return
    }
    
    try {
        Push-Location $InstallPath
        
        # Run migrations
        npm run migrate:latest
        Write-Log "Database migrations completed successfully" "SUCCESS"
        
    } catch {
        Write-Log "Database migrations failed: $($_.Exception.Message)" "ERROR"
        throw
    } finally {
        Pop-Location
    }
}

function Invoke-Tests {
    if ($SkipTests) {
        Write-Log "Skipping tests as requested" "WARNING"
        return
    }
    
    Write-Log "Running test suite..." "INFO"
    
    if ($DryRun) {
        Write-Log "[DRY RUN] Would run test suite" "INFO"
        return
    }
    
    try {
        Push-Location $InstallPath
        
        # Set test environment
        $env:NODE_ENV = "test"
        
        # Run tests
        $testResult = npm test
        if ($LASTEXITCODE -eq 0) {
            Write-Log "All tests passed" "SUCCESS"
        } else {
            $errorMsg = "Tests failed with exit code $LASTEXITCODE"
            if ($Force) {
                Write-Log "$errorMsg, but continuing due to -Force flag" "WARNING"
            } else {
                throw $errorMsg
            }
        }
        
    } catch {
        $errorMsg = "Test execution failed: $($_.Exception.Message)"
        if ($Force) {
            Write-Log "$errorMsg, but continuing due to -Force flag" "WARNING"
        } else {
            Write-Log $errorMsg "ERROR"
            throw
        }
    } finally {
        $env:NODE_ENV = "production"
        Pop-Location
    }
}

function Build-Application {
    Write-Log "Building application..." "INFO"
    
    if ($DryRun) {
        Write-Log "[DRY RUN] Would build application" "INFO"
        return
    }
    
    try {
        Push-Location $InstallPath
        
        # Check if build script exists
        $packageJson = Get-Content "package.json" | ConvertFrom-Json
        if ($packageJson.scripts.build) {
            Write-Log "Building frontend assets..." "INFO"
            npm run build
            Write-Log "Frontend built successfully" "SUCCESS"
        } else {
            Write-Log "No build script found, skipping" "INFO"
        }
        
    } catch {
        Write-Log "Application build failed: $($_.Exception.Message)" "ERROR"
        throw
    } finally {
        Pop-Location
    }
}

function Restart-Services {
    Write-Log "Restarting services..." "INFO"
    
    if ($DryRun) {
        Write-Log "[DRY RUN] Would restart services" "INFO"
        return
    }
    
    try {
        # Restart main service
        if (Test-ServiceExists $ServiceName) {
            $service = Get-Service -Name $ServiceName
            if ($service.Status -eq 'Running') {
                Write-Log "Stopping $ServiceName service..." "INFO"
                Stop-Service -Name $ServiceName -Force
                
                # Wait for service to stop
                $timeout = 30
                do {
                    Start-Sleep -Seconds 1
                    $service = Get-Service -Name $ServiceName
                    $timeout--
                } while ($service.Status -eq 'Running' -and $timeout -gt 0)
                
                if ($service.Status -eq 'Running') {
                    throw "Service failed to stop within timeout"
                }
            }
            
            Write-Log "Starting $ServiceName service..." "INFO"
            Start-Service -Name $ServiceName
            
            # Wait for service to start
            $timeout = 30
            do {
                Start-Sleep -Seconds 1
                $service = Get-Service -Name $ServiceName
                $timeout--
            } while ($service.Status -ne 'Running' -and $timeout -gt 0)
            
            if ($service.Status -eq 'Running') {
                Write-Log "Service $ServiceName restarted successfully" "SUCCESS"
            } else {
                throw "Service failed to start within timeout"
            }
        } else {
            Write-Log "Service $ServiceName not found, attempting to start application directly..." "WARNING"
            # Could implement PM2 or direct node start here
        }
        
        # Restart IIS if it's running and we have IIS integration
        try {
            $iisService = Get-Service -Name "W3SVC" -ErrorAction SilentlyContinue
            if ($iisService -and $iisService.Status -eq 'Running') {
                Write-Log "Restarting IIS..." "INFO"
                iisreset /restart
                Write-Log "IIS restarted successfully" "SUCCESS"
            }
        } catch {
            Write-Log "IIS restart failed: $($_.Exception.Message)" "WARNING"
        }
        
    } catch {
        Write-Log "Service restart failed: $($_.Exception.Message)" "ERROR"
        throw
    }
}

function Test-HealthCheck {
    Write-Log "Performing health check..." "INFO"
    
    if ($DryRun) {
        Write-Log "[DRY RUN] Would perform health check" "INFO"
        return
    }
    
    # Wait for application to start
    Write-Log "Waiting for application to start..." "INFO"
    Start-Sleep -Seconds 15
    
    $port = 3000
    $healthUrl = "http://localhost:$port/health"
    
    for ($i = 1; $i -le 30; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 10
            if ($response.StatusCode -eq 200) {
                $content = $response.Content | ConvertFrom-Json
                if ($content.status -eq "OK") {
                    Write-Log "Health check passed" "SUCCESS"
                    return
                }
            }
        } catch {
            # Continue trying
        }
        
        Write-Log "Health check attempt $i/30..." "INFO"
        Start-Sleep -Seconds 2
    }
    
    throw "Health check failed after 30 attempts"
}

function Invoke-PostDeployment {
    Write-Log "Running post-deployment tasks..." "INFO"
    
    if ($DryRun) {
        Write-Log "[DRY RUN] Would run post-deployment tasks" "INFO"
        return
    }
    
    try {
        Push-Location $InstallPath
        
        # Clear application cache if script exists
        if (Test-Path "scripts\clear-cache.ps1") {
            Write-Log "Clearing application cache..." "INFO"
            PowerShell -File "scripts\clear-cache.ps1"
        }
        
        # Update file permissions
        Write-Log "Updating file permissions..." "INFO"
        $acl = Get-Acl $InstallPath
        $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule("IIS_IUSRS", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
        $acl.SetAccessRule($accessRule)
        $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule("NETWORK SERVICE", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
        $acl.SetAccessRule($accessRule)
        Set-Acl -Path $InstallPath -AclObject $acl
        
        # Clean up temporary files
        Write-Log "Cleaning up temporary files..." "INFO"
        if (Test-Path "$InstallPath\uploads\temp") {
            Get-ChildItem "$InstallPath\uploads\temp" -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } | Remove-Item -Force
        }
        
        if (Test-Path "$InstallPath\logs") {
            Get-ChildItem "$InstallPath\logs" -File -Filter "*.log.*" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force
        }
        
        # Send deployment notification if webhook is configured
        $envContent = Get-Content "$InstallPath\.env" -Raw
        if ($envContent -match "WEBHOOK_URL=(.+)") {
            $webhookUrl = $matches[1].Trim()
            if ($webhookUrl) {
                try {
                    Write-Log "Sending deployment notification..." "INFO"
                    $payload = @{
                        text = "ServerPanel Pro deployed successfully on Windows"
                        deployment = @{
                            branch = $Branch
                            timestamp = (Get-Date).ToString("o")
                            platform = "Windows"
                        }
                    } | ConvertTo-Json
                    
                    Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $payload -ContentType "application/json"
                } catch {
                    Write-Log "Failed to send notification: $($_.Exception.Message)" "WARNING"
                }
            }
        }
        
        Write-Log "Post-deployment tasks completed successfully" "SUCCESS"
        
    } catch {
        Write-Log "Post-deployment tasks failed: $($_.Exception.Message)" "WARNING"
    } finally {
        Pop-Location
    }
}

function Invoke-Rollback {
    param([string]$BackupPath)
    
    Write-Log "Deployment failed. Starting rollback..." "ERROR"
    
    if (-not $BackupPath -or -not (Test-Path $BackupPath)) {
        Write-Log "Backup path $BackupPath not found. Manual recovery required." "ERROR"
        return
    }
    
    try {
        Write-Log "Rolling back to previous version..." "INFO"
        
        # Stop service
        if (Test-ServiceExists $ServiceName) {
            Stop-Service -Name $ServiceName -Force
        }
        
        # Restore application files
        if (Test-Path "$BackupPath\app_files.zip") {
            Expand-Archive -Path "$BackupPath\app_files.zip" -DestinationPath $InstallPath -Force
        }
        
        # Restore database
        if (Test-Path "$BackupPath\database.db") {
            Copy-Item "$BackupPath\database.db" "$InstallPath\data\serverpanel.db" -Force
        }
        
        # Restore configuration
        if (Test-Path "$BackupPath\env.backup") {
            Copy-Item "$BackupPath\env.backup" "$InstallPath\.env" -Force
        }
        
        # Start service
        if (Test-ServiceExists $ServiceName) {
            Start-Service -Name $ServiceName
        }
        
        Write-Log "Rollback completed successfully" "SUCCESS"
        
    } catch {
        Write-Log "Rollback failed: $($_.Exception.Message)" "ERROR"
        Write-Log "Manual recovery may be required" "ERROR"
    }
}

function Show-DeploymentSummary {
    $deployTime = (Get-Date) - $script:StartTime
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Windows Deployment Complete" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Branch: $Branch" -ForegroundColor Cyan
    Write-Host "Install Path: $InstallPath" -ForegroundColor Cyan
    Write-Host "Service Name: $ServiceName" -ForegroundColor Cyan
    Write-Host "Deployment Time: $($deployTime.TotalMinutes.ToString('F2')) minutes" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Application URLs:" -ForegroundColor Yellow
    Write-Host "  Local: http://localhost:3000" -ForegroundColor White
    Write-Host "  Health: http://localhost:3000/health" -ForegroundColor White
    Write-Host ""
    Write-Host "Service Management:" -ForegroundColor Yellow
    Write-Host "  Start:   Start-Service $ServiceName" -ForegroundColor White
    Write-Host "  Stop:    Stop-Service $ServiceName" -ForegroundColor White
    Write-Host "  Restart: Restart-Service $ServiceName" -ForegroundColor White
    Write-Host "  Status:  Get-Service $ServiceName" -ForegroundColor White
    Write-Host ""
    Write-Host "Log Files:" -ForegroundColor Yellow
    Write-Host "  Deployment: $script:LogFile" -ForegroundColor White
    Write-Host "  Application: $InstallPath\logs\" -ForegroundColor White
    Write-Host ""
}

# Main deployment function
function Start-Deployment {
    Write-Log "Starting ServerPanel Pro Windows deployment..." "INFO"
    Write-Log "Parameters: Branch=$Branch, SkipBackup=$SkipBackup, SkipTests=$SkipTests, Force=$Force, DryRun=$DryRun" "INFO"
    
    try {
        # Check prerequisites
        if (-not (Test-Prerequisites)) {
            throw "Prerequisites check failed"
        }
        
        # Create application directory if it doesn't exist
        if (-not (Test-Path $InstallPath)) {
            Write-Log "Creating application directory: $InstallPath" "INFO"
            New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
        }
        
        # Set up error handling for rollback
        $backupPath = $null
        
        try {
            # Execute deployment steps
            $backupPath = New-Backup
            Update-Code
            Install-Dependencies
            Invoke-Migrations
            Invoke-Tests
            Build-Application
            Restart-Services
            Test-HealthCheck
            Invoke-PostDeployment
            
            Write-Log "Deployment completed successfully!" "SUCCESS"
            Show-DeploymentSummary
            
        } catch {
            Write-Log "Deployment step failed: $($_.Exception.Message)" "ERROR"
            
            if ($backupPath -and -not $DryRun) {
                Invoke-Rollback -BackupPath $backupPath
            }
            
            throw
        }
        
    } catch {
        Write-Log "Deployment failed: $($_.Exception.Message)" "ERROR"
        Write-Host ""
        Write-Host "Deployment failed. Check the log file: $script:LogFile" -ForegroundColor Red
        exit 1
    }
}

# Script entry point
Write-Host "ServerPanel Pro Windows Deployment Script" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Validate parameters
if (-not (Test-Path $InstallPath -IsValid)) {
    Write-Error "Invalid install path: $InstallPath"
    exit 1
}

# Start deployment
Start-Deployment

Write-Host ""
Write-Host "Deployment completed successfully!" -ForegroundColor Green
Write-Host "Log file: $script:LogFile" -ForegroundColor Cyan