#!/usr/bin/env node

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const winston = require('winston');
const expressWinston = require('express-winston');

// Load environment variables
require('dotenv').config();

// Import configurations and middleware
const config = require('./config/config');
const database = require('./config/database');
const logger = require('./config/logger');
const { errorHandler, notFound } = require('./middleware/errorMiddleware');
const { authenticateToken } = require('./middleware/authMiddleware');

// Import routes
const authRoutes = require('./routes/auth');
const systemRoutes = require('./routes/system');
const fileRoutes = require('./routes/files');
const databaseRoutes = require('./routes/database');
const servicesRoutes = require('./routes/services');
const userRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const monitoringRoutes = require('./routes/monitoring');
const domainRoutes = require('./routes/domains');
const sslRoutes = require('./routes/ssl');
const emailRoutes = require('./routes/email');
const backupRoutes = require('./routes/backups');
const applicationRoutes = require('./routes/applications');

// Import socket handlers
const socketHandlers = require('./sockets/socketHandlers');
const jobQueue = require('./jobs/jobQueue');

class ServerPanelApp {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: config.FRONTEND.URL,
        methods: ["GET", "POST"]
      }
    });
    this.port = config.PORT;

    // Callers (e.g. tests) that care whether the DB actually initialized can
    // `await appInstance.dbInitPromise`. We still attach a no-op .catch here
    // so a failure doesn't become an unhandled rejection that crashes the
    // whole process (Node 15+ treats unhandled rejections as uncaught
    // exceptions by default) — the real error is still logged below and
    // available on the stored promise.
    this.dbInitPromise = this.initializeDatabase();
    this.dbInitPromise.catch(() => {});

    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeSockets();
    this.initializeErrorHandling();
  }

  async initializeDatabase() {
    try {
      await database.migrate.latest();
      logger.info('Database migrations completed successfully');
      
      if (process.env.SEED_DB === 'true') {
        await database.seed.run();
        logger.info('Database seeds completed successfully');
      }
    } catch (error) {
      logger.error('Database initialization failed:', error);
      throw error;
    }
  }

  initializeMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
          scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
          scriptSrcAttr: ["'unsafe-inline'"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"],
        },
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: config.FRONTEND.URL,
      credentials: true,
      optionsSuccessStatus: 200
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.SECURITY.RATE_LIMIT_WINDOW,
      max: config.NODE_ENV === 'test' ? 1000 : config.SECURITY.RATE_LIMIT_MAX,
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api/', limiter);

    // Compression and parsing
    this.app.use(compression());
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    this.app.use(cookieParser());

    // Session configuration
    this.app.use(session({
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: config.SECURITY.SESSION_TIMEOUT
      }
    }));

    // Logging middleware
    if (config.NODE_ENV === 'production') {
      this.app.use(morgan('combined'));
    } else {
      this.app.use(morgan('dev'));
    }

    this.app.use(expressWinston.logger({
      winstonInstance: logger,
      meta: true,
      msg: "HTTP {{req.method}} {{req.url}}",
      expressFormat: true,
      colorize: false,
    }));

    // Static files
    this.app.use(express.static(path.join(__dirname, '../public')));
    this.app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
  }

  initializeRoutes() {
    // Health check
    this.app.get('/health', async (req, res) => {
      let dbHealthy = true;
      try {
        await database.raw('SELECT 1');
      } catch (error) {
        dbHealthy = false;
        logger.error('Health check: database unreachable:', error);
      }

      res.status(dbHealthy ? 200 : 503).json({
        status: dbHealthy ? 'OK' : 'DEGRADED',
        database: dbHealthy ? 'connected' : 'unreachable',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    // API routes
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/system', authenticateToken, systemRoutes);
    this.app.use('/api/files', authenticateToken, fileRoutes);
    this.app.use('/api/database', authenticateToken, databaseRoutes);
    this.app.use('/api/services', authenticateToken, servicesRoutes);
    this.app.use('/api/users', authenticateToken, userRoutes);
    this.app.use('/api/settings', authenticateToken, settingsRoutes);
    this.app.use('/api/monitoring', authenticateToken, monitoringRoutes);
    this.app.use('/api/domains', authenticateToken, domainRoutes);
    this.app.use('/api/ssl', authenticateToken, sslRoutes);
    this.app.use('/api/email', authenticateToken, emailRoutes);
    this.app.use('/api/backups', authenticateToken, backupRoutes);
    this.app.use('/api/applications', authenticateToken, applicationRoutes);

    // Serve frontend for all routes (SPA)
    this.app.get('*', (req, res) => {
      // Don't serve index.html for API routes
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
      }
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
  }

  initializeSockets() {
    this.io.use((socket, next) => {
      const jwt = require('jsonwebtoken');

      // Check handshake auth token first, then fall back to auth_token cookie
      let token = socket.handshake.auth.token;
      if (!token) {
        const cookieHeader = socket.handshake.headers.cookie || '';
        const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
        token = match ? decodeURIComponent(match[1]) : null;
      }

      if (token) {
        try {
          const decoded = jwt.verify(token, config.JWT_SECRET);
          socket.userId = decoded.id;
          socket.userRole = decoded.role;
          socket.isAuthenticated = true;
        } catch {
          socket.isAuthenticated = false;
        }
      } else {
        socket.isAuthenticated = false;
      }

      next();
    });

    jobQueue.setIO(this.io);
    socketHandlers(this.io);
  }

  initializeErrorHandling() {
    // 404 handler
    this.app.use(notFound);
    
    // Error logging
    this.app.use(expressWinston.errorLogger({
      winstonInstance: logger
    }));
    
    // Global error handler
    this.app.use(errorHandler);

    // Graceful shutdown
    process.on('SIGTERM', this.gracefulShutdown.bind(this));
    process.on('SIGINT', this.gracefulShutdown.bind(this));
    
    // Unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      logger.error('Unhandled Promise Rejection:', err);
      this.gracefulShutdown();
    });

    // Uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);
      this.gracefulShutdown();
    });
  }

  gracefulShutdown() {
    logger.info('Starting graceful shutdown...');
    
    this.server.close(() => {
      logger.info('HTTP server closed');
      
      // Close database connections
      database.destroy().then(() => {
        logger.info('Database connections closed');
        process.exit(0);
      }).catch((err) => {
        logger.error('Error during database shutdown:', err);
        process.exit(1);
      });
    });

    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  }

  start() {
    this.server.listen(this.port, () => {
      logger.info(`🚀 ServerPanel Pro running on port ${this.port}`);
      logger.info(`📊 Environment: ${config.NODE_ENV}`);
      logger.info(`🔒 Security: ${config.NODE_ENV === 'production' ? 'Production' : 'Development'} mode`);

      if (config.NODE_ENV !== 'production') {
        logger.info(`🌐 Access: http://localhost:${this.port}`);
        logger.info(`📚 API Docs: http://localhost:${this.port}/api/docs`);
      }
    });
  }
}

// Start the application
if (require.main === module) {
  const app = new ServerPanelApp();
  app.start();
}

module.exports = ServerPanelApp;