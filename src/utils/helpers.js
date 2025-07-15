// Utility Helper Functions for ServerPanel Pro
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Format bytes to human readable string
 * @param {number} bytes - Bytes to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted string
 */
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * Format uptime in human readable format
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime
 */
const formatUptime = (seconds) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
};

/**
 * Generate secure random string
 * @param {number} length - Length of string
 * @returns {string} Random string
 */
const generateRandomString = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Generate secure API key
 * @returns {string} API key
 */
const generateApiKey = () => {
  return crypto.randomBytes(32).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
};

/**
 * Hash password with salt
 * @param {string} password - Password to hash
 * @param {number} saltRounds - Salt rounds
 * @returns {Promise<string>} Hashed password
 */
const hashPassword = async (password, saltRounds = 12) => {
  const bcrypt = require('bcryptjs');
  return await bcrypt.hash(password, saltRounds);
};

/**
 * Verify password against hash
 * @param {string} password - Password to verify
 * @param {string} hash - Hash to compare against
 * @returns {Promise<boolean>} Verification result
 */
const verifyPassword = async (password, hash) => {
  const bcrypt = require('bcryptjs');
  return await bcrypt.compare(password, hash);
};

/**
 * Sanitize filename for safe filesystem operations
 * @param {string} filename - Filename to sanitize
 * @returns {string} Sanitized filename
 */
const sanitizeFilename = (filename) => {
  // Remove path traversal attempts
  const sanitized = filename.replace(/[\/\\:*?"<>|]/g, '_');
  
  // Remove leading/trailing dots and spaces
  return sanitized.replace(/^[\s\.]+|[\s\.]+$/g, '');
};

/**
 * Validate file path for security
 * @param {string} filePath - File path to validate
 * @param {string} basePath - Base path to restrict to
 * @returns {boolean} Whether path is safe
 */
const validateFilePath = (filePath, basePath = '/') => {
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(basePath);
  
  return resolvedPath.startsWith(resolvedBase);
};

/**
 * Check if file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} Whether file exists
 */
const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Create directory if it doesn't exist
 * @param {string} dirPath - Directory path
 * @returns {Promise<void>}
 */
const ensureDir = async (dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
};

/**
 * Get file mime type
 * @param {string} filePath - Path to file
 * @returns {string} Mime type
 */
const getMimeType = (filePath) => {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.xml': 'application/xml',
    '.yml': 'text/yaml',
    '.yaml': 'text/yaml'
  };
  
  const ext = path.extname(filePath).toLowerCase();
  return mimeTypes[ext] || 'application/octet-stream';
};

/**
 * Parse file size string to bytes
 * @param {string} sizeStr - Size string (e.g., "10MB", "1.5GB")
 * @returns {number} Size in bytes
 */
const parseSize = (sizeStr) => {
  const units = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4
  };
  
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([A-Z]{1,2})$/i);
  if (!match) return 0;
  
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  
  return Math.floor(value * (units[unit] || 1));
};

/**
 * Deep merge objects
 * @param {object} target - Target object
 * @param {object} source - Source object
 * @returns {object} Merged object
 */
const deepMerge = (target, source) => {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] instanceof Object && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
};

/**
 * Debounce function execution
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Throttle function execution
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
const throttle = (func, limit) => {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise<any>} Result of function
 */
