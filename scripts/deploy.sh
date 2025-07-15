#!/bin/bash

# ServerPanel Pro - Production Deployment Script
# This script handles automated deployment with zero-downtime

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="serverpanel-pro"
APP_DIR="/opt/serverpanel-pro"
BACKUP_DIR="/opt/backups/serverpanel"
LOG_FILE="/var/log/serverpanel/deploy.log"
USER="serverpanel"
SERVICE_NAME="serverpanel"

# Default values
BRANCH="main"
SKIP_BACKUP=false
SKIP_TESTS=false
FORCE_DEPLOY=false
DRY_RUN=false

# Functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}" | tee -a "$LOG_FILE"
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${BLUE}[INFO] $1${NC}" | tee -a "$LOG_FILE"
}

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

ServerPanel Pro Production Deployment Script

OPTIONS:
    -b, --branch BRANCH     Git branch to deploy (default: main)
    -s, --skip-backup       Skip database backup
    -t, --skip-tests        Skip running tests
    -f, --force             Force deployment even if tests fail
    -d, --dry-run           Show what would be done without executing
    -h, --help              Show this help message

EXAMPLES:
    $0                      # Deploy main branch with full checks
    $0 -b develop          # Deploy develop branch
    $0 -s -t               # Deploy without backup and tests
    $0 -d                  # Dry run to see what would happen

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--branch)
            BRANCH="$2"
            shift 2
            ;;
        -s|--skip-backup)
            SKIP_BACKUP=true
            shift
            ;;
        -t|--skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        -f|--force)
            FORCE_DEPLOY=true
            shift
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

# Pre-deployment checks
pre_deployment_checks() {
    log "Starting pre-deployment checks..."
    
    # Check if running as appropriate user
    if [[ $EUID -eq 0 ]] && [[ ! $DRY_RUN == true ]]; then
        error "Do not run this script as root. Use: sudo -u $USER $0"
    fi
    
    # Check if application directory exists
    if [[ ! -d "$APP_DIR" ]]; then
        error "Application directory $APP_DIR does not exist"
    fi
    
    # Check if git is available
    if ! command -v git &> /dev/null; then
        error "Git is not installed"
    fi
    
    # Check if npm is available
    if ! command -v npm &> /dev/null; then
        error "npm is not installed"
    fi
    
    # Check if Node.js version is compatible
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    REQUIRED_VERSION="18.0.0"
    if ! printf '%s\n%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V -C; then
        error "Node.js version $NODE_VERSION is too old. Required: $REQUIRED_VERSION+"
    fi
    
    # Check disk space
    AVAILABLE_SPACE=$(df "$APP_DIR" | awk 'NR==2 {print $4}')
    REQUIRED_SPACE=1048576 # 1GB in KB
    if [[ $AVAILABLE_SPACE -lt $REQUIRED_SPACE ]]; then
        error "Insufficient disk space. Available: ${AVAILABLE_SPACE}KB, Required: ${REQUIRED_SPACE}KB"
    fi
    
    # Check if service is running
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        info "Service $SERVICE_NAME is currently running"
    else
        warn "Service $SERVICE_NAME is not running"
    fi
    
    log "Pre-deployment checks completed successfully"
}

# Create backup
create_backup() {
    if [[ $SKIP_BACKUP == true ]]; then
        warn "Skipping backup as requested"
        return 0
    fi
    
    log "Creating backup..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would create backup in $BACKUP_DIR"
        return 0
    fi
    
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_NAME="serverpanel_backup_$TIMESTAMP"
    BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
    
    mkdir -p "$BACKUP_PATH"
    
    # Backup database
    if command -v mysqldump &> /dev/null; then
        info "Creating MySQL database backup..."
        mysqldump -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" > "$BACKUP_PATH/database.sql"
    elif command -v pg_dump &> /dev/null; then
        info "Creating PostgreSQL database backup..."
        PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" > "$BACKUP_PATH/database.sql"
    fi
    
    # Backup application files
    info "Creating application files backup..."
    tar -czf "$BACKUP_PATH/app_files.tar.gz" \
        -C "$APP_DIR" \
        --exclude="node_modules" \
        --exclude=".git" \
        --exclude="logs/*" \
        --exclude="uploads/temp/*" \
        .
    
    # Backup configuration
    if [[ -f "$APP_DIR/.env" ]]; then
        cp "$APP_DIR/.env" "$BACKUP_PATH/env.backup"
    fi
    
    # Create backup manifest
    cat > "$BACKUP_PATH/manifest.json" << EOF
{
  "timestamp": "$TIMESTAMP",
  "version": "$(cd "$APP_DIR" && git rev-parse HEAD)",
  "branch": "$(cd "$APP_DIR" && git rev-parse --abbrev-ref HEAD)",
  "node_version": "$(node --version)",
  "npm_version": "$(npm --version)",
  "backup_size": "$(du -sh "$BACKUP_PATH" | cut -f1)"
}
EOF
    
    log "Backup created successfully: $BACKUP_PATH"
    
    # Clean old backups (keep last 5)
    find "$BACKUP_DIR" -maxdepth 1 -name "serverpanel_backup_*" -type d | sort -r | tail -n +6 | xargs rm -rf
}

