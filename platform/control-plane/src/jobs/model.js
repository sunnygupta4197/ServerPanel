const { JobStatus, JobType, ResourceType } = require('../../../shared/src');
const { assertObject, assertOneOf, assertString } = require('../../../shared/src/assert');

function createJob(input) {
  assertObject(input, 'job');
  assertString(input.id, 'job.id');
  assertOneOf(input.type, 'job.type', Object.values(JobType));
  assertOneOf(input.resourceType, 'job.resourceType', Object.values(ResourceType));
  assertString(input.resourceId, 'job.resourceId');

  return {
    id: input.id,
    type: input.type,
    status: JobStatus.QUEUED,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    targetServerId: input.targetServerId || null,
    requestedByUserId: input.requestedByUserId || null,
    input: input.input || {},
    output: null,
    progress: 0,
    attempts: 0,
    maxAttempts: input.maxAttempts || 3,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null
  };
}

function transitionJob(job, nextStatus) {
  assertObject(job, 'job');
  assertOneOf(nextStatus, 'nextStatus', Object.values(JobStatus));

  const allowedTransitions = {
    [JobStatus.QUEUED]: [JobStatus.RUNNING, JobStatus.CANCELED],
    [JobStatus.RUNNING]: [JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELED, JobStatus.TIMED_OUT],
    [JobStatus.SUCCEEDED]: [],
    [JobStatus.FAILED]: [],
    [JobStatus.CANCELED]: [],
    [JobStatus.TIMED_OUT]: []
  };

  const nextAllowed = allowedTransitions[job.status] || [];
  if (!nextAllowed.includes(nextStatus)) {
    throw new Error(`Invalid job status transition from ${job.status} to ${nextStatus}`);
  }

  const updated = { ...job, status: nextStatus };

  if (nextStatus === JobStatus.RUNNING) {
    updated.startedAt = updated.startedAt || new Date().toISOString();
    updated.attempts = (updated.attempts || 0) + 1;
  }

  if ([JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELED, JobStatus.TIMED_OUT].includes(nextStatus)) {
    updated.completedAt = new Date().toISOString();
  }

  return updated;
}

module.exports = {
  createJob,
  transitionJob
};
