const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { requirePermission } = require('../middleware/authMiddleware');
const { body, param, query, validationResult } = require('express-validator');
const logger = require('../config/logger');
const config = require('../config/config');
const broadcast = require('../sockets/broadcast');

const execFileAsync = promisify(execFile);

// Configure multer for file uploads
//
// req.body.path/req.body.filename come from multipart fields the client
// fully controls (including their order — multer parses fields in stream
// order, so these are already populated by the time this file's callback
// runs regardless of where in the route pipeline requirePermission/
// isPathSafe would normally run). Both MUST be validated here directly;
// there is no later chokepoint that sees them before the file is written.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const requestedPath = req.body.path || config.UPLOAD.UPLOAD_PATH;
    const resolved = path.resolve(requestedPath);
    if (!isPathSafe(resolved)) {
      return cb(new Error('Access denied to this directory'));
    }
    cb(null, resolved);
  },
  filename: (req, file, cb) => {
    // path.basename strips any directory component (both / and \\ on
    // Windows) from either the client-supplied name or the original
    // filename, which fully neutralizes traversal here regardless of what
    // isPathSafe() would otherwise catch on the destination alone.
    const requested = req.body.filename || file.originalname;
    const safeName = path.basename(requested).trim();
    if (!safeName || safeName === '.' || safeName === '..') {
      return cb(new Error('Invalid file name'));
    }
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseFileSize(config.UPLOAD.MAX_FILE_SIZE)
  },
  fileFilter: (req, file, cb) => {
    // Check file extension if restrictions are enabled
    if (config.UPLOAD.ALLOWED_EXTENSIONS.length > 0) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!config.UPLOAD.ALLOWED_EXTENSIONS.includes(ext)) {
        return cb(new Error(`File type ${ext} not allowed`));
      }
    }
    cb(null, true);
  }
});

// Browse directory
router.get('/browse',
  requirePermission('files:read'),
  [
    query('path').optional().isString().withMessage('Path must be a string'),
    query('showHidden').optional().isBoolean().withMessage('showHidden must be boolean')
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

      const showHidden = req.query.showHidden === 'true';

      // Default to home dir; fall back to uploads if it doesn't exist
      let targetPath = req.query.path || config.SYSTEM.HOME_DIR || config.UPLOAD.UPLOAD_PATH;
      let safePath = path.resolve(targetPath);

      if (!isPathSafe(safePath)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this directory'
        });
      }

      // If path doesn't exist, fall back to uploads dir
      try {
        await fs.access(safePath);
      } catch {
        targetPath = config.UPLOAD.UPLOAD_PATH;
        safePath = path.resolve(targetPath);
        await fs.mkdir(targetPath, { recursive: true });
      }

      const entries = await fs.readdir(safePath, { withFileTypes: true });
      const visible = showHidden ? entries : entries.filter(e => !e.name.startsWith('.'));

      // Stat all entries in parallel instead of one-by-one
      const fileList = (await Promise.all(
        visible.map(async (dirent) => {
          const itemPath = path.join(safePath, dirent.name);
          try {
            const stats = await fs.stat(itemPath);
            const isDir = dirent.isDirectory();
            return {
              name: dirent.name,
              path: itemPath,
              type: isDir ? 'directory' : 'file',
              isDirectory: isDir,
              size: stats.size,
              modified: stats.mtime,
              permissions: config.SYSTEM.IS_WINDOWS ? 'N/A' : '0' + (stats.mode & 0o777).toString(8),
              owner: stats.uid,
              group: stats.gid,
            };
          } catch {
            return null; // skip inaccessible items
          }
        })
      )).filter(Boolean);

      // Sort: directories first, then files alphabetically
      fileList.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      res.json({
        success: true,
        data: {
          currentPath: safePath,
          parentPath: path.dirname(safePath),
          files: fileList,
        }
      });
    } catch (error) {
      logger.error('Error browsing directory:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to browse directory'
      });
    }
  }
);

