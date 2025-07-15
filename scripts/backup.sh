#!/bin/bash

# ServerPanel Pro - Backup Script
# This script creates comprehensive backups of the ServerPanel Pro application

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
LOG_FILE="${LOG_FILE:-$APP_DIR/logs/backup.log}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="serverpanel_backup_$TIMESTAMP"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

# Database configuration
DB_CLIENT="${DB_CLIENT:-mysql}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-serverpanel}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-serverpanel}"

# Default values
COMPRESS=true
ENCRYPT=false
INCLUDE_UPLOADS=true
INCLUDE_LOGS=false
VERBOSE=false
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

ServerPanel Pro Backup Script

OPTIONS:
    -c, --compress          Compress backup (default: true)
    -e, --encrypt           Encrypt backup (default: false)
    -u, --include-uploads   Include uploads directory (default: true)
    -l, --include-logs      Include logs directory (default: false)
    -r, --retention DAYS    Retention period in days (default: 7)
    -d, --dry-run           Show what would be done without executing
    -v, --verbose           Verbose output
    -h, --help              Show this help message

EXAMPLES:
    $0                      # Standard backup
    $0 -e                   # Encrypted backup
    $0 -r 14                # Keep backups for 14 days
    $0 -d                   # Dry run

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -c|--compress)
            COMPRESS=true
            shift
            ;;
        --no-compress)
            COMPRESS=false
            shift
            ;;
        -e|--encrypt)
            ENCRYPT=true
            shift
            ;;
        -u|--include-uploads)
            INCLUDE_UPLOADS=true
            shift
            ;;
        --no-uploads)
            INCLUDE_UPLOADS=false
            shift
            ;;
        -l|--include-logs)
            INCLUDE_LOGS=true
            shift
            ;;
        -r|--retention)
            RETENTION_DAYS="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
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

# Pre-backup checks
pre_backup_checks() {
    log "Starting pre-backup checks..."
    
    # Check if backup directory exists
    if [[ ! -d "$BACKUP_DIR" ]]; then
        if [[ $DRY_RUN == true ]]; then
            info "[DRY RUN] Would create backup directory: $BACKUP_DIR"
        else
            mkdir -p "$BACKUP_DIR"
            log "Created backup directory: $BACKUP_DIR"
        fi
    fi
    
    # Check available disk space
    AVAILABLE_SPACE=$(df "$BACKUP_DIR" | awk 'NR==2 {print $4}')
    REQUIRED_SPACE=1048576 # 1GB in KB
    
    if [[ $AVAILABLE_SPACE -lt $REQUIRED_SPACE ]]; then
        error "Insufficient disk space. Available: ${AVAILABLE_SPACE}KB, Required: ${REQUIRED_SPACE}KB"
    fi
    
    # Check if database is accessible
    if [[ $DB_CLIENT == "mysql" ]]; then
        if ! command -v mysqldump &> /dev/null; then
            error "mysqldump is not installed"
        fi
        
        if ! mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" -e "SELECT 1;" &> /dev/null; then
            error "Cannot connect to MySQL database"
        fi
    elif [[ $DB_CLIENT == "postgresql" ]]; then
        if ! command -v pg_dump &> /dev/null; then
            error "pg_dump is not installed"
        fi
        
        if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" &> /dev/null; then
            error "Cannot connect to PostgreSQL database"
        fi
    fi
    
    # Check if tar is available for compression
    if [[ $COMPRESS == true ]] && ! command -v tar &> /dev/null; then
        error "tar is not installed but compression is enabled"
    fi
    
    # Check if gpg is available for encryption
    if [[ $ENCRYPT == true ]] && ! command -v gpg &> /dev/null; then
        error "gpg is not installed but encryption is enabled"
    fi
    
    log "Pre-backup checks completed successfully"
}

# Create backup directory structure
create_backup_structure() {
    log "Creating backup directory structure..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would create backup structure in: $BACKUP_PATH"
        return 0
    fi
    
    mkdir -p "$BACKUP_PATH"
    mkdir -p "$BACKUP_PATH/database"
    mkdir -p "$BACKUP_PATH/application"
    mkdir -p "$BACKUP_PATH/config"
    
    if [[ $INCLUDE_UPLOADS == true ]]; then
        mkdir -p "$BACKUP_PATH/uploads"
    fi
    
    if [[ $INCLUDE_LOGS == true ]]; then
        mkdir -p "$BACKUP_PATH/logs"
    fi
    
    log "Backup directory structure created"
}

# Backup database
backup_database() {
    log "Backing up database..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would backup database: $DB_NAME"
        return 0
    fi
    
    if [[ $DB_CLIENT == "mysql" ]]; then
        info "Creating MySQL database backup..."
        mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" \
            --routines --triggers --events --single-transaction \
            "$DB_NAME" > "$BACKUP_PATH/database/database.sql"
    elif [[ $DB_CLIENT == "postgresql" ]]; then
        info "Creating PostgreSQL database backup..."
        PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
            --verbose --clean --if-exists --create \
            "$DB_NAME" > "$BACKUP_PATH/database/database.sql"
    elif [[ $DB_CLIENT == "sqlite3" ]]; then
        info "Creating SQLite database backup..."
        DB_FILE="${DB_FILE:-$APP_DIR/data/serverpanel.db}"
        if [[ -f "$DB_FILE" ]]; then
            cp "$DB_FILE" "$BACKUP_PATH/database/database.db"
        fi
    fi
    
    log "Database backup completed"
}

