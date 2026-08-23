const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { body, param, query, validationResult } = require('express-validator');
const { requireRole, requirePermission } = require('../middleware/authMiddleware');
const logger = require('../config/logger');
const config = require('../config/config');
const database = require('../config/database');

const execAsync = promisify(exec);

// Get database information
router.get('/info', requirePermission('database:read'), async (req, res) => {
  try {
    const dbConfig = database.client.config;
    const info = {
      client: dbConfig.client,
      connection: {
        host: dbConfig.connection.host || 'localhost',
        port: dbConfig.connection.port || 3306,
        database: dbConfig.connection.database || 'serverpanel'
      },
      pool: dbConfig.pool
    };

    // Get database size and table count
    let stats = {};
    
    if (dbConfig.client === 'mysql' || dbConfig.client === 'mysql2') {
      const result = await database.raw(`
        SELECT 
          COUNT(*) as table_count,
          ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb
        FROM information_schema.tables 
        WHERE table_schema = ?
      `, [dbConfig.connection.database]);
      
      stats = result[0][0];
    } else if (dbConfig.client === 'pg') {
      const result = await database.raw(`
        SELECT 
          COUNT(*) as table_count,
          ROUND(pg_database_size(current_database()) / 1024 / 1024, 2) as size_mb
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      
      stats = result.rows[0];
    } else if (dbConfig.client === 'sqlite3') {
      const tables = await database.raw(`
        SELECT COUNT(*) as table_count
        FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'
      `);

      let sizeMb = null;
      try {
        const dbFile = dbConfig.connection?.filename;
        if (dbFile) {
          const fsStat = await fs.stat(dbFile);
          sizeMb = (fsStat.size / 1024 / 1024).toFixed(2);
        }
      } catch { /* ignore */ }

      stats = {
        table_count: tables[0].table_count,
        size_mb: sizeMb,
      };
    }

    res.json({
      success: true,
      data: {
        info,
        stats
      }
    });
  } catch (error) {
    logger.error('Error getting database info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve database information'
    });
  }
});

// Get database tables
router.get('/tables', requirePermission('database:read'), async (req, res) => {
  try {
    const dbConfig = database.client.config;
    let tables = [];

    if (dbConfig.client === 'mysql' || dbConfig.client === 'mysql2') {
      const result = await database.raw(`
        SELECT 
          table_name,
          table_rows,
          ROUND(((data_length + index_length) / 1024 / 1024), 2) as size_mb,
          engine,
          table_collation
        FROM information_schema.tables 
        WHERE table_schema = ?
        ORDER BY table_name
      `, [dbConfig.connection.database]);
      
      tables = result[0];
    } else if (dbConfig.client === 'pg') {
      const result = await database.raw(`
        SELECT 
          tablename as table_name,
          schemaname,
          tableowner
        FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY tablename
      `);
      
      tables = result.rows;
    } else if (dbConfig.client === 'sqlite3') {
      const result = await database.raw(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'
        ORDER BY name
      `);

      const tableNames = result.map(r => r.name);

      // Get row count for each table in parallel
      const counts = await Promise.all(
        tableNames.map(name =>
          database(name).count('* as count').then(r => parseInt(r[0].count, 10)).catch(() => 0)
        )
      );

      // Try DBSTAT virtual table for per-table byte sizes
      let sizeMap = {};
      try {
        const dbstatRows = await database.raw(
          `SELECT name, SUM(pgsize) as bytes FROM dbstat GROUP BY name`
        );
        dbstatRows.forEach(r => { sizeMap[r.name] = r.bytes; });
      } catch { /* DBSTAT not available; leave sizes as — */ }

      tables = tableNames.map((name, i) => ({
        name,
        rows: counts[i],
        size: sizeMap[name] != null ? Math.round(sizeMap[name] / 1024) + ' KB' : '—',
        engine: 'SQLite',
      }));
    }

    res.json({
      success: true,
      data: tables
    });
  } catch (error) {
    logger.error('Error getting database tables:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve database tables'
    });
  }
});

