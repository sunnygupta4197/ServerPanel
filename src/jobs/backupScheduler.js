const cron = require('node-cron');
const fs = require('fs').promises;
const database = require('../config/database');
const logger = require('../config/logger');
const jobQueue = require('./jobQueue');
const backupService = require('../services/backupService');

async function pruneOldBackups(schedule) {
  const cutoff = new Date(Date.now() - schedule.retention_days * 24 * 60 * 60 * 1000);
  const old = await database('backups')
    .where({ user_id: schedule.user_id, type: schedule.type, status: 'completed' })
    .where('created_at', '<', cutoff);

  for (const backup of old) {
    if (backup.path) await fs.unlink(backup.path).catch(() => {});
    await database('backups').where('id', backup.id).del();
  }
}

// Tracks schedule ids with a backup currently in progress — next_run
// only advances after runScheduledBackup() finishes (see the update at
// the bottom of that function), so a real backup that takes longer than
// a minute would otherwise still match `next_run <= now` on every tick
// while it's running, and the once-a-minute cron tick would launch
// another concurrent run of the exact same schedule. Wasteful (doubled
// I/O/CPU, duplicate 'running' rows in the backups table confusing the
// UI) rather than corrupting anything — each run's staging directory is
// independently randomly named — but a real, easy-to-hit bug on any
// backup big enough to take over a minute, which is most real ones.
const runningScheduleIds = new Set();

async function runScheduledBackup(schedule) {
  const backupName = `${schedule.type}-scheduled-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  const [backupId] = await database('backups').insert({
    user_id: schedule.user_id,
    name: backupName,
    type: schedule.type,
    status: 'running',
    started_at: new Date(),
    created_at: new Date(),
    updated_at: new Date()
  });

  const job = jobQueue.createJob('backup_create', `Scheduled ${schedule.type} backup`, schedule.user_id);
  jobQueue.updateJob(job.id, { status: 'running', progress: 0 });

  try {
    const result = await backupService.createBackup({
      type: schedule.type,
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
    jobQueue.updateJob(job.id, { status: 'completed', progress: 100 });
    logger.info(`Scheduled backup ${backupName} completed (${result.size} bytes)`);

    await pruneOldBackups(schedule);
  } catch (error) {
    await database('backups').where('id', backupId).update({
      status: 'failed',
      error_message: error.message,
      updated_at: new Date()
    });
    jobQueue.updateJob(job.id, { status: 'failed', error: error.message });
    logger.error(`Scheduled backup failed for schedule ${schedule.id}:`, error);
  }

  await database('backup_schedules').where('id', schedule.id).update({
    last_run: new Date(),
    next_run: backupService.computeNextRun(schedule.frequency),
    updated_at: new Date()
  });
}

// Guards against registering a second, un-trackable, un-stoppable
// cron.schedule() task if start() is ever called twice in the same
// process (e.g. tests that construct more than one ServerPanelApp
// instance) — cron.schedule() itself has no built-in "already running"
// check, so without this a repeat call just silently piles up another
// tick handler ticking forever alongside the first.
let started = false;

function start() {
  if (started) return;
  started = true;

  cron.schedule('* * * * *', async () => {
    try {
      const due = await database('backup_schedules')
        .where('is_active', true)
        .where('next_run', '<=', new Date());

      for (const schedule of due) {
        if (runningScheduleIds.has(schedule.id)) continue; // still running from a previous tick — next_run hasn't advanced yet
        runningScheduleIds.add(schedule.id);
        try {
          await runScheduledBackup(schedule);
        } finally {
          runningScheduleIds.delete(schedule.id);
        }
      }
    } catch (error) {
      logger.error('Backup scheduler tick failed:', error);
    }
  });

  logger.info('Backup scheduler started (checking every minute for due schedules)');
}

module.exports = { start, runScheduledBackup };