# Backup application files
backup_application() {
    log "Backing up application files..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would backup application files"
        return 0
    fi
    
    # Copy application source
    info "Copying application source..."
    cp -r "$APP_DIR/src" "$BACKUP_PATH/application/"
    cp -r "$APP_DIR/public" "$BACKUP_PATH/application/"
    cp -r "$APP_DIR/migrations" "$BACKUP_PATH/application/"
    cp -r "$APP_DIR/seeds" "$BACKUP_PATH/application/"
    
    # Copy package files
    cp "$APP_DIR/package.json" "$BACKUP_PATH/application/"
    cp "$APP_DIR/package-lock.json" "$BACKUP_PATH/application/" 2>/dev/null || true
    
    # Copy configuration files
    cp "$APP_DIR/knexfile.js" "$BACKUP_PATH/application/"
    cp "$APP_DIR/ecosystem.config.js" "$BACKUP_PATH/application/" 2>/dev/null || true
    
    log "Application files backup completed"
}

# Backup configuration
backup_configuration() {
    log "Backing up configuration..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would backup configuration"
        return 0
    fi
    
    # Copy environment file (without sensitive data)
    if [[ -f "$APP_DIR/.env" ]]; then
        # Create sanitized version of .env
        grep -v -E '^(DB_PASSWORD|JWT_SECRET|SESSION_SECRET|SMTP_PASS|REDIS_PASSWORD)=' "$APP_DIR/.env" > "$BACKUP_PATH/config/env.example" || true
        
        # Copy full .env with restricted permissions
        cp "$APP_DIR/.env" "$BACKUP_PATH/config/.env.backup"
        chmod 600 "$BACKUP_PATH/config/.env.backup"
    fi
    
    # Copy nginx/apache configs if they exist
    if [[ -d "$APP_DIR/configs" ]]; then
        cp -r "$APP_DIR/configs" "$BACKUP_PATH/config/"
    fi
    
    # Copy SSL certificates if they exist
    if [[ -d "$APP_DIR/certificates" ]]; then
        cp -r "$APP_DIR/certificates" "$BACKUP_PATH/config/"
    fi
    
    log "Configuration backup completed"
}

# Backup uploads
backup_uploads() {
    if [[ $INCLUDE_UPLOADS == true ]]; then
        log "Backing up uploads..."
        
        if [[ $DRY_RUN == true ]]; then
            info "[DRY RUN] Would backup uploads directory"
            return 0
        fi
        
        if [[ -d "$APP_DIR/uploads" ]]; then
            cp -r "$APP_DIR/uploads"/* "$BACKUP_PATH/uploads/" 2>/dev/null || true
        fi
        
        log "Uploads backup completed"
    fi
}

# Backup logs
backup_logs() {
    if [[ $INCLUDE_LOGS == true ]]; then
        log "Backing up logs..."
        
        if [[ $DRY_RUN == true ]]; then
            info "[DRY RUN] Would backup logs directory"
            return 0
        fi
        
        if [[ -d "$APP_DIR/logs" ]]; then
            cp -r "$APP_DIR/logs"/* "$BACKUP_PATH/logs/" 2>/dev/null || true
        fi
        
        log "Logs backup completed"
    fi
}

# Create backup manifest
create_manifest() {
    log "Creating backup manifest..."
    
    if [[ $DRY_RUN == true ]]; then
        info "[DRY RUN] Would create backup manifest"
        return 0
    fi
    
    cat > "$BACKUP_PATH/manifest.json" << EOF
{
  "backup_name": "$BACKUP_NAME",
  "timestamp": "$TIMESTAMP",
  "version": "1.0.0",
  "app_version": "$(cat "$APP_DIR/package.json" | grep '"version"' | cut -d'"' -f4)",
  "hostname": "$(hostname)",
  "system": {
    "os": "$(uname -s)",
    "arch": "$(uname -m)",
    "kernel": "$(uname -r)"
  },
  "database": {
    "client": "$DB_CLIENT",
    "host": "$DB_HOST",
    "port": "$DB_PORT",
    "name": "$DB_NAME"
  },
  "options": {
    "compress": $COMPRESS,
    "encrypt": $ENCRYPT,
    "include_uploads": $INCLUDE_UPLOADS,
    "include_logs": $INCLUDE_LOGS
  },
  "backup_size": "$(du -sh "$BACKUP_PATH" | cut -f1)",
  "file_count": $(find "$BACKUP_PATH" -type f | wc -l)
}
EOF
    
    log "Backup manifest created"
}

# Compress backup
compress_backup() {
    if [[ $COMPRESS == true ]]; then
        log "Compressing backup..."
        
        if [[ $DRY_RUN == true ]]; then
            info "[DRY RUN] Would compress backup"
            return 0
        fi
        
        cd "$BACKUP_DIR"
        tar -czf "${BACKUP_NAME}.tar.gz" "$BACKUP_NAME"
        
        # Remove uncompressed backup
        rm -rf "$BACKUP_NAME"
        
        # Update