// Get table structure
router.get('/tables/:tableName/structure', 
  requirePermission('database:read'),
  [
    param('tableName').isLength({ min: 1 }).matches(/^[a-zA-Z0-9_]+$/)
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { tableName } = req.params;
      const dbConfig = database.client.config;
      let structure = [];

      if (dbConfig.client === 'mysql' || dbConfig.client === 'mysql2') {
        const result = await database.raw(`
          SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default,
            column_key,
            extra
          FROM information_schema.columns 
          WHERE table_schema = ? AND table_name = ?
          ORDER BY ordinal_position
        `, [dbConfig.connection.database, tableName]);
        
        structure = result[0];
      } else if (dbConfig.client === 'pg') {
        const result = await database.raw(`
          SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default
          FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = ?
          ORDER BY ordinal_position
        `, [tableName]);
        
        structure = result.rows;
      } else if (dbConfig.client === 'sqlite3') {
        const result = await database.raw(`PRAGMA table_info(${tableName})`);
        structure = result.map(col => ({
          column_name: col.name,
          data_type: col.type,
          is_nullable: col.notnull ? 'NO' : 'YES',
          column_default: col.dflt_value,
          column_key: col.pk ? 'PRI' : ''
        }));
      }

      res.json({
        success: true,
        data: {
          tableName,
          structure
        }
      });
    } catch (error) {
      logger.error('Error getting table structure:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve table structure'
      });
    }
  }
);

// Get table data
router.get('/tables/:tableName/data',
  requirePermission('database:read'),
  [
    param('tableName').isLength({ min: 1 }).matches(/^[a-zA-Z0-9_]+$/),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 1000 }),
    query('orderBy').optional().isString(),
    query('orderDirection').optional().isIn(['asc', 'desc'])
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { tableName } = req.params;
      const { page = 1, limit = 50, orderBy, orderDirection = 'asc' } = req.query;
      const offset = (page - 1) * limit;

      // Build query
      let query = database(tableName);
      
      if (orderBy) {
        query = query.orderBy(orderBy, orderDirection);
      }

      // Get total count
      const [{ count }] = await database(tableName).count('* as count');

      // Get data with pagination
      const data = await query.limit(limit).offset(offset);

      res.json({
        success: true,
        data: {
          tableName,
          rows: data,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(count),
            pages: Math.ceil(count / limit)
          }
        }
      });
    } catch (error) {
      logger.error('Error getting table data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve table data'
      });
    }
  }
);


// Create database backup
router.post('/backup',
  requirePermission('database:write'),
  [
    body('name').optional().isLength({ min: 1, max: 100 })
      .matches(/^[a-zA-Z0-9_-]+$/).withMessage('Name may only contain letters, numbers, dashes, and underscores'),
    body('compress').optional().isBoolean(),
    body('includeData').optional().isBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { name, compress = true, includeData = true } = req.body;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = name || `backup_${timestamp}`;
      const backupPath = path.join(config.PATHS.BACKUPS, `${backupName}.sql`);

      // Ensure backup directory exists
      await fs.mkdir(config.PATHS.BACKUPS, { recursive: true });

      const dbConfig = database.client.config.connection;
      let command;

      if (database.client.config.client === 'mysql' || database.client.config.client === 'mysql2') {
        command = `mysqldump -h ${dbConfig.host} -P ${dbConfig.port} -u ${dbConfig.user} -p${dbConfig.password}`;
        
        if (!includeData) {
          command += ' --no-data';
        }
        
        command += ` ${dbConfig.database} > ${backupPath}`;
      } else if (database.client.config.client === 'pg') {
        command = `PGPASSWORD=${dbConfig.password} pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user}`;
        
        if (!includeData) {
          command += ' --schema-only';
        }
        
        command += ` ${dbConfig.database} > ${backupPath}`;
      } else if (database.client.config.client === 'sqlite3') {
        const dbFile = dbConfig.filename || path.join(__dirname, '../data/serverpanel.db');
        command = `sqlite3 ${dbFile} .dump > ${backupPath}`;
      }

      await execAsync(command);

      // Compress if requested
      if (compress) {
        await execAsync(`gzip ${backupPath}`);
        const compressedPath = `${backupPath}.gz`;
        
        const stats = await fs.stat(compressedPath);
        
        res.json({
          success: true,
          message: 'Database backup created successfully',
          data: {
            backupName: `${backupName}.sql.gz`,
            backupPath: compressedPath,
            size: stats.size,
            compressed: true
          }
        });
      } else {
        const stats = await fs.stat(backupPath);
        
        res.json({
          success: true,
          message: 'Database backup created successfully',
          data: {
            backupName: `${backupName}.sql`,
            backupPath,
            size: stats.size,
            compressed: false
          }
        });
      }

      logger.info(`Database backup created by ${req.user.username}: ${backupName}`);
    } catch (error) {
      logger.error('Error creating database backup:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create database backup',
        error: error.message
      });
    }
  }
);