// Read file content
router.get('/read',
  requirePermission('files:read'),
  [
    query('path').isString().withMessage('File path is required'),
    query('encoding').optional().isIn(['utf8', 'binary', 'base64']).withMessage('Invalid encoding')
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

      const filePath = path.resolve(req.query.path);
      const encoding = req.query.encoding || 'utf8';
      
      if (!isPathSafe(filePath)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this file'
        });
      }

      const stats = await fs.stat(filePath);
      
      if (stats.isDirectory()) {
        return res.status(400).json({
          success: false,
          message: 'Cannot read directory as file'
        });
      }

      // Check file size limit for text files
      if (encoding === 'utf8' && stats.size > 10 * 1024 * 1024) { // 10MB limit
        return res.status(400).json({
          success: false,
          message: 'File too large to display as text'
        });
      }

      const content = await fs.readFile(filePath, encoding);
      
      res.json({
        success: true,
        data: {
          path: filePath,
          content,
          size: stats.size,
          modified: stats.mtime,
          encoding
        }
      });
    } catch (error) {
      logger.error('Error reading file:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to read file'
      });
    }
  }
);

// Write file content
router.post('/write',
  requirePermission('files:write'),
  [
    body('path').isString().withMessage('File path is required'),
    body('content').isString().withMessage('Content is required'),
    body('encoding').optional().isIn(['utf8', 'binary', 'base64']).withMessage('Invalid encoding'),
    body('backup').optional().isBoolean().withMessage('Backup must be boolean')
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

      const { path: filePath, content, encoding = 'utf8', backup = true } = req.body;
      const safePath = path.resolve(filePath);
      
      if (!isPathSafe(safePath)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this file'
        });
      }

      // Create backup if file exists and backup is requested
      if (backup && fsSync.existsSync(safePath)) {
        const backupPath = `${safePath}.backup.${Date.now()}`;
        await fs.copyFile(safePath, backupPath);
        logger.info(`Backup created: ${backupPath}`);
      }

      // Ensure directory exists
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      
      // Write file
      await fs.writeFile(safePath, content, encoding);
      
      logger.info(`File written by ${req.user.username}: ${safePath}`);
      broadcast.broadcastFileOperation('write', { path: safePath, user: req.user.username });

      res.json({
        success: true,
        message: 'File saved successfully',
        data: {
          path: safePath,
          size: Buffer.byteLength(content, encoding)
        }
      });
    } catch (error) {
      logger.error('Error writing file:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to write file'
      });
    }
  }
);

// Upload files
router.post('/upload',
  requirePermission('files:write'),
  upload.array('files', 10), // Max 10 files
  async (req, res) => {
    try {
      const uploadedFiles = req.files.map(file => ({
        originalName: file.originalname,
        filename: file.filename,
        path: file.path,
        size: file.size,
        mimetype: file.mimetype
      }));

      logger.info(`Files uploaded by ${req.user.username}: ${uploadedFiles.map(f => f.filename).join(', ')}`);
      
      res.json({
        success: true,
        message: `${uploadedFiles.length} file(s) uploaded successfully`,
        data: uploadedFiles
      });
    } catch (error) {
      logger.error('Error uploading files:', error);
      res.status(500).json({
        success: false,
        message: 'File upload failed'
      });
    }
  }
);

// Download file
router.get('/download',
  requirePermission('files:read'),
  [
    query('path').isString().withMessage('File path is required')
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

      const filePath = path.resolve(req.query.path);
      
      if (!isPathSafe(filePath)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this file'
        });
      }

      const stats = await fs.stat(filePath);
      
      if (stats.isDirectory()) {
        return res.status(400).json({
          success: false,
          message: 'Cannot download directory directly'
        });
      }

      const filename = path.basename(filePath);
      
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', stats.size);
      
      const stream = fsSync.createReadStream(filePath);
      stream.pipe(res);
      
      logger.info(`File downloaded by ${req.user.username}: ${filePath}`);
    } catch (error) {
      logger.error('Error downloading file:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to download file'
      });
    }
  }
);

// Create directory
router.post('/mkdir',
  requirePermission('files:write'),
  [
    body('path').isString().withMessage('Directory path is required'),
    body('recursive').optional().isBoolean().withMessage('Recursive must be boolean')
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

      const { path: dirPath, recursive = false } = req.body;
      const safePath = path.resolve(dirPath);
      
      if (!isPathSafe(safePath)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this location'
        });
      }

      await fs.mkdir(safePath, { recursive });
      
      logger.info(`Directory created by ${req.user.username}: ${safePath}`);
      broadcast.broadcastFileOperation('mkdir', { path: safePath, user: req.user.username });

      res.json({
        success: true,
        message: 'Directory created successfully',
        data: { path: safePath }
      });
    } catch (error) {
      logger.error('Error creating directory:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create directory'
      });
    }
  }
);

