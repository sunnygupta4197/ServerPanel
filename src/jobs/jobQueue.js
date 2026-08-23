// In-memory background job queue with Socket.IO broadcasting.
// Jobs are keyed by ID and kept in insertion order; oldest completed jobs
// are pruned when the map grows past MAX_JOBS entries.

const EventEmitter = require('events');
const MAX_JOBS = 200;
const KEEP_JOBS = 100;

const emitter = new EventEmitter();
let io = null;
const jobs = new Map();
let counter = 0;

function setIO(ioInstance) {
  io = ioInstance;
}

function createJob(type, label, userId = null) {
  const id = `job_${Date.now()}_${++counter}`;
  const job = {
    id,
    type,
    label,
    status: 'queued',
    progress: 0,
    userId,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    error: null,
    result: null
  };
  jobs.set(id, job);
  _broadcast('job:queued', job);
  _prune();
  return job;
}

function updateJob(id, updates) {
  const job = jobs.get(id);
  if (!job) return null;

  Object.assign(job, updates);

  if (updates.status === 'running' && !job.startedAt) {
    job.startedAt = new Date().toISOString();
  }
  if (['completed', 'failed', 'canceled'].includes(updates.status) && !job.completedAt) {
    job.completedAt = new Date().toISOString();
    emitter.emit('job:done', job);
  }

  _broadcast('job:update', job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function getJobs() {
  return Array.from(jobs.values()).slice(-KEEP_JOBS);
}

function _broadcast(event, data) {
  if (io) io.to('jobs').emit(event, data);
}

function _prune() {
  if (jobs.size <= MAX_JOBS) return;
  // Remove oldest non-active jobs first
  for (const [id, job] of jobs) {
    if (['completed', 'failed', 'canceled'].includes(job.status)) {
      jobs.delete(id);
      if (jobs.size <= KEEP_JOBS) return;
    }
  }
}

module.exports = { setIO, createJob, updateJob, getJob, getJobs, emitter };
