# Multi-stage build for production-ready ServerPanel Pro
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p uploads logs data backups certificates configs

# Build frontend if needed
# RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install system dependencies
RUN apk add --no-cache \
    bash \
    curl \
    wget \
    nano \
    htop \
    procps \
    net-tools \
    bind-tools \
    openssh-client \
    rsync \
    tar \
    gzip \
    unzip \
    sqlite \
    mysql-client \
    postgresql-client \
    python3 \
    py3-pip \
    sudo \
    dumb-init

# Create non-root user
RUN addgroup -g 1001 -S serverpanel && \
    adduser -S serverpanel -u 1001 -G serverpanel && \
    echo "serverpanel ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Set working directory
WORKDIR /app

# Copy application from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/uploads ./uploads
COPY --from=builder /app/logs ./logs
COPY --from=builder /app/data ./data
COPY --from=builder /app/backups ./backups
COPY --from=builder /app/certificates ./certificates
COPY --from=builder /app/configs ./configs

# Copy additional configuration files
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/healthcheck.sh /healthcheck.sh

# Make scripts executable
RUN chmod +x /entrypoint.sh /healthcheck.sh

# Set ownership
RUN chown -R serverpanel:serverpanel /app

# Create volume mount points
VOLUME ["/app/data", "/app/uploads", "/app/logs", "/app/backups", "/app/certificates"]

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /healthcheck.sh

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Switch to non-root user
USER serverpanel

# Start application
CMD ["/entrypoint.sh"]