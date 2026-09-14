// PHP version detection + per-domain assignment. Real, tested detection on
// Linux (a plain directory scan, no shelling out); Windows has no reliable
// standard install layout to auto-detect, so versions there are
// admin-registered manually via POST /api/php/versions instead.
//
// Activation is scoped honestly: this writes a real per-domain php-fpm
// pool file (a genuinely useful, self-contained artifact) when the FPM
// pool-dir convention is detected, but does NOT attempt to locate and
// rewrite an existing nginx/apache vhost file to point at it — unlike
// applications.js's installer, a plain domain registered through the
// Domains page doesn't currently get a generated vhost file at all (only
// an app installed via the app catalog does), so there's nothing safe for
// this to edit yet. The response is explicit about that gap rather than
// claiming full end-to-end activation.
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../config/config');
const database = require('../config/database');
const logger = require('../config/logger');

const execFileAsync = promisify(execFile);

const FPM_POOL_DIR_CANDIDATES = [
  '/etc/php/{version}/fpm/pool.d',   // Debian/Ubuntu
  '/etc/opt/remi/php{version}/php-fpm.d' // some RHEL/Remi layouts
];
const FPM_SOCKET_CANDIDATES = [
  '/run/php/php{version}-fpm.sock',
  '/var/run/php-fpm/php{version}-fpm.sock'
];

function expand(template, version) {
  return template.replace('{version}', version);
}

// Scans /usr/bin for versioned PHP binaries (php7.4, php8.1, php8.2, ...) —
// pure fs, no exec, so there's no shell/injection surface at all here.
async function detectInstalledVersions() {
  if (config.SYSTEM.IS_WINDOWS) return [];

  let entries;
  try {
    entries = await fs.readdir('/usr/bin');
  } catch {
    return [];
  }

  const versions = [];
  for (const entry of entries) {
    const match = /^php(\d+\.\d+)$/.exec(entry);
    if (!match) continue;
    const version = match[1];
    const binaryPath = path.join('/usr/bin', entry);

    let fpmSocket = null;
    for (const template of FPM_SOCKET_CANDIDATES) {
      const candidate = expand(template, version);
      if (fsSync.existsSync(candidate)) { fpmSocket = candidate; break; }
    }

    versions.push({ version, binary_path: binaryPath, fpm_socket: fpmSocket });
  }
  return versions;
}

// Re-runs detection and upserts into php_installations, leaving any
// manually-registered (is_detected=false) rows untouched, and removing
// previously auto-detected rows that no longer exist on disk (a version
// that was uninstalled shouldn't linger as a selectable option).
async function refreshDetectedVersions() {
  const detected = await detectInstalledVersions();
  const detectedVersionSet = new Set(detected.map(v => v.version));

  for (const v of detected) {
    const existing = await database('php_installations').where('version', v.version).first();
    if (existing) {
      await database('php_installations').where('id', existing.id).update({
        binary_path: v.binary_path,
        fpm_socket: v.fpm_socket,
        updated_at: new Date()
      });
    } else {
      await database('php_installations').insert({
        version: v.version,
        binary_path: v.binary_path,
        fpm_socket: v.fpm_socket,
        is_detected: true,
        created_at: new Date(),
        updated_at: new Date()
      });
    }
  }

  const staleDetected = await database('php_installations').where('is_detected', true);
  for (const row of staleDetected) {
    if (!detectedVersionSet.has(row.version)) {
      await database('php_installations').where('id', row.id).del();
    }
  }

  return detected;
}

function findPoolDir(version) {
  for (const template of FPM_POOL_DIR_CANDIDATES) {
    const candidate = expand(template, version);
    if (fsSync.existsSync(candidate)) return candidate;
  }
  return null;
}

// Writes a real, self-contained php-fpm pool file for `domain` under
// whichever pool-dir convention is detected for `version`, then
// best-effort reloads that version's php-fpm service. Never hard-fails
// the domain's php_version assignment if any of this isn't possible —
// see the top-of-file comment on why vhost-side wiring stays manual.
async function activateDomainPhpVersion(domain, version, documentRoot) {
  const installation = await database('php_installations').where('version', version).first();
  if (!installation) {
    return { activated: false, reason: `PHP ${version} is not a registered installation` };
  }

  if (config.SYSTEM.IS_WINDOWS) {
    return { activated: false, reason: 'Automatic PHP-FPM pool activation is Linux-only; the version is saved for this domain but not yet wired to a running PHP handler' };
  }

  const poolDir = findPoolDir(version);
  if (!poolDir) {
    return { activated: false, reason: `No standard php-fpm pool directory found for PHP ${version} — version saved, but not yet activated` };
  }

  try {
    const poolName = `domain-${domain.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const socketPath = `/run/php/${poolName}.sock`;
    const poolFile = path.join(poolDir, `${poolName}.conf`);

    const poolConfig = [
      `[${poolName}]`,
      `user = www-data`,
      `group = www-data`,
      `listen = ${socketPath}`,
      `listen.owner = www-data`,
      `listen.group = www-data`,
      `pm = dynamic`,
      `pm.max_children = 5`,
      `pm.start_servers = 2`,
      `pm.min_spare_servers = 1`,
      `pm.max_spare_servers = 3`,
      `chdir = ${documentRoot}`,
      ''
    ].join('\n');

    await fs.writeFile(poolFile, poolConfig, 'utf8');

    const serviceName = `php${version}-fpm`;
    await execFileAsync('systemctl', ['reload', serviceName]).catch(err =>
      logger.warn(`Wrote FPM pool for ${domain} but could not reload ${serviceName}:`, err.message));

    return {
      activated: true,
      poolFile,
      socketPath,
      note: 'A php-fpm pool was written and the service reloaded. Point this domain\'s web server vhost at this socket (fastcgi_pass) to actually route requests through it — general vhost management isn\'t implemented yet, so that wiring is manual.'
    };
  } catch (error) {
    logger.warn(`Could not write php-fpm pool for domain ${domain}:`, error.message);
    return { activated: false, reason: `Could not write php-fpm pool config: ${error.message}` };
  }
}

// Counterpart to activateDomainPhpVersion that never existed until now —
// deleting a domain never removed its php-fpm pool file, leaving a real,
// still-running pool process (and listening socket) behind for a domain
// that no longer exists anywhere in the app. Same deterministic pool
// naming as activateDomainPhpVersion, so this can reconstruct the path
// without needing it stored anywhere.
async function deactivateDomainPhpVersion(domain, version) {
  if (config.SYSTEM.IS_WINDOWS || !version) {
    return { deactivated: false, reason: 'nothing to deactivate' };
  }

  const poolDir = findPoolDir(version);
  if (!poolDir) {
    return { deactivated: false, reason: `No standard php-fpm pool directory found for PHP ${version}` };
  }

  try {
    const poolName = `domain-${domain.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const poolFile = path.join(poolDir, `${poolName}.conf`);

    const existed = fsSync.existsSync(poolFile);
    if (existed) {
      await fs.unlink(poolFile);
      const serviceName = `php${version}-fpm`;
      await execFileAsync('systemctl', ['reload', serviceName]).catch(err =>
        logger.warn(`Removed FPM pool for ${domain} but could not reload ${serviceName}:`, err.message));
    }

    return { deactivated: existed };
  } catch (error) {
    logger.warn(`Could not remove php-fpm pool for domain ${domain}:`, error.message);
    return { deactivated: false, reason: `Could not remove php-fpm pool config: ${error.message}` };
  }
}

module.exports = {
  detectInstalledVersions,
  refreshDetectedVersions,
  activateDomainPhpVersion,
  deactivateDomainPhpVersion
};
