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
//
// list_domain_files specifically must never shell out with documentRoot as
// an argument: it's domains.document_root, settable to an arbitrary string
// by any domain owner via PUT /api/domains/:id (domains:write, not admin),
// and cmd.exe on Windows does its own command-line parsing that doesn't
// match the CommandLineToArgvW-style quoting Node/libuv applies to argv —
// a trailing-backslash-before-quote payload (e.g. `C:\x\" & calc.exe & rem
// "`) breaks that quoting and lets cmd.exe treat the rest as a second,
// attacker-chosen command, even though execFile never spawns a shell on
// its own. Proven live against this exact call shape before being fixed.
// fs.readdir sidesteps the whole class — no process, no argv, no parser
// that could ever reinterpret the path as anything but a path.
const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');
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
      const entries = await fs.readdir(documentRoot, { withFileTypes: true });
      const rows = await Promise.all(entries.map(async (entry) => {
        let size = '-';
        let mtime = '';
        try {
          const stat = await fs.stat(path.join(documentRoot, entry.name));
          size = entry.isDirectory() ? '-' : String(stat.size);
          mtime = stat.mtime.toISOString();
        } catch { /* entry may have been removed/unreadable between readdir and stat */ }
        const kind = entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'link' : 'file';
        return `${kind.padEnd(4)} ${size.padStart(10)}  ${mtime}  ${entry.name}`;
      }));
      return rows.length ? rows.join('\n') : '(empty directory)';
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
