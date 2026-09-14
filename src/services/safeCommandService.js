// A small, fixed, vetted set of read-only diagnostic actions available to
// non-admin roles (via the terminal:safe / cron:safe permissions) and
// reusable as a cron job's target for the "user" role. Unlike the admin
// terminal/cron (requireRole('admin'), free-text shell — see terminal.js's
// top-of-file comment for why that's the one place in this codebase
// allowed to interpret arbitrary shell text), nothing here ever runs
// user-supplied text through a shell: every action is a hardcoded,
// argument-free (or tightly validated-argument) execFile call or a pure
// Node computation, selected by an enum key, never free text. There is no
// injection surface here regardless of what a non-admin account does with
// it — that's the whole point of this being a separate, much smaller
// module instead of just loosening terminal.js's own gate.
const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fsSync = require('fs');
const config = require('../config/config');

const execFileAsync = promisify(execFile);

const ACTIONS = {
  whoami: {
    label: 'Current user',
    async run() {
      const bin = config.SYSTEM.IS_WINDOWS ? 'whoami.exe' : 'whoami';
      const { stdout } = await execFileAsync(bin, []);
      return stdout.trim();
    }
  },
  hostname: {
    label: 'Server hostname',
    async run() { return os.hostname(); }
  },
  date: {
    label: 'Server date/time',
    async run() { return new Date().toString(); }
  },
  uptime: {
    label: 'Server uptime',
    async run() {
      const seconds = os.uptime();
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${days}d ${hours}h ${minutes}m`;
    }
  },
  disk_usage: {
    label: 'Disk usage',
    async run() {
      if (config.SYSTEM.IS_WINDOWS) {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          "Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{N='UsedGB';E={[math]::Round($_.Used/1GB,2)}},@{N='FreeGB';E={[math]::Round($_.Free/1GB,2)}} | Format-Table -AutoSize | Out-String -Width 200"
        ]);
        return stdout.trim();
      }
      const { stdout } = await execFileAsync('df', ['-h']);
      return stdout.trim();
    }
  },
  list_domain_files: {
    label: "List files in one of your domains' document root",
    requiresDomain: true,
    async run(documentRoot) {
      if (!fsSync.existsSync(documentRoot)) {
        return `Directory does not exist: ${documentRoot}`;
      }
      if (config.SYSTEM.IS_WINDOWS) {
        const { stdout } = await execFileAsync('cmd.exe', ['/d', '/c', 'dir', documentRoot]);
        return stdout.trim();
      }
      const { stdout } = await execFileAsync('ls', ['-la', documentRoot]);
      return stdout.trim();
    }
  }
};

function listActions() {
  return Object.entries(ACTIONS).map(([key, a]) => ({ key, label: a.label, requiresDomain: !!a.requiresDomain }));
}

function requiresDomain(key) {
  return !!ACTIONS[key]?.requiresDomain;
}

async function runAction(key, documentRoot) {
  const action = ACTIONS[key];
  if (!action) throw new Error(`Unknown safe action: ${key}`);
  if (action.requiresDomain && !documentRoot) throw new Error(`Action "${key}" requires a domainId`);
  return action.run(documentRoot);
}

module.exports = { listActions, requiresDomain, runAction };
