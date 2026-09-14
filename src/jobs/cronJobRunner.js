// Runs admin-created cron_jobs (see migrations/scheduled_cron_jobs.js and
// src/routes/cron.js) on their configured schedule. Uses node-cron's native
// per-job scheduling (cron.schedule(expression, fn)) rather than a polling
// tick against a next_run column like backupScheduler.js — cron_jobs store
// real cron expressions, so there's no "next run" to precompute; node-cron
// already knows how to fire on an arbitrary expression.
//
// A registered task is kept in-memory (Map<jobId, ScheduledTask>) so an
// edit/delete/deactivate can stop the old task and (for an edit) start a
// new one with the updated schedule, without restarting the process.
const cron = require('node-cron');
const { spawn } = require('child_process');
const database = require('../config/database');
const logger = require('../config/logger');
const config = require('../config/config');

const MAX_OUTPUT_CHARS = 50 * 1024; // stored in the DB, so a tighter cap than terminal.js's live-response one
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000; // scheduled jobs get more time than an interactive terminal command

const registeredTasks = new Map();

function runShellCommand(command) {
  return new Promise((resolve) => {
    const isWindows = config.SYSTEM.IS_WINDOWS;
    const shellBin = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];

    const child = spawn(shellBin, shellArgs);
    let output = '';
    let truncated = false;

    const append = (chunk) => {
      if (output.length >= MAX_OUTPUT_CHARS) { truncated = true; return; }
      output += chunk;
    };

    const timer = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (d) => append(d.toString()));
    child.stderr.on('data', (d) => append(d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ output: output + `\n${err.message}`, exitCode: -1, truncated });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ output, exitCode: code, truncated });
    });
  });
}

async function runJob(jobId) {
  const job = await database('cron_jobs').where('id', jobId).first();
  if (!job || !job.is_active) return;

  logger.info(`Running cron job ${job.id} (${job.name})`);
  const result = await runShellCommand(job.command);

  await database('cron_jobs').where('id', job.id).update({
    last_run_at: new Date(),
    last_exit_code: result.exitCode,
    last_output: result.output.slice(0, MAX_OUTPUT_CHARS) + (result.truncated ? '\n[output truncated]' : ''),
    updated_at: new Date()
  });

  logger.audit('cron_job_run', { id: job.created_by }, 'cron', {
    jobId: job.id, name: job.name, exitCode: result.exitCode
  });

  if (result.exitCode !== 0) {
    logger.warn(`Cron job ${job.id} (${job.name}) exited with code ${result.exitCode}`);
  }
}

function register(job) {
  unregister(job.id);
  if (!job.is_active) return;
  if (!cron.validate(job.schedule)) {
    logger.error(`Cron job ${job.id} has an invalid schedule "${job.schedule}" — not registered`);
    return;
  }
  const task = cron.schedule(job.schedule, () => runJob(job.id).catch(err =>
    logger.error(`Cron job ${job.id} failed:`, err)));
  registeredTasks.set(job.id, task);
}

function unregister(jobId) {
  const task = registeredTasks.get(jobId);
  if (task) {
    task.stop();
    registeredTasks.delete(jobId);
  }
}

async function start() {
  const jobs = await database('cron_jobs').where('is_active', true);
  for (const job of jobs) {
    register(job);
  }
  logger.info(`Cron job runner started (${registeredTasks.size} active job(s) registered)`);
}

module.exports = { start, register, unregister, runJob };