# Pull latest code
pull_code() {
    log "Pulling latest code from branch: $BRANCH"
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would pull latest code from $BRANCH branch"
        return 0
    fi
    
    cd "$APP_DIR"
    
    # Fetch latest changes
    git fetch origin
    
    # Check if branch exists
    if ! git rev-parse --verify "origin/$BRANCH" &>/dev/null; then
        error "Branch '$BRANCH' does not exist on remote"
    fi
    
    # Get current and target commit hashes
    CURRENT_COMMIT=$(git rev-parse HEAD)
    TARGET_COMMIT=$(git rev-parse "origin/$BRANCH")
    
    if [[ "$CURRENT_COMMIT" == "$TARGET_COMMIT" ]]; then
        info "Already up to date with origin/$BRANCH"
    else
        info "Updating from $CURRENT_COMMIT to $TARGET_COMMIT"
        git checkout "$BRANCH"
        git pull origin "$BRANCH"
    fi
    
    log "Code updated successfully"
}

# Install dependencies
install_dependencies() {
    log "Installing/updating dependencies..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would install npm dependencies"
        return 0
    fi
    
    cd "$APP_DIR"
    
    # Check if package.json changed
    if git diff HEAD~1 --name-only | grep -q "package.json\|package-lock.json"; then
        info "Package files changed, running fresh install..."
        rm -rf node_modules
        npm ci --production
    else
        info "No package changes detected, checking for updates..."
        npm ci --production
    fi
    
    log "Dependencies installed successfully"
}

# Run database migrations
run_migrations() {
    log "Running database migrations..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would run database migrations"
        return 0
    fi
    
    cd "$APP_DIR"
    
    # Check if there are pending migrations
    if npm run migrate:status | grep -q "pending"; then
        info "Pending migrations found, applying..."
        npm run migrate:latest
    else
        info "No pending migrations"
    fi
    
    log "Database migrations completed"
}

# Run tests
run_tests() {
    if [[ $SKIP_TESTS == true ]]; then
        warn "Skipping tests as requested"
        return 0
    fi
    
    log "Running test suite..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would run test suite"
        return 0
    fi
    
    cd "$APP_DIR"
    
    # Set test environment
    export NODE_ENV=test
    
    # Run tests
    if npm test; then
        log "All tests passed"
    else
        error_msg="Tests failed"
        if [[ $FORCE_DEPLOY == true ]]; then
            warn "$error_msg, but continuing due to --force flag"
        else
            error "$error_msg. Use --force to deploy anyway"
        fi
    fi
}

# Build application
build_application() {
    log "Building application..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would build application"
        return 0
    fi
    
    cd "$APP_DIR"
    
    # Build frontend if build script exists
    if npm run | grep -q "build"; then
        info "Building frontend assets..."
        npm run build
    else
        info "No build script found, skipping"
    fi
    
    log "Application built successfully"
}

# Restart services
restart_services() {
    log "Restarting services..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would restart services"
        return 0
    fi
    
    # Restart main service
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        info "Restarting $SERVICE_NAME service..."
        sudo systemctl restart "$SERVICE_NAME"
        
        # Wait for service to start
        sleep 5
        
        # Check if service started successfully
        if systemctl is-active --quiet "$SERVICE_NAME"; then
            log "Service $SERVICE_NAME restarted successfully"
        else
            error "Service $SERVICE_NAME failed to start"
        fi
    else
        info "Starting $SERVICE_NAME service..."
        sudo systemctl start "$SERVICE_NAME"
    fi
    
    # Restart related services if they exist
    for service in nginx apache2; do
        if systemctl list-unit-files | grep -q "$service.service"; then
            if systemctl is-active --quiet "$service"; then
                info "Reloading $service configuration..."
                sudo systemctl reload "$service"
            fi
        fi
    done
}

