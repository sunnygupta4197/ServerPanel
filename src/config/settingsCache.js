// A small in-memory cache of the live-configurable settings stored in
// server_configs (see src/routes/settings.js's SETTINGS_SCHEMA). Several
// of these are read on hot paths (every login, every failed-login check)
// where a DB round-trip per request would be wasteful, and some (JWT
// expiry, an already-running setInterval) can't be "read live from the
// DB" at all — they need an in-memory value that gets updated the moment
// settings.js saves a change, which is exactly what this module is for.
//
// Falls back to the static config.js/env-var defaults whenever a key
// hasn't been explicitly set, so a fresh install with no server_configs
// rows behaves exactly as it did before this cache existed.
const database = require('./database');
const logger = require('./logger');

const cache = new Map();

function coerce(rawValue, type) {
  if (type === 'number') return Number(rawValue);
  if (type === 'boolean') return rawValue === 'true' || rawValue === true;
  if (type === 'json') {
    try { return JSON.parse(rawValue); } catch { return null; }
  }
  return rawValue;
}

async function load() {
  try {
    const rows = await database('server_configs').select('config_key', 'config_value', 'config_type');
    cache.clear();
    for (const row of rows) {
      cache.set(row.config_key, coerce(row.config_value, row.config_type));
    }
    logger.info(`Settings cache loaded (${cache.size} keys)`);
  } catch (error) {
    // Table may not exist yet on a brand-new install before migrations run;
    // callers all have static-config fallbacks, so this is non-fatal.
    logger.warn('Could not load settings cache (using static defaults):', error.message);
  }
}

// Called by settings.js right after a successful save, so the new value is
// visible immediately without waiting for the next load() / a restart.
function set(key, value) {
  cache.set(key, value);
}

function getNumber(key, fallback) {
  const value = cache.get(key);
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

function getString(key, fallback) {
  const value = cache.get(key);
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function getBoolean(key, fallback) {
  const value = cache.get(key);
  return typeof value === 'boolean' ? value : fallback;
}

module.exports = { load, set, getNumber, getString, getBoolean };
