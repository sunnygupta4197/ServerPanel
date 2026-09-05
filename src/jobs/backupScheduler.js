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

function start() {
  cron.schedule('* * * * *', async () => {
    try {
      const due = await database('backup_schedules')
        .where('is_active', true)
        .where('next_run', '<=', new Date());

      for (const schedule of due) {
        await runScheduledBackup(schedule);
      }
    } catch (error) {
      logger.error('Backup scheduler tick failed:', error);
    }
  });

  logger.info('Backup scheduler started (checking every minute for due schedules)');
}

module.exports = { start, runScheduledBackup };