# Health check
health_check() {
    log "Performing health check..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would perform health check"
        return 0
    fi
    
    # Wait for application to start
    sleep 10
    
    # Check health endpoint
    HEALTH_URL="http://localhost:${PORT:-3000}/health"
    
    for i in {1..30}; do
        if curl -s "$HEALTH_URL" | grep -q '"status":"OK"'; then
            log "Health check passed"
            return 0
        fi
        
        info "Health check attempt $i/30..."
        sleep 2
    done
    
    error "Health check failed after 30 attempts"
}

# Post-deployment tasks
post_deployment() {
    log "Running post-deployment tasks..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would run post-deployment tasks"
        return 0
    fi
    
    cd "$APP_DIR"
    
    # Clear application cache if script exists
    if [[ -f "scripts/clear-cache.sh" ]]; then
        info "Clearing application cache..."
        bash scripts/clear-cache.sh
    fi
    
    # Update file permissions
    info "Updating file permissions..."
    sudo chown -R "$USER:$USER" "$APP_DIR"
    chmod -R 755 "$APP_DIR"
    chmod 600 "$APP_DIR/.env" 2>/dev/null || true
    
    # Clean up temporary files
    info "Cleaning up temporary files..."
    find "$APP_DIR/uploads/temp" -type f -mtime +1 -delete 2>/dev/null || true
    find "$APP_DIR/logs" -name "*.log.*" -mtime +7 -delete 2>/dev/null || true
    
    # Send deployment notification if configured
    if [[ -n "${WEBHOOK_URL:-}" ]]; then
        info "Sending deployment notification..."
        curl -X POST "$WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -d "{\"text\":\"ServerPanel Pro deployed successfully\",\"deployment\":{\"branch\":\"$BRANCH\",\"timestamp\":\"$(date)\"}}" || true
    fi
    
    log "Post-deployment tasks completed"
}

# Rollback function
rollback() {
    local backup_path="$1"
    
    error "Deployment failed. Starting rollback..."
    
    if [[ ! -d "$backup_path" ]]; then
        error "Backup path $backup_path not found. Manual recovery required."
    fi
    
    log "Rolling back to previous version..."
    
    # Stop service
    sudo systemctl stop "$SERVICE_NAME"
    
    # Restore application files
    tar -xzf "$backup_path/app_files.tar.gz" -C "$APP_DIR"
    
    # Restore database if backup exists
    if [[ -f "$backup_path/database.sql" ]]; then
        if command -v mysql &> /dev/null; then
            mysql -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$backup_path/database.sql"
        elif command -v psql &> /dev/null; then
            PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" < "$backup_path/database.sql"
        fi
    fi
    
    # Restore configuration
    if [[ -f "$backup_path/env.backup" ]]; then
        cp "$backup_path/env.backup" "$APP_DIR/.env"
    fi
    
    # Start service
    sudo systemctl start "$SERVICE_NAME"
    
    log "Rollback completed"
}

# Main deployment function
main() {
    log "Starting ServerPanel Pro deployment..."
    log "Branch: $BRANCH"
    log "Skip backup: $SKIP_BACKUP"
    log "Skip tests: $SKIP_TESTS"
    log "Force deploy: $FORCE_DEPLOY"
    log "Dry run: $DRY_RUN"
    
    # Set trap for cleanup on failure
    BACKUP_PATH=""
    trap 'if [[ -n "$BACKUP_PATH" ]] && [[ $DRY_RUN == false ]]; then rollback "$BACKUP_PATH"; fi' ERR
    
    # Source environment variables
    if [[ -f "$APP_DIR/.env" ]]; then
        set -a
        source "$APP_DIR/.env"
        set +a
    fi
    
    # Execute deployment steps
    pre_deployment_checks
    create_backup
    pull_code
    install_dependencies
    run_migrations
    run_tests
    build_application
    restart_services
    health_check
    post_deployment
    
    # Calculate deployment time
    DEPLOY_TIME=$(($(date +%s) - START_TIME))
    
    log "✅ Deployment completed successfully in ${DEPLOY_TIME}s"
    
    if [[ $DRY_RUN == false ]]; then
        info "Application is now running at:"
        info "  - Local: http://localhost:${PORT:-3000}"
        if [[ -n "${DOMAIN:-}" ]]; then
            info "  - Public: https://$DOMAIN"
        fi
    fi
}

# Script entry point
START_TIME=$(date +%s)

# Create log directory if it doesn't exist
mkdir -p "$(dirname "$LOG_FILE")"

# Run main function
main "$@"