// Delete file or directory
router.delete('/delete',
  requirePermission('files:delete'),
  [
    body('path').isString().withMessage('Path is required'),
    body('recursive').optional().isBoolean().withMessage('Recursive must be boolean')
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

      const { path: targetPath, recursive = false } = req.body;
      const safePath = path.resolve(targetPath);
      
      if (!isPathSafe(safePath)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this location'
        });
      }

      // Security: Prevent deletion of critical system paths
      if (isCriticalSystemPath(safePath)) {
        return res.status(403).json({
          success: false,
          message: 'Cannot delete critical system directory'
        });
      }

      const stats = await fs.stat(safePath);
      
      if (stats.isDirectory()) {
        await fs.rmdir(safePath, { recursive });
      } else {
        await fs.unlink(safePath);
      }
      
      logger.info(`Deleted by ${req.user.username}: ${safePath}`);
      broadcast.broadcastFileOperation('delete', { path: safePath, user: req.user.username });

      res.json({
        success: true,
        message: 'Item deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting item:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete item'
      });
    }
  }
);

// Move/rename file or directory
router.post('/move',
  requirePermission('files:write'),
  [
    body('source').isString().withMessage('Source path is required'),
    body('destination').isString().withMessage('Destination path is required')
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

      const { source, destination } = req.body;
      const sourcePath = path.resolve(source);
      const destPath = path.resolve(destination);
      
      if (!isPathSafe(sourcePath) || !isPathSafe(destPath)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to one or more paths'
        });
      }

      // Ensure destination directory exists
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      
      await fs.rename(sourcePath, destPath);
      
      logger.info(`Moved by ${req.user.username}: ${sourcePath} -> ${destPath}`);
      broadcast.broadcastFileOperation('move', { source: sourcePath, destination: destPath, user: req.user.username });

      res.json({
        success: true,
        message: 'Item moved successfully',
        data: {
          source: sourcePath,
          destination: destPath
        }
      });
    } catch (error) {
      logger.error('Error moving item:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to move item'
      });
    }
  }
);

// Copy file or directory
router.post('/copy',
  requirePermission('files:write'),
  [
    body('source').isString().withMessage('Source path is required'),
    body('destination').isString().withMessage('Destination path is required')
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

      const { source, destination } = req.body;
      const sourcePath = path.resolve(source);
      const destPath = path.resolve(destination);
      
      if (!isPathSafe(sourcePath) || !isPathSafe(destPath)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to one or more paths'
        });
      }

      // Ensure destination directory exists
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      
      const stats = await fs.stat(sourcePath);
      
      if (stats.isDirectory()) {
        await copyDirectory(sourcePath, destPath);
      } else {
        await fs.copyFile(sourcePath, destPath);
      }
      
      logger.info(`Copied by ${req.user.username}: ${sourcePath} -> ${destPath}`);
      broadcast.broadcastFileOperation('copy', { source: sourcePath, destination: destPath, user: req.user.username });

      res.json({
        success: true,
        message: 'Item copied successfully',
        data: {
          source: sourcePath,
          destination: destPath
        }
      });
    } catch (error) {
      logger.error('Error copying item:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to copy item'
      });
    }
  }
);

// Set file permissions
router.post('/permissions',
  requirePermission('files:write'),
  [
    body('path').isString().withMessage('File path is required'),
    body('mode').isString().matches(/^[0-7]{3,4}$/).withMessage('Invalid permission mode'),
    body('recursive').optional().isBoolean().withMessage('Recursive must be boolean')
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

      const { path: targetPath, mode, recursive = false } = req.body;
      const safePath = path.resolve(targetPath);
      
      if (!isPathSafe(safePath)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this location'
        });
      }

      if (config.SYSTEM.IS_WINDOWS) {
        return res.status(400).json({
          success: false,
          message: 'File permissions not supported on Windows'
        });
      }

      const chmodArgs = recursive ? ['-R', mode, safePath] : [mode, safePath];
      await execFileAsync('chmod', chmodArgs);
      
      logger.info(`Permissions changed by ${req.user.username}: ${safePath} -> ${mode}`);
      
      res.json({
        success: true,
        message: 'Permissions updated successfully'
      });
    } catch (error) {
      logger.error('Error changing permissions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to change permissions'
      });
    }
  }
);

