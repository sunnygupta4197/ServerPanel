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
const safeCommandService = require('../services/safeCommandService');

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

// A "safe_action" job's `command` column stores an action KEY (e.g.
// "disk_usage"), never free text — reused from cron_jobs.command so a
// second column wasn't needed, but the two are never interchangeable at
// runtime: command_type is what decides whether this text is treated as
// a shell command or looked up in safeCommandService's fixed action
// table, and command_type is only ever set to 'shell' by the admin-only
// route in cron.js (see migrations/scheduled_cron_jobs_safe_actions.js).
async function runSafeAction(job) {
  let documentRoot;
  if (safeCommandService.requiresDomain(job.command)) {
    if (!job.domain_id) return { output: `Action "${job.command}" requires a domain, but this job has none configured`, exitCode: -1 };
    const domain = await database('domains').where('id', job.domain_id).first();
    if (!domain) return { output: 'The domain this job was scoped to no longer exists', exitCode: -1 };
    documentRoot = domain.document_root;
  }

  try {
    const output = await safeCommandService.runAction(job.command, documentRoot);
    return { output: String(output).slice(0, MAX_OUTPUT_CHARS), exitCode: 0 };
  } catch (error) {
    return { output: error.message, exitCode: -1 };
  }
}

async function runJob(jobId) {
  const job = await database('cron_jobs').where('id', jobId).first();
  if (!job || !job.is_active) return;

  logger.info(`Running cron job ${job.id} (${job.name}) [${job.command_type}]`);
  const result = job.command_type === 'safe_action'
    ? await runSafeAction(job)
    : await runShellCommand(job.command);

  await database('cron_jobs').where('id', job.id).update({
    last_run_at: new Date(),
    last_exit_code: result.exitCode,
    last_output: result.output.slice(0, MAX_OUTPUT_CHARS) + (result.truncated ? '\n[output truncated]' : ''),
    updated_at: new Date()
  });

  logger.audit('cron_job_run', { id: job.created_by }, 'cron', {
    jobId: job.id, name: job.name, commandType: job.command_type, exitCode: result.exitCode
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

// Stops and forgets every currently-registered task without touching the
// database — used before a full re-registration (see start()'s use after
// a backup restore) so stale in-memory tasks for jobs a restore removed
// or deactivated don't keep firing forever. register()/unregister() alone
// only ever add or replace one job at a time; there was previously no way
// to reset everything at once.
function stopAll() {
  for (const task of registeredTasks.values()) {
    task.stop();
  }
  registeredTasks.clear();
}

async function start() {
  const jobs = await database('cron_jobs').where('is_active', true);
  for (const job of jobs) {
    register(job);
  }
  logger.info(`Cron job runner started (${registeredTasks.size} active job(s) registered)`);
}

module.exports = { start, register, unregister, stopAll, runJob };
