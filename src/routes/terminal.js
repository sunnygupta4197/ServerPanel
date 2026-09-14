const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fsSync = require('fs');
const { requireRole } = require('../middleware/authMiddleware');
const logger = require('../config/logger');
const config = require('../config/config');
const database = require('../config/database');

const MAX_OUTPUT_CHARS = 200 * 1024; // cap captured output per command
const COMMAND_TIMEOUT_MS = 30000;

// Admin-only, fully audited command execution — the direct successor to
// POST /api/system/execute, which was removed earlier because it was
// reachable without real authentication. Unlike every other exec call in
// this codebase (which deliberately avoids a shell via execFile + an argv
// array, so injection is structurally impossible — see services.js), a
// terminal's entire purpose is interpreting arbitrary shell syntax: pipes,
// redirects, globs. That defense doesn't apply here by design; there is no
// way to build "run arbitrary shell text" without a shell interpreting it.
//
// The security model instead rests on three things: requireRole('admin')
// rather than a permission string (so this can never be handed to a
// non-admin account via a custom permissions array — see users.js's
// defense-in-depth fix), a full audit trail of every command run (both the
// winston log and a queryable activity_logs row), and the fact that this
// grants no capability an admin didn't already effectively have through
// Files/Services/Database — it's a more direct interface to it, with a
// paper trail those routes don't carry today.
router.post('/execute',
  requireRole('admin'),
  [
    body('command').isString().isLength({ min: 1, max: 4000 }).withMessage('Command is required'),
    body('cwd').optional().isString().isLength({ max: 1000 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { command } = req.body;
      const cwd = req.body.cwd ? path.resolve(req.body.cwd) : (config.SYSTEM.HOME_DIR || process.cwd());

      if (!isDirectory(cwd)) {
        return res.status(400).json({ success: false, message: `Working directory does not exist: ${cwd}` });
      }

      // There's no persistent shell process between requests (each command
      // is its own spawn), so a bare `cd <path>` has no observable effect
      // once that process exits. Handle it directly: validate the target
      // and hand back the new tracked cwd for the client to send on its
      // next request, instead of spawning a no-op.
      const trimmed = command.trim();
      const cdMatch = /^cd\s+(.+)$/i.exec(trimmed);
      if (cdMatch) {
        const target = path.resolve(cwd, cdMatch[1].trim().replace(/^["']|["']$/g, ''));
        if (!isDirectory(target)) {
          return res.status(400).json({ success: false, message: `No such directory: ${target}` });
        }
        await logCommand(req, command, cwd, { exitCode: 0, note: 'cd' });
        return res.json({ success: true, data: { stdout: '', stderr: '', exitCode: 0, cwd: target } });
      }

      await logCommand(req, command, cwd, { note: 'started' });

      const startedAt = Date.now();
      const result = await runShellCommand(command, cwd);

      await logCommand(req, command, cwd, {
        exitCode: result.exitCode,
        durationMs: Date.now() - startedAt,
        truncated: result.truncated,
        timedOut: result.timedOut
      });

      res.json({ success: true, data: { ...result, cwd } });
    } catch (error) {
      logger.error('Error executing terminal command:', error);
      res.status(500).json({ success: false, message: 'Failed to execute command' });
    }
  }
);

// Recent terminal command history for review — pulled from activity_logs
// rather than a dedicated table, since that's already the established
// audit-trail store (see users.js's user_created/updated/deleted logging)
// and this avoids a new migration just to duplicate it.
router.get('/history', requireRole('admin'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const rows = await database('activity_logs')
      .where('action', 'terminal_command')
      .orderBy('performed_at', 'desc')
      .limit(limit);

    res.json({
      success: true,
      data: rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        details: JSON.parse(row.details || '{}'),
        ipAddress: row.ip_address,
        performedAt: row.performed_at
      }))
    });
  } catch (error) {
    logger.error('Error getting terminal history:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve terminal history' });
  }
});

function isDirectory(targetPath) {
  try {
    return fsSync.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

async function logCommand(req, command, cwd, extra) {
  const details = { command, cwd, ...extra };
  logger.audit('terminal_command', req.user, 'terminal', details);
  await database('activity_logs').insert({
    user_id: req.user.id,
    action: 'terminal_command',
    resource_type: 'terminal',
    details: JSON.stringify(details),
    ip_address: req.ip,
    // activity_logs.severity is its own enum (info/warning/error) — distinct
    // from system_alerts' low/medium/high/critical, and easy to cross the
    // streams on given this codebase's history of exactly that bug class.
    severity: extra.exitCode && extra.exitCode !== 0 ? 'warning' : 'info',
    performed_at: new Date()
  }).catch(err => logger.error('Failed to write terminal audit log row:', err));
}

// Runs `command` through the platform's real shell (cmd.exe on Windows,
// bash elsewhere) — see the top-of-file comment for why this is the one
// place in the codebase that's allowed to. Output is captured with a hard
// size cap (a runaway command shouldn't be able to grow memory unbounded)
// and the process is killed after COMMAND_TIMEOUT_MS if it hasn't exited.
function runShellCommand(command, cwd) {
  return new Promise((resolve) => {
    const isWindows = config.SYSTEM.IS_WINDOWS;
    const shellBin = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];

    const child = spawn(shellBin, shellArgs, { cwd });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    const append = (current, chunk) => {
      if (current.length >= MAX_OUTPUT_CHARS) {
        truncated = true;
        return current;
      }
      return current + chunk;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout = append(stdout, d.toString()); });
    child.stderr.on('data', (d) => { stderr = append(stderr, d.toString()); });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + `\n${err.message}`, exitCode: -1, truncated, timedOut });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: timedOut ? stderr + '\n[command timed out and was killed]' : stderr,
        exitCode: code,
        truncated,
        timedOut
      });
    });
  });
}

module.exports = router;