// Create archive — a write operation, gated on files:write like every
// other write endpoint in this file (was previously files:read, which let
// a read-only/viewer-tier account write files to disk).
router.post('/archive',
  requirePermission('files:write'),
  [
    body('paths').isArray().withMessage('Paths array is required'),
    body('archiveName').isString().withMessage('Archive name is required'),
    body('format').optional().isIn(['zip', 'tar', 'tar.gz']).withMessage('Invalid archive format')
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

      const { paths, archiveName, format = 'zip' } = req.body;
      // basename strips any directory component, so archiveName can't
      // escape PATHS.BACKUPS via traversal (it previously went straight
      // into path.join with no check at all, unlike every other write
      // endpoint in this file).
      const safeArchiveName = path.basename(archiveName);
      if (!safeArchiveName || safeArchiveName === '.' || safeArchiveName === '..') {
        return res.status(400).json({ success: false, message: 'Invalid archive name' });
      }
      const archivePath = path.join(config.PATHS.BACKUPS, safeArchiveName);

      // Ensure all paths are safe
      const safePaths = paths.map(p => path.resolve(p));
      for (const safePath of safePaths) {
        if (!isPathSafe(safePath)) {
          return res.status(403).json({
            success: false,
            message: 'Access denied to one or more paths'
          });
        }
      }

      await fs.mkdir(config.PATHS.BACKUPS, { recursive: true });

      if (format === 'zip') {
        const output = fsSync.createWriteStream(archivePath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        archive.pipe(output);
        
        for (const itemPath of safePaths) {
          const stats = await fs.stat(itemPath);
          const name = path.basename(itemPath);
          
          if (stats.isDirectory()) {
            archive.directory(itemPath, name);
          } else {
            archive.file(itemPath, { name });
          }
        }
        
        await archive.finalize();

        // `return`ing this promise (instead of `await`ing it) would hand it
        // to Express without the surrounding try/catch ever seeing a later
        // rejection — and output/archive both need an 'error' listener
        // regardless, since .pipe() doesn't forward errors between streams;
        // an unlistened error here (disk full, permission denied) would
        // otherwise crash the whole process as an unhandled rejection.
        await new Promise((resolve, reject) => {
          output.on('close', resolve);
          output.on('error', reject);
          archive.on('error', reject);
        });

        return res.json({
          success: true,
          message: 'Archive created successfully',
          data: {
            archivePath,
            size: archive.pointer()
          }
        });
      } else {
        // Use tar command for tar formats
        const tarArgs = format === 'tar.gz'
          ? ['-czf', archivePath, ...safePaths]
          : ['-cf', archivePath, ...safePaths];

        await execFileAsync('tar', tarArgs);
        
        const stats = await fs.stat(archivePath);
        
        res.json({
          success: true,
          message: 'Archive created successfully',
          data: {
            archivePath,
            size: stats.size
          }
        });
      }
      
      logger.info(`Archive created by ${req.user.username}: ${archivePath}`);
    } catch (error) {
      logger.error('Error creating archive:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create archive'
      });
    }
  }
);

// Extract archive
router.post('/extract',
  requirePermission('files:write'),
  [
    body('archivePath').isString().withMessage('Archive path is required'),
    body('destinationPath').isString().withMessage('Destination path is required')
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

      const { archivePath, destinationPath } = req.body;
      const safeArchivePath = path.resolve(archivePath);
      const safeDestPath = path.resolve(destinationPath);
      
      if (!isPathSafe(safeArchivePath) || !isPathSafe(safeDestPath)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to one or more paths'
        });
      }

      try {
        await fs.access(safeArchivePath);
      } catch {
        return res.status(404).json({ success: false, message: 'Archive file not found' });
      }

      await fs.mkdir(safeDestPath, { recursive: true });

      const ext = path.extname(safeArchivePath).toLowerCase();

      if (ext === '.zip') {
        // .pipe() does NOT forward 'error' events from source to
        // destination — an unlistened error on the read stream (a
        // corrupted file appearing mid-read, a permission error, etc.)
        // becomes an uncaught exception that crashes the whole process,
        // not just this request. Listen on both streams explicitly.
        await new Promise((resolve, reject) => {
          const readStream = fsSync.createReadStream(safeArchivePath);
          readStream.on('error', reject);
          readStream
            .pipe(unzipper.Extract({ path: safeDestPath }))
            .on('error', reject)
            .on('close', resolve);
        });
      } else if (ext === '.tar' || archivePath.endsWith('.tar.gz')) {
        const tarArgs = archivePath.endsWith('.tar.gz')
          ? ['-xzf', safeArchivePath, '-C', safeDestPath]
          : ['-xf', safeArchivePath, '-C', safeDestPath];

        await execFileAsync('tar', tarArgs);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Unsupported archive format'
        });
      }
      
      logger.info(`Archive extracted by ${req.user.username}: ${safeArchivePath} -> ${safeDestPath}`);
      
      res.json({
        success: true,
        message: 'Archive extracted successfully'
      });
    } catch (error) {
      logger.error('Error extracting archive:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to extract archive'
      });
    }
  }
);

