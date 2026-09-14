const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const { body, param, validationResult } = require('express-validator');
const { requireRole, requirePermission } = require('../middleware/authMiddleware');
const database = require('../config/database');
const logger = require('../config/logger');
const cronJobRunner = require('../jobs/cronJobRunner');
const safeCommandService = require('../services/safeCommandService');

// Admin-only throughout — same reasoning as terminal.js: a cron job is
// just a shell command that runs later, so it carries the same risk
// profile and the same requireRole('admin') (not a permission string)
// defense against it ever being handed to a non-admin account.

router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const jobs = await database('cron_jobs').orderBy('created_at', 'desc');
    res.json({ success: true, data: jobs });
  } catch (error) {
    logger.error('Error listing cron jobs:', error);
    res.status(500).json({ success: false, message: 'Failed to list cron jobs' });
  }
});

router.post('/',
  requireRole('admin'),
  [
    body('name').isString().isLength({ min: 1, max: 200 }).withMessage('Name is required'),
    body('schedule').isString().custom(value => {
      if (!cron.validate(value)) throw new Error('Invalid cron expression');
      return true;
    }),
    body('command').isString().isLength({ min: 1, max: 4000 }).withMessage('Command is required'),
    body('is_active').optional().isBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { name, schedule, command, is_active = true } = req.body;

      const [id] = await database('cron_jobs').insert({
        created_by: req.user.id,
        name,
        schedule,
        command,
        is_active,
        created_at: new Date(),
        updated_at: new Date()
      });

      const job = await database('cron_jobs').where('id', id).first();
      cronJobRunner.register(job);

      logger.audit('cron_job_created', req.user, 'cron', { jobId: id, name, schedule });
      res.status(201).json({ success: true, message: 'Cron job created', data: job });
    } catch (error) {
      logger.error('Error creating cron job:', error);
      res.status(500).json({ success: false, message: 'Failed to create cron job' });
    }
  }
);

router.put('/:id',
  requireRole('admin'),
  [
    param('id').isInt(),
    body('name').optional().isString().isLength({ min: 1, max: 200 }),
    body('schedule').optional().isString().custom(value => {
      if (value !== undefined && !cron.validate(value)) throw new Error('Invalid cron expression');
      return true;
    }),
    body('command').optional().isString().isLength({ min: 1, max: 4000 }),
    body('is_active').optional().isBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const job = await database('cron_jobs').where('id', req.params.id).first();
      if (!job) return res.status(404).json({ success: false, message: 'Cron job not found' });

      const updates = { updated_at: new Date() };
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.schedule !== undefined) updates.schedule = req.body.schedule;
      if (req.body.command !== undefined) updates.command = req.body.command;
      if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;

      await database('cron_jobs').where('id', req.params.id).update(updates);
      const updated = await database('cron_jobs').where('id', req.params.id).first();
      cronJobRunner.register(updated); // re-registers with the new schedule/active state

      logger.audit('cron_job_updated', req.user, 'cron', { jobId: updated.id, changes: updates });
      res.json({ success: true, message: 'Cron job updated', data: updated });
    } catch (error) {
      logger.error('Error updating cron job:', error);
      res.status(500).json({ success: false, message: 'Failed to update cron job' });
    }
  }
);

router.delete('/:id', requireRole('admin'), [param('id').isInt()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const job = await database('cron_jobs').where('id', req.params.id).first();
    if (!job) return res.status(404).json({ success: false, message: 'Cron job not found' });

    cronJobRunner.unregister(job.id);
    await database('cron_jobs').where('id', req.params.id).del();

    logger.audit('cron_job_deleted', req.user, 'cron', { jobId: job.id, name: job.name });
    res.json({ success: true, message: 'Cron job deleted' });
  } catch (error) {
    logger.error('Error deleting cron job:', error);
    res.status(500).json({ success: false, message: 'Failed to delete cron job' });
  }
});

router.post('/:id/run', requireRole('admin'), [param('id').isInt()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const job = await database('cron_jobs').where('id', req.params.id).first();
    if (!job) return res.status(404).json({ success: false, message: 'Cron job not found' });

    // Run in the background — the client polls GET /:id (via the list
    // endpoint) to see last_run_at/last_exit_code/last_output update,
    // matching the jobQueue pattern used for backups/app installs
    // elsewhere, but this job type is simple enough not to need a full
    // jobQueue entry of its own.
    res.status(202).json({ success: true, message: 'Job run started' });
    cronJobRunner.runJob(job.id).catch(err => logger.error(`Manual run of cron job ${job.id} failed:`, err));
  } catch (error) {
    logger.error('Error running cron job:', error);
    res.status(500).json({ success: false, message: 'Failed to run cron job' });
  }
});

