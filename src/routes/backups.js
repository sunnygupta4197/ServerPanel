const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const { body, param, validationResult } = require('express-validator');
const { requirePermission } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');
const jobQueue = require('../jobs/jobQueue');
const backupService = require('../services/backupService');

// List backups
router.get('/', requirePermission('backups:read'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = database('backups').orderBy('created_at', 'desc').limit(100);
    if (!isAdmin) query.where('user_id', req.user.id);

    const backups = await query;
    res.json({ success: true, data: backups });
  } catch (err) {
    logger.error('Error listing backups:', err);
    res.status(500).json({ success: false, message: 'Failed to list backups' });
  }
});

// Create backup (dispatched as background job; runs a real DB dump / web
// root copy / email export via backupService, not a simulation)
router.post('/', requirePermission('backups:write'),
  [
    body('type').isIn(['full', 'files', 'database', 'emails']).withMessage('Invalid backup type'),
    body('name').optional().isString().isLength({ max: 255 }).matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Name may only contain letters, numbers, dashes, and underscores'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { type, name } = req.body;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = name || `${type}-backup-${ts}`;

      const job = jobQueue.createJob('backup_create', `Create ${type} backup`, req.user.id);

      const [backupId] = await database('backups').insert({
        user_id: req.user.id,
        name: backupName,
        type,
        status: 'queued',
        size_bytes: 0,
        job_id: job.id,
        created_at: new Date(),
        updated_at: new Date()
      });

      res.status(202).json({
        success: true,
        message: 'Backup started',
        backupId,
        jobId: job.id
      });

      setImmediate(async () => {
        try {
          await database('backups').where('id', backupId).update({
            status: 'running',
            started_at: new Date(),
            updated_at: new Date()
          });
          jobQueue.updateJob(job.id, { status: 'running', progress: 0 });

          const result = await backupService.createBackup({
            type,
            name: backupName,
            onProgress: (progress) => jobQueue.updateJob(job.id, { progress })
          });

          await database('backups').where('id', backupId).update({
            status: 'completed',
            path: result.path,
            size_bytes: result.size,
            completed_at: new Date(),
            updated_at: new Date()
          });

          jobQueue.updateJob(job.id, { status: 'completed', progress: 100, result: { backupId, size: result.size } });
          logger.info(`Backup ${backupName} completed (${result.size} bytes) by ${req.user.username}`);
        } catch (err) {
          await database('backups').where('id', backupId).update({
            status: 'failed',
            error_message: err.message,
            updated_at: new Date()
          });
          jobQueue.updateJob(job.id, { status: 'failed', error: err.message });
          logger.error('Backup failed:', err);
        }
      });
    } catch (err) {
      logger.error('Error creating backup:', err);
      res.status(500).json({ success: false, message: 'Failed to start backup' });
    }
  }
);

// Restore backup (real: decompresses/extracts the archive and restores
// whichever of database/emails/files it contains)
router.post('/:id/restore', requirePermission('backups:write'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const backup = await database('backups').where('id', req.params.id).first();
      if (!backup) return res.status(404).json({ success: false, message: 'Backup not found' });
      if (req.user.role !== 'admin' && backup.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });
      if (backup.status !== 'completed') return res.status(400).json({ success: false, message: 'Can only restore completed backups' });
      if (!backup.path) return res.status(400).json({ success: false, message: 'Backup has no archive on disk' });

      try {
        await fs.access(backup.path);
      } catch {
        return res.status(404).json({ success: false, message: 'Backup archive file is missing from disk' });
      }

      const job = jobQueue.createJob('backup_restore', `Restore ${backup.name}`, req.user.id);

      res.status(202).json({ success: true, message: 'Restore started', jobId: job.id });

      setImmediate(async () => {
        jobQueue.updateJob(job.id, { status: 'running', progress: 0 });
        try {
          await backupService.restoreBackup({
            archivePath: backup.path,
            onProgress: (progress) => jobQueue.updateJob(job.id, { progress })
          });
          jobQueue.updateJob(job.id, { status: 'completed', progress: 100 });
          logger.info(`Backup ${backup.name} restored by ${req.user.username}`);
        } catch (err) {
          jobQueue.updateJob(job.id, { status: 'failed', error: err.message });
          logger.error(`Restore failed for backup ${backup.name}:`, err);
        }
      });
    } catch (err) {
      logger.error('Error restoring backup:', err);
      res.status(500).json({ success: false, message: 'Failed to start restore' });
    }
  }
);

// Delete backup
router.delete('/:id', requirePermission('backups:write'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const backup = await database('backups').where('id', req.params.id).first();
      if (!backup) return res.status(404).json({ success: false, message: 'Backup not found' });
      if (req.user.role !== 'admin' && backup.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      if (backup.path) {
        await fs.unlink(backup.path).catch((err) =>
          logger.warn(`Could not remove backup archive ${backup.path}:`, err.message));
      }

      await database('backups').where('id', req.params.id).delete();
      logger.info(`Backup ${backup.name} deleted by ${req.user.username}`);
      res.json({ success: true, message: 'Backup deleted' });
    } catch (err) {
      logger.error('Error deleting backup:', err);
      res.status(500).json({ success: false, message: 'Failed to delete backup' });
    }
  }
);

// --- Schedules ---
// Actually executed by src/jobs/backupScheduler.js, which polls for due,
// active schedules once a minute and runs a real backup for each.

router.get('/schedules', requirePermission('backups:read'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query = database('backup_schedules').orderBy('created_at', 'desc');
    if (!isAdmin) query.where('user_id', req.user.id);
    const schedules = await query;
    res.json({ success: true, data: schedules });
  } catch (err) {
    logger.error('Error listing backup schedules:', err);
    res.status(500).json({ success: false, message: 'Failed to list schedules' });
  }
});

router.post('/schedules', requirePermission('backups:write'),
  [
    body('type').isIn(['full', 'files', 'database', 'emails']),
    body('frequency').isIn(['daily', 'weekly', 'monthly']),
    body('retention_days').optional().isInt({ min: 1, max: 365 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { type, frequency, retention_days = 7, destination = 'local' } = req.body;
      const next_run = backupService.computeNextRun(frequency);

      const [id] = await database('backup_schedules').insert({
        user_id: req.user.id,
        type,
        frequency,
        retention_days,
        destination,
        is_active: true,
        next_run,
        created_at: new Date(),
        updated_at: new Date()
      });

      const schedule = await database('backup_schedules').where('id', id).first();
      res.status(201).json({ success: true, message: 'Schedule created', data: schedule });
    } catch (err) {
      logger.error('Error creating backup schedule:', err);
      res.status(500).json({ success: false, message: 'Failed to create schedule' });
    }
  }
);

router.put('/schedules/:id', requirePermission('backups:write'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const schedule = await database('backup_schedules').where('id', req.params.id).first();
      if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });
      if (req.user.role !== 'admin' && schedule.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      const updates = { updated_at: new Date() };
      if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;
      if (req.body.retention_days !== undefined) updates.retention_days = req.body.retention_days;
      if (req.body.frequency !== undefined) {
        updates.frequency = req.body.frequency;
        updates.next_run = backupService.computeNextRun(req.body.frequency);
      }

      await database('backup_schedules').where('id', req.params.id).update(updates);
      res.json({ success: true, message: 'Schedule updated' });
    } catch (err) {
      logger.error('Error updating backup schedule:', err);
      res.status(500).json({ success: false, message: 'Failed to update schedule' });
    }
  }
);

router.delete('/schedules/:id', requirePermission('backups:write'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const schedule = await database('backup_schedules').where('id', req.params.id).first();
      if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });
      if (req.user.role !== 'admin' && schedule.user_id !== req.user.id)
        return res.status(403).json({ success: false, message: 'Access denied' });

      await database('backup_schedules').where('id', req.params.id).delete();
      res.json({ success: true, message: 'Schedule deleted' });
    } catch (err) {
      logger.error('Error deleting backup schedule:', err);
      res.status(500).json({ success: false, message: 'Failed to delete schedule' });
    }
  }
);

module.exports = router;
