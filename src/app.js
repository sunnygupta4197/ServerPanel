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

// Import socket handlers
const socketHandlers = require('./sockets/socketHandlers');

class ServerPanelApp {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });
    this.port = process.env.PORT || 3000;
    
    this.initializeDatabase();
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeSockets();
    this.initializeErrorHandling();
  }

  async initializeDatabase() {
    try {
      await database.migrate.latest();
      logger.info('Database migrations completed successfully');
      
      // Run seeds in development
      if (process.env.NODE_ENV === 'development') {
        await database.seed.run();
        logger.info('Database seeds completed successfully');
      }
    } catch (error) {
      logger.error('Database initialization failed:', error);
      process.exit(1);
    }
  }

  initializeMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
      optionsSuccessStatus: 200
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: process.env.NODE_ENV === 'production' ? 100 : 1000,
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
      secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    }));

    // Logging middleware
    if (process.env.NODE_ENV === 'production') {
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
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'OK',
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

    // Serve frontend in production
    if (process.env.NODE_ENV === 'production') {
      this.app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/index.html'));
      });
    }
  }

  initializeSockets() {
    this.io.use((socket, next) => {
      // Socket authentication middleware
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }
      
      const jwt = require('jsonwebtoken');
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
        socket.userId = decoded.id;
        socket.userRole = decoded.role;
        next();
      } catch (err) {
        next(new Error('Authentication error'));
      }
    });

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
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔒 Security: ${process.env.NODE_ENV === 'production' ? 'Production' : 'Development'} mode`);
      
      if (process.env.NODE_ENV !== 'production') {
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