// Restricted, non-admin path (cron:safe permission — see
// src/config/permissions.js): a "user" account can schedule one of the
// same fixed, enum-keyed actions terminal.js's /safe-command exposes,
// never a free-text command. Rows created here always get
// command_type='safe_action' and command=<action key> — never 'shell' —
// so cronJobRunner.js can never reinterpret one as shell text, and every
// row is scoped to req.user.id so a "user" can only see/touch their own
// jobs (unlike the admin routes above, which operate on any job).

router.get('/user-jobs', requirePermission('cron:safe'), async (req, res) => {
  try {
    const jobs = await database('cron_jobs')
      .where('created_by', req.user.id)
      .where('command_type', 'safe_action')
      .orderBy('created_at', 'desc');
    res.json({ success: true, data: jobs });
  } catch (error) {
    logger.error('Error listing user cron jobs:', error);
    res.status(500).json({ success: false, message: 'Failed to list cron jobs' });
  }
});

router.get('/safe-actions', requirePermission('cron:safe'), (req, res) => {
  res.json({ success: true, data: safeCommandService.listActions() });
});

router.post('/user-jobs',
  requirePermission('cron:safe'),
  [
    body('name').isString().isLength({ min: 1, max: 200 }).withMessage('Name is required'),
    body('schedule').isString().custom(value => {
      if (!cron.validate(value)) throw new Error('Invalid cron expression');
      return true;
    }),
    body('action').isString().isLength({ min: 1, max: 100 }).withMessage('Action is required'),
    body('domainId').optional().isInt(),
    body('is_active').optional().isBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { name, schedule, action, is_active = true } = req.body;
      const actionKeys = safeCommandService.listActions().map(a => a.key);
      if (!actionKeys.includes(action)) {
        return res.status(400).json({ success: false, message: `Unknown action: ${action}` });
      }

      let domainId = null;
      if (safeCommandService.requiresDomain(action)) {
        if (!req.body.domainId) {
          return res.status(400).json({ success: false, message: `Action "${action}" requires a domainId` });
        }
        const domain = await database('domains').where('id', req.body.domainId).first();
        if (!domain || domain.user_id !== req.user.id) {
          return res.status(404).json({ success: false, message: 'Domain not found' });
        }
        domainId = domain.id;
      }

      const [id] = await database('cron_jobs').insert({
        created_by: req.user.id,
        name,
        schedule,
        command: action,
        command_type: 'safe_action',
        domain_id: domainId,
        is_active,
        created_at: new Date(),
        updated_at: new Date()
      });

      const job = await database('cron_jobs').where('id', id).first();
      cronJobRunner.register(job);

      logger.audit('cron_job_created', req.user, 'cron', { jobId: id, name, schedule, commandType: 'safe_action', action });
      res.status(201).json({ success: true, message: 'Cron job created', data: job });
    } catch (error) {
      logger.error('Error creating user cron job:', error);
      res.status(500).json({ success: false, message: 'Failed to create cron job' });
    }
  }
);

router.delete('/user-jobs/:id', requirePermission('cron:safe'), [param('id').isInt()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const job = await database('cron_jobs')
      .where('id', req.params.id)
      .where('created_by', req.user.id)
      .where('command_type', 'safe_action')
      .first();
    if (!job) return res.status(404).json({ success: false, message: 'Cron job not found' });

    cronJobRunner.unregister(job.id);
    await database('cron_jobs').where('id', req.params.id).del();

    logger.audit('cron_job_deleted', req.user, 'cron', { jobId: job.id, name: job.name });
    res.json({ success: true, message: 'Cron job deleted' });
  } catch (error) {
    logger.error('Error deleting user cron job:', error);
    res.status(500).json({ success: false, message: 'Failed to delete cron job' });
  }
});

router.post('/user-jobs/:id/run', requirePermission('cron:safe'), [param('id').isInt()], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const job = await database('cron_jobs')
      .where('id', req.params.id)
      .where('created_by', req.user.id)
      .where('command_type', 'safe_action')
      .first();
    if (!job) return res.status(404).json({ success: false, message: 'Cron job not found' });

    res.status(202).json({ success: true, message: 'Job run started' });
    cronJobRunner.runJob(job.id).catch(err => logger.error(`Manual run of cron job ${job.id} failed:`, err));
  } catch (error) {
    logger.error('Error running user cron job:', error);
    res.status(500).json({ success: false, message: 'Failed to run cron job' });
  }
});

module.exports = router;
