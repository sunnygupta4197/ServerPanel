// Real recursive directory size, used by quotaEnforcer.js for both FTP
// home directories and (once mailService.js exists) mailboxes. A plain
// Node walk rather than shelling out to `du` — works identically on
// Windows dev machines and Linux hosts, and this codebase already avoids
// spawning a shell for anything that doesn't strictly need one.
const fs = require('fs').promises;
const path = require('path');

// Returns bytes. Missing directories are treated as empty (0), not an
// error — an account whose home_dir hasn't been created yet, or was
// removed out-of-band, isn't "infinitely over quota", it's just empty.
async function getDirectorySizeBytes(dirPath) {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isSymbolicLink()) continue; // never follow symlinks into a size count — avoids double-counting or escaping the account's own tree
    if (entry.isDirectory()) {
      total += await getDirectorySizeBytes(entryPath);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(entryPath);
        total += stat.size;
      } catch { /* file removed between readdir and stat — skip it */ }
    }
  }
  return total;
}

async function getDirectorySizeMb(dirPath) {
  const bytes = await getDirectorySizeBytes(dirPath);
  return Math.round(bytes / (1024 * 1024));
}

module.exports = { getDirectorySizeBytes, getDirectorySizeMb };