// Search files
router.get('/search',
  requirePermission('files:read'),
  [
    query('path').optional().isString().withMessage('Path must be a string'),
    query('query').isString().withMessage('Search query is required'),
    query('type').optional().isIn(['file', 'directory', 'both']).withMessage('Invalid search type'),
    query('maxResults').optional().isInt({ min: 1, max: 1000 }).withMessage('Max results must be 1-1000')
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

      const {
        path: searchPath = config.SYSTEM.WEB_ROOT,
        query: searchQuery,
        type = 'both',
        maxResults = 100
      } = req.query;
      
      const safePath = path.resolve(searchPath);
      
      if (!isPathSafe(safePath)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to search path'
        });
      }

      const results = [];
      // Bounding by match count alone (the old `results.length >= maxResults`
      // check) never helps when nothing matches — a search from a broad
      // path (home dir, drive root) with large trees like node_modules/.git
      // underneath it would serially fs.stat every file at every depth
      // level, for minutes, before giving up. Cap total items examined and
      // wall-clock time as well, independent of how many results were found.
      const MAX_SCANNED = 20000;
      const MAX_DURATION_MS = 15000;
      const startedAt = Date.now();
      let scanned = 0;
      let truncated = false;

      async function searchRecursive(dir, depth = 0) {
        if (depth > 10 || results.length >= maxResults) return;
        if (scanned >= MAX_SCANNED || Date.now() - startedAt > MAX_DURATION_MS) {
          truncated = true;
          return;
        }

        try {
          const items = await fs.readdir(dir);

          for (const item of items) {
            if (results.length >= maxResults) break;
            if (scanned >= MAX_SCANNED || Date.now() - startedAt > MAX_DURATION_MS) {
              truncated = true;
              break;
            }
            scanned++;

            const itemPath = path.join(dir, item);
            let stats;
            try {
              stats = await fs.stat(itemPath);
            } catch {
              continue; // broken symlink, permission error, etc. — skip it
            }
            const isDir = stats.isDirectory();

            // Check if item matches search criteria
            if (item.toLowerCase().includes(searchQuery.toLowerCase())) {
              if ((type === 'both') ||
                  (type === 'file' && !isDir) ||
                  (type === 'directory' && isDir)) {
                results.push({
                  name: item,
                  path: itemPath,
                  type: isDir ? 'directory' : 'file',
                  size: stats.size,
                  modified: stats.mtime
                });
              }
            }

            // Recurse into subdirectories
            if (isDir) {
              await searchRecursive(itemPath, depth + 1);
            }
          }
        } catch (error) {
          // Skip directories we can't read
        }
      }

      await searchRecursive(safePath);

      res.json({
        success: true,
        data: {
          query: searchQuery,
          searchPath: safePath,
          results,
          totalFound: results.length,
          truncated // true if the scan hit the item/time cap before exhausting the tree
        }
      });
    } catch (error) {
      logger.error('Error searching files:', error);
      res.status(500).json({
        success: false,
        message: 'Search failed'
      });
    }
  }
);

// Helper functions

// The app's own install directory (src/routes -> src -> repo root) — never
// let the file manager expose the panel's own secrets/DB/logs/VCS history,
// regardless of what HOME_DIR/WEB_ROOT the operator configured.
//
// config.PATHS.BACKUPS/CERTIFICATES/CONFIGS are included here deliberately:
// backupService.js's "full"/"database" backups dump the entire operational
// DB (every user's password hash, 2FA secret, SSL private key, API keys)
// into a .tar.gz under PATHS.BACKUPS, and acmeService.js's real account
// private key lives under PATHS.CERTIFICATES — before this fix, any
// files:read holder (granted to both the "user" and "viewer" roles by
// default) could browse straight to and download those archives/keys
// through the ordinary file manager, since nothing blocked those
// directories. Verified live: a real backup archive and the real ACME
// account key were both reachable this way prior to this fix.
const APP_ROOT = path.resolve(__dirname, '..', '..');
const SENSITIVE_APP_PATHS = [
  path.join(APP_ROOT, '.env'),
  path.join(APP_ROOT, 'data'),
  path.join(APP_ROOT, 'logs'),
  path.join(APP_ROOT, '.git'),
  config.PATHS.BACKUPS,
  config.PATHS.CERTIFICATES,
  config.PATHS.CONFIGS
];