// Restore database backup
router.post('/restore',
  requireRole('admin'),
  [
    body('backupPath').isLength({ min: 1 }).withMessage('Backup path is required'),
    body('confirm').equals('true').withMessage('Confirmation required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { backupPath } = req.body;

      // Security check - ensure backup path is within backups directory
      const resolvedPath = path.resolve(backupPath);
      const backupsDir = path.resolve(config.PATHS.BACKUPS);

      if (resolvedPath !== backupsDir && !resolvedPath.startsWith(backupsDir + path.sep)) {
        return res.status(403).json({
          success: false,
          message: 'Invalid backup path'
        });
      }

      // resolvedPath is now confirmed to live inside backupsDir, but its
      // filename portion is still attacker-controlled and gets embedded in a
      // shell command below (gunzip/mysql/psql/sqlite3 pipelines) — reject
      // anything with shell metacharacters even though it's path-contained.
      if (!/^[a-zA-Z0-9._-]+$/.test(path.basename(resolvedPath))) {
        return res.status(400).json({
          success: false,
          message: 'Invalid backup file name'
        });
      }

      // Check if backup file exists
      try {
        await fs.access(resolvedPath);
      } catch {
        return res.status(404).json({
          success: false,
          message: 'Backup file not found'
        });
      }

      const dbConfig = database.client.config.connection;
      let command;

      if (database.client.config.client === 'mysql' || database.client.config.client === 'mysql2') {
        command = `mysql -h ${dbConfig.host} -P ${dbConfig.port} -u ${dbConfig.user} -p${dbConfig.password} ${dbConfig.database}`;
        
        if (backupPath.endsWith('.gz')) {
          command = `gunzip -c ${resolvedPath} | ${command}`;
        } else {
          command = `${command} < ${resolvedPath}`;
        }
      } else if (database.client.config.client === 'pg') {
        command = `PGPASSWORD=${dbConfig.password} psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} ${dbConfig.database}`;
        
        if (backupPath.endsWith('.gz')) {
          command = `gunzip -c ${resolvedPath} | ${command}`;
        } else {
          command = `${command} < ${resolvedPath}`;
        }
      } else if (database.client.config.client === 'sqlite3') {
        const dbFile = dbConfig.filename || path.join(__dirname, '../data/serverpanel.db');
        
        if (backupPath.endsWith('.gz')) {
          command = `gunzip -c ${resolvedPath} | sqlite3 ${dbFile}`;
        } else {
          command = `sqlite3 ${dbFile} < ${resolvedPath}`;
        }
      }

      await execAsync(command);

      logger.info(`Database restored from backup by ${req.user.username}: ${backupPath}`);

      res.json({
        success: true,
        message: 'Database restored successfully'
      });
    } catch (error) {
      logger.error('Error restoring database:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to restore database',
        error: error.message
      });
    }
  }
);