const retry = async (fn, maxRetries = 3, baseDelay = 1000) => {
  let lastError;
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (i === maxRetries) {
        throw lastError;
      }
      
      const delay = baseDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Get system information
 * @returns {object} System information
 */
const getSystemInfo = () => {
  return {
    platform: os.platform(),
    type: os.type(),
    arch: os.arch(),
    release: os.release(),
    hostname: os.hostname(),
    uptime: os.uptime(),
    loadavg: os.loadavg(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    cpus: os.cpus().length,
    networkInterfaces: os.networkInterfaces()
  };
};

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {boolean} Whether email is valid
 */
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate URL
 * @param {string} url - URL to validate
 * @returns {boolean} Whether URL is valid
 */
const validateURL = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/**
 * Validate IP address
 * @param {string} ip - IP address to validate
 * @returns {boolean} Whether IP is valid
 */
const validateIP = (ip) => {
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
};

/**
 * Generate UUID v4
 * @returns {string} UUID
 */
const generateUUID = () => {
  return crypto.randomUUID();
};

/**
 * Hash string with SHA-256
 * @param {string} str - String to hash
 * @returns {string} Hash
 */
const hashString = (str) => {
  return crypto.createHash('sha256').update(str).digest('hex');
};

/**
 * Encrypt string with AES-256
 * @param {string} text - Text to encrypt
 * @param {string} key - Encryption key
 * @returns {string} Encrypted text
 */
const encrypt = (text, key) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher('aes-256-cbc', key);
  cipher.setAutoPadding(true);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
};

/**
 * Decrypt string with AES-256
 * @param {string} encryptedText - Encrypted text
 * @param {string} key - Decryption key
 * @returns {string} Decrypted text
 */
const decrypt = (encryptedText, key) => {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  
  const decipher = crypto.createDecipher('aes-256-cbc', key);
  decipher.setAutoPadding(true);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

/**
 * Compare versions
 * @param {string} version1 - First version
 * @param {string} version2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
const compareVersions = (version1, version2) => {
  const v1parts = version1.split('.').map(Number);
  const v2parts = version2.split('.').map(Number);
  
  const maxLength = Math.max(v1parts.length, v2parts.length);
  
  for (let i = 0; i < maxLength; i++) {
    const v1part = v1parts[i] || 0;
    const v2part = v2parts[i] || 0;
    
    if (v1part < v2part) return -1;
    if (v1part > v2part) return 1;
  }
  
  return 0;
};

/**
 * Check if string is JSON
 * @param {string} str - String to check
 * @returns {boolean} Whether string is valid JSON
 */
const isJSON = (str) => {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
};

/**
 * Convert object to query string
 * @param {object} obj - Object to convert
 * @returns {string} Query string
 */
const objectToQueryString = (obj) => {
  return Object.keys(obj)
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(obj[key]))
    .join('&');
};

/**
 * Parse query string to object
 * @param {string} queryString - Query string to parse
 * @returns {object} Parsed object
 */
const queryStringToObject = (queryString) => {
  const params = {};
  const pairs = queryString.split('&');
  
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    params[decodeURIComponent(key)] = decodeURIComponent(value || '');
  }
  
  return params;
};

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
const escapeHtml = (text) => {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  
  return text.replace(/[&<>"']/g, (m) => map[m]);
};

/**
 * Generate random number in range
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Random number
 */
const randomInRange = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Get current timestamp
 * @returns {number} Current timestamp
 */
const timestamp = () => {
  return Date.now();
};

/**
 * Format timestamp to date string
 * @param {number} timestamp - Timestamp to format
 * @param {string} format - Format string
 * @returns {string} Formatted date
 */
const formatTimestamp = (timestamp, format = 'YYYY-MM-DD HH:mm:ss') => {
  const date = new Date(timestamp);
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hour)
    .replace('mm', minute)
    .replace('ss', second);
};

/**
 * Calculate percentage
 * @param {number} value - Current value
 * @param {number} total - Total value
 * @param {number} decimals - Number of decimals
 * @returns {number} Percentage
 */
const calculatePercentage = (value, total, decimals = 2) => {
  if (total === 0) return 0;
  return Number(((value / total) * 100).toFixed(decimals));
};

/**
 * Clamp value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
const clamp = (value, min, max) => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Check if value is empty
 * @param {any} value - Value to check
 * @returns {boolean} Whether value is empty
 */
const isEmpty = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && Object.keys(value).length === 0) return true;
  return false;
};

// Export all utility functions
module.exports = {
  formatBytes,
  formatUptime,
  generateRandomString,
  generateApiKey,
  hashPassword,
  verifyPassword,
  sanitizeFilename,
  validateFilePath,
  fileExists,
  ensureDir,
  getMimeType,
  parseSize,
  deepMerge,
  debounce,
  throttle,
  retry,
  sleep,
  getSystemInfo,
  validateEmail,
  validateURL,
  validateIP,
  generateUUID,
  hashString,
  encrypt,
  decrypt,
  compareVersions,
  isJSON,
  objectToQueryString,
  queryStringToObject,
  escapeHtml,
  randomInRange,
  timestamp,
  formatTimestamp,
  calculatePercentage,
  clamp,
  isEmpty
};