// Broad OS-level directories that should never be reachable through the
// file manager, even though it's otherwise intentionally allowed to browse
// the rest of the host (this is a cPanel-style "manage my whole server"
// tool, not a sandboxed per-app file manager).
//
// Deliberately NOT blocking /root here: this app commonly runs as root
// (service control on Linux needs it), in which case /root is
// os.homedir() — the default browse path — so blocking it outright 403s
// the file manager's default view for every root-run deployment. The
// actual sensitive thing under there (SSH keys) is still covered by the
// .ssh check below, for /root and every other user's home directory alike.
const FORBIDDEN_ROOTS = process.platform === 'win32'
  ? [
      'C:\\Windows\\System32\\config',
      'C:\\Windows\\System32\\drivers\\etc',
      'C:\\ProgramData\\Microsoft\\Crypto'
    ]
  : [
      '/etc', '/boot', '/sys', '/proc',
      '/var/lib/mysql', '/var/lib/postgresql'
    ];

function isPathSafe(targetPath) {
  const resolved = path.resolve(targetPath);
  // Windows filesystems are case-insensitive/case-preserving — path.resolve()
  // does NOT normalize case, so comparing resolved paths byte-for-byte
  // against the denylist let a differently-cased path (e.g.
  // "C:\Windows\System32\Config" or "e:\projects\serverpanel\Data") sail
  // straight past every check below on this deployment's actual OS. Compare
  // case-insensitively on Windows, case-sensitively everywhere else.
  const compareBase = config.SYSTEM.IS_WINDOWS ? resolved.toLowerCase() : resolved;
  const isWithin = (base) => {
    const compareTarget = config.SYSTEM.IS_WINDOWS ? base.toLowerCase() : base;
    return compareBase === compareTarget || compareBase.startsWith(compareTarget + path.sep);
  };

  if (SENSITIVE_APP_PATHS.some(isWithin)) return false;
  if (FORBIDDEN_ROOTS.some(isWithin)) return false;
  if (/[\\/]\.ssh([\\/]|$)/i.test(resolved)) return false;

  return true;
}

// Unix critical roots resolve and compare exactly as written ('/', '/etc',
// ...). Windows has no single-character root — the equivalent is a bare
// drive letter ('C:\\') or a handful of well-known system directories —
// so the Unix literal-string list alone never matched a Windows-resolved
// path, silently disabling this check on Windows deployments.
const WINDOWS_CRITICAL_ROOTS = [
  'C:\\Windows', 'C:\\Windows\\System32',
  'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'
];
const WINDOWS_DRIVE_ROOT_RE = /^[A-Za-z]:\\?$/;

function isCriticalSystemPath(resolvedPath) {
  if (config.SYSTEM.IS_WINDOWS) {
    if (WINDOWS_DRIVE_ROOT_RE.test(resolvedPath)) return true;
    const lower = resolvedPath.toLowerCase();
    return WINDOWS_CRITICAL_ROOTS.some(p => lower === p.toLowerCase());
  }
  const UNIX_CRITICAL_PATHS = ['/', '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/root', '/sbin', '/sys', '/usr'];
  return UNIX_CRITICAL_PATHS.includes(resolvedPath);
}

async function getFilePermissions(filePath) {
  if (config.SYSTEM.IS_WINDOWS) {
    return 'N/A'; // Windows doesn't use Unix permissions
  }
  
  try {
    const stats = await fs.stat(filePath);
    return '0' + (stats.mode & parseInt('777', 8)).toString(8);
  } catch {
    return 'unknown';
  }
}

async function copyDirectory(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function parseFileSize(sizeStr) {
  const units = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3 };
  const match = sizeStr.match(/^(\d+)([A-Z]{1,2})$/);
  if (!match) return 50 * 1024 * 1024; // Default 50MB
  return parseInt(match[1]) * (units[match[2]] || 1);
}

// Exposed as properties on the router (a function, so this is safe) so
// other route files needing "is this path safe to write/delete" don't
// reinvent the same denylist a fourth time — applications.js's install/
// uninstall path handling reuses these instead of its own copy.
router.isPathSafe = isPathSafe;
router.isCriticalSystemPath = isCriticalSystemPath;

module.exports = router;