// Get database backups
router.get('/backups', requirePermission('database:read'), async (req, res) => {
  try {
    const backupsDir = config.PATHS.BACKUPS;
    
    // Ensure backups directory exists
    await fs.mkdir(backupsDir, { recursive: true });
    
    const files = await fs.readdir(backupsDir);
    const backups = [];

    for (const file of files) {
      if (file.endsWith('.sql') || file.endsWith('.sql.gz')) {
        const filePath = path.join(backupsDir, file);
        const stats = await fs.stat(filePath);
        
        backups.push({
          name: file,
          path: filePath,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          compressed: file.endsWith('.gz')
        });
      }
    }

    // Sort by creation date (newest first)
    backups.sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json({
      success: true,
      data: backups
    });
  } catch (error) {
    logger.error('Error getting database backups:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve database backups'
    });
  }
});

// Delete database backup
router.delete('/backups/:backupName',
  requirePermission('database:write'),
  [
    param('backupName').isLength({ min: 1 }).matches(/^[a-zA-Z0-9._-]+\.(sql|sql\.gz)$/)
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { backupName } = req.params;
      const backupPath = path.join(config.PATHS.BACKUPS, backupName);

      // Security check
      const resolvedPath = path.resolve(backupPath);
      const backupsDir = path.resolve(config.PATHS.BACKUPS);

      if (resolvedPath !== backupsDir && !resolvedPath.startsWith(backupsDir + path.sep)) {
        return res.status(403).json({
          success: false,
          message: 'Invalid backup path'
        });
      }

      // Check if backup exists
      try {
        await fs.access(resolvedPath);
      } catch {
        return res.status(404).json({
          success: false,
          message: 'Backup file not found'
        });
      }

      // Delete backup
      await fs.unlink(resolvedPath);

      logger.info(`Database backup deleted by ${req.user.username}: ${backupName}`);

      res.json({
        success: true,
        message: 'Backup deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting database backup:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete backup'
      });
    }
  }
);

// Get database statistics
router.get('/stats', requirePermission('database:read'), async (req, res) => {
  try {
    const dbConfig = database.client.config;
    const stats = {
      client: dbConfig.client,
      uptime: null,
      connections: null,
      queries: null,
      slow_queries: null
    };

    if (dbConfig.client === 'mysql' || dbConfig.client === 'mysql2') {
      try {
        const [status] = await database.raw('SHOW STATUS');
        const statusMap = {};
        status.forEach(row => {
          statusMap[row.Variable_name] = row.Value;
        });

        stats.uptime = statusMap.Uptime;
        stats.connections = statusMap.Threads_connected;
        stats.queries = statusMap.Questions;
        stats.slow_queries = statusMap.Slow_queries;
      } catch (error) {
        logger.warn('Could not get MySQL status:', error.message);
      }
    } else if (dbConfig.client === 'pg') {
      try {
        const [result] = await database.raw(`
          SELECT 
            extract(epoch from now() - pg_postmaster_start_time()) as uptime,
            count(*) as connections
          FROM pg_stat_activity
        `);
        
        stats.uptime = result.uptime;
        stats.connections = result.connections;
      } catch (error) {
        logger.warn('Could not get PostgreSQL status:', error.message);
      }
    }

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting database statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve database statistics'
    });
  }
});

// Get query history
router.get('/queries/history', requirePermission('database:read'), async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Get query history from activity logs
    const queries = await database('activity_logs')
      .select('user_id', 'details', 'ip_address', 'performed_at')
      .where('action', 'sql_query')
      .orderBy('performed_at', 'desc')
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count }] = await database('activity_logs')
      .where('action', 'sql_query')
      .count('id as count');

    // Get usernames
    const userIds = [...new Set(queries.map(q => q.user_id))];
    const users = await database('users')
      .select('id', 'username')
      .whereIn('id', userIds);

    const userMap = {};
    users.forEach(user => {
      userMap[user.id] = user.username;
    });

    // Format queries
    const formattedQueries = queries.map(query => ({
      ...query,
      username: userMap[query.user_id] || 'Unknown',
      query_details: JSON.parse(query.details || '{}')
    }));

    res.json({
      success: true,
      data: {
        queries: formattedQueries,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(count),
          pages: Math.ceil(count / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Error getting query history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve query history'
    });
  }
});

module.exports = router;