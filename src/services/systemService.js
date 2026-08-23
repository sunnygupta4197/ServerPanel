const si = require('systeminformation');
const os = require('os');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../config/logger');
const config = require('../config/config');
const EventEmitter = require('events');

const execAsync = promisify(exec);

class SystemMonitor extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.interval = null;
    this.previousCPUInfo = null;
  }

  start(intervalMs = 5000) {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('Starting real-time system monitoring...');
    console.log(`📱 Platform: ${os.platform()} ${os.arch()}`);
    console.log(`🔧 Node.js: ${process.version}`);
    
    // Platform-specific warnings
    if (os.platform() === 'win32') {
      console.log('⚠️  Windows: Some features may use fallback methods');
    }
    if (os.arch() === 'arm64') {
      console.log('⚠️  ARM64: Using cross-platform fallbacks for compatibility');
    }
    
    this.interval = setInterval(async () => {
      try {
        const stats = await this.getRealtimeStats();
        this.emit('stats', stats);
      } catch (error) {
        console.error('System monitoring error:', error);
      }
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('System monitoring stopped');
  }

  async getRealtimeStats() {
    try {
      // Get basic system information with error handling
      let cpu, mem, disk, uptime;
      
      try {
        cpu = await si.currentLoad();
        // If systeminformation returns 0 or invalid data, use our fallback
        if (!cpu || !cpu.currentload || cpu.currentload === 0) {
          console.log('⚠️  systeminformation returned 0% CPU, using Node.js calculation');
          cpu = { 
            currentload: this.getCPUUsageFallback(), 
            cpus: os.cpus() 
          };
        }
      } catch (error) {
        console.log('⚠️  systeminformation failed, using Node.js CPU calculation');
        cpu = { 
          currentload: this.getCPUUsageFallback(), 
          cpus: os.cpus() 
        };
      }
      
      try {
        mem = await si.mem();
      } catch (error) {
        mem = { total: 0, used: 0, free: 0 };
      }
      
      try {
        disk = await si.fsSize();
      } catch (error) {
        disk = [];
      }
      
      try {
        uptime = await si.time();
      } catch (error) {
        // Fallback to os.uptime() if si.time() fails
        const osUptime = require('os').uptime();
        uptime = { uptime: osUptime };
      }
      
      // Try to get load average (Linux/Mac only)
      let load = null;
      if (os.platform() !== 'win32') {
        try {
          load = await si.loadavg();
        } catch (error) {
          // Ignore load average errors on systems that don't support it
          load = null;
        }
      }

      const stats = {
        timestamp: new Date().toISOString(),
        cpu: {
          usage: Math.round(cpu.currentload || 0),
          cores: cpu.cpus?.length || os.cpus().length
        },
        memory: {
          total: mem.total || 0,
          used: mem.used || 0,
          free: mem.free || 0,
          usage: mem.total > 0 ? Math.round((mem.used / mem.total) * 100) : 0
        },
        disk: disk && disk.length > 0 ? {
          total: disk[0].size || 0,
          used: disk[0].used || 0,
          free: disk[0].available || 0,
          usage: Math.round(disk[0].use || 0)
        } : {
          total: 0,
          used: 0,
          free: 0,
          usage: 0
        },
        load: load ? {
          avg1: load.avg1load || 0,
          avg5: load.avg5load || 0,
          avg15: load.avg15load || 0
        } : {
          avg1: 0,
          avg5: 0,
          avg15: 0
        },
        uptime: uptime.uptime || 0
      };
      
      return stats;
    } catch (error) {
      console.error('Error getting system stats:', error);
      
      // Fallback to basic Node.js system info
      try {
        const osStats = {
          timestamp: new Date().toISOString(),
          cpu: {
            usage: this.getCPUUsageFallback(), // Cross-platform CPU usage
            cores: os.cpus().length
          },
          memory: {
            total: os.totalmem(),
            used: os.totalmem() - os.freemem(),
            free: os.freemem(),
            usage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
          },
          disk: {
            total: 0,
            used: 0,
            free: 0,
            usage: 0
          },
          load: {
            avg1: os.loadavg ? (os.loadavg()[0] || 0) : 0,
            avg5: os.loadavg ? (os.loadavg()[1] || 0) : 0,
            avg15: os.loadavg ? (os.loadavg()[2] || 0) : 0
          },
          uptime: os.uptime()
        };
        
        console.log('📊 Using fallback system stats (Node.js built-ins)');
        return osStats;
      } catch (fallbackError) {
        console.error('Fallback stats also failed:', fallbackError);
        return null;
      }
    }
  }

  // Cross-platform CPU usage calculation using Node.js built-ins
  getCPUUsageFallback() {
    try {
      const cpus = os.cpus();
      
      if (this.previousCPUInfo) {
        // Calculate CPU usage between intervals
        let totalIdle = 0;
        let totalTick = 0;
        let totalIdlePrev = 0;
        let totalTickPrev = 0;

        for (let i = 0; i < cpus.length; i++) {
          const cpu = cpus[i];
          const prevCpu = this.previousCPUInfo[i];
          
          // Current CPU times
          for (let type in cpu.times) {
            totalTick += cpu.times[type];
          }
          totalIdle += cpu.times.idle;

          // Previous CPU times
          for (let type in prevCpu.times) {
            totalTickPrev += prevCpu.times[type];
          }
          totalIdlePrev += prevCpu.times.idle;
        }

        const totalTickDiff = totalTick - totalTickPrev;
        const totalIdleDiff = totalIdle - totalIdlePrev;

        if (totalTickDiff > 0) {
          const usage = 100 - Math.round((100 * totalIdleDiff) / totalTickDiff);
          this.previousCPUInfo = cpus;
          return Math.max(0, Math.min(100, usage));
        }
      }

      // Store current CPU info for next calculation; return 0 until next interval
      this.previousCPUInfo = cpus;

      // On Unix, use load average for first-run estimate
      if (os.platform() !== 'win32') {
        const loadAvg = os.loadavg();
        if (loadAvg && loadAvg.length > 0) {
          return Math.min(Math.round((loadAvg[0] / cpus.length) * 100), 100);
        }
      }

      return 0;
    } catch (error) {
      logger.warn('CPU usage calculation failed:', error.message);
      return 0;
    }
  }

  // Get disk usage with multiple fallback methods
  async getDiskUsageFallback() {
    try {
      // Try different methods based on platform
      if (os.platform() === 'win32') {
        return this.getWindowsDiskUsage();
      } else {
        return this.getUnixDiskUsage();
      }
    } catch (error) {
      return { total: 0, used: 0, free: 0, usage: 0 };
    }
  }

  getWindowsDiskUsage() {
    // Windows-specific disk usage (would need wmi or powershell)
    return { total: 0, used: 0, free: 0, usage: 0 };
  }

  getUnixDiskUsage() {
    // Unix-specific disk usage (could use df command)
    return { total: 0, used: 0, free: 0, usage: 0 };
  }

  // Format bytes to human readable
  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

const systemMonitor = new SystemMonitor();

class SystemService {
  constructor() {
    this.platform = os.platform();
    this.isWindows = this.platform === 'win32';
    this.isLinux = this.platform === 'linux';
    this.isMac = this.platform === 'darwin';
  }

  // Get comprehensive system information (cached 60s — hardware rarely changes)
  async getSystemInfo() {
    const now = Date.now();
    if (this._infoCache && now - this._infoCacheAt < 60000) {
      return this._infoCache;
    }

    const timeout = (ms, fallback) => new Promise(resolve => setTimeout(() => resolve(fallback), ms));
    const safe = (promise, fallback) => Promise.race([promise.catch(() => fallback), timeout(4000, fallback)]);

    try {
      const [cpu, memory, disks, network, system] = await Promise.all([
        safe(si.cpu(), {}),
        safe(si.mem(), { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem() }),
        safe(si.fsSize(), []),
        safe(si.networkInterfaces(), []),
        safe(si.system(), {}),
      ]);

      const result = {
        system: {
          platform: this.platform,
          hostname: os.hostname(),
          type: os.type(),
          arch: os.arch(),
          release: os.release(),
          uptime: os.uptime(),
          manufacturer: system.manufacturer || 'Unknown',
          model: system.model || 'Unknown',
          version: system.version || 'Unknown',
        },
        cpu: {
          manufacturer: cpu.manufacturer,
          brand: cpu.brand,
          speed: cpu.speed,
          speedMin: cpu.speedMin,
          speedMax: cpu.speedMax,
          cores: cpu.cores || os.cpus().length,
          physicalCores: cpu.physicalCores,
          processors: cpu.processors,
          socket: cpu.socket,
          cache: cpu.cache
        },
        memory: {
          total: memory.total,
          free: memory.free,
          used: memory.used,
          active: memory.active,
          available: memory.available,
          swapTotal: memory.swaptotal,
          swapUsed: memory.swapused,
          swapFree: memory.swapfree
        },
        storage: disks.map(disk => ({
          filesystem: disk.fs,
          type: disk.type,
          size: disk.size,
          used: disk.used,
          available: disk.available,
          usage: disk.use,
          mount: disk.mount
        })),
        network: network.filter(iface => !iface.internal).map(iface => ({
          iface: iface.iface,
          ifaceName: iface.ifaceName,
          type: iface.type,
          ip4: iface.ip4,
          ip6: iface.ip6,
          mac: iface.mac,
          speed: iface.speed,
          operstate: iface.operstate,
        })),
        os: {
          platform: this.platform,
          release: os.release(),
        }
      };

      this._infoCache = result;
      this._infoCacheAt = now;
      return result;
    } catch (error) {
      logger.error('Error getting system information:', error);
      throw new Error('Failed to retrieve system information');
    }
  }

  // Get real-time system statistics (fast path — no process enumeration)
  async getSystemStats() {
    const timeout = (ms, fallback) => new Promise(resolve => setTimeout(() => resolve(fallback), ms));
    const safe = (promise, fallback) => Promise.race([promise.catch(() => fallback), timeout(3000, fallback)]);

    try {
      const [currentLoad, memory, temp] = await Promise.all([
        safe(si.currentLoad(), { currentload: 0, currentload_user: 0, currentload_system: 0, currentload_idle: 100, currentload_nice: 0, currentload_irq: 0, currentload_steal: 0, currentload_guest: 0, cpus: [] }),
        safe(si.mem(), { total: os.totalmem(), used: os.totalmem() - os.freemem(), free: os.freemem(), shared: 0, buffers: 0, cached: 0, available: os.freemem(), swaptotal: 0, swapused: 0, swapfree: 0 }),
        safe(si.cpuTemperature(), { main: null }),
      ]);

      return {
        timestamp: new Date().toISOString(),
        cpu: {
          usage: Number((currentLoad.currentload || 0).toFixed(2)),
          user: Number((currentLoad.currentload_user || 0).toFixed(2)),
          system: Number((currentLoad.currentload_system || 0).toFixed(2)),
          idle: Number((currentLoad.currentload_idle || 100).toFixed(2)),
          nice: Number((currentLoad.currentload_nice || 0).toFixed(2)),
          irq: Number((currentLoad.currentload_irq || 0).toFixed(2)),
          steal: Number((currentLoad.currentload_steal || 0).toFixed(2)),
          guest: Number((currentLoad.currentload_guest || 0).toFixed(2)),
          temperature: temp.main || null,
          cores: (currentLoad.cpus || []).map(cpu => ({
            load: Number((cpu.load || 0).toFixed(2)),
            loadUser: Number((cpu.load_user || 0).toFixed(2)),
            loadSystem: Number((cpu.load_system || 0).toFixed(2)),
            loadNice: Number((cpu.load_nice || 0).toFixed(2)),
            loadIdle: Number((cpu.load_idle || 0).toFixed(2)),
            loadIrq: Number((cpu.load_irq || 0).toFixed(2))
          }))
        },
        memory: {
          total: memory.total,
          used: memory.used,
          free: memory.free,
          shared: memory.shared || 0,
          buffers: memory.buffers || 0,
          cached: memory.cached || 0,
          available: memory.available,
          usage: memory.total > 0 ? Number(((memory.used / memory.total) * 100).toFixed(2)) : 0,
          swapTotal: memory.swaptotal,
          swapUsed: memory.swapused,
          swapFree: memory.swapfree,
          swapUsage: memory.swaptotal > 0 ? Number(((memory.swapused / memory.swaptotal) * 100).toFixed(2)) : 0
        },
        loadAverage: os.loadavg()
      };
    } catch (error) {
      logger.error('Error getting system statistics:', error);
      throw new Error('Failed to retrieve system statistics');
    }
  }

  // Get detailed process information
  async getProcesses(limit = 50) {
    try {
      const processes = await si.processes();
      
      return {
        total: processes.all,
        running: processes.running,
        sleeping: processes.sleeping,
        blocked: processes.blocked,
        processes: processes.list
          .sort((a, b) => (b.cpu || 0) - (a.cpu || 0))
          .slice(0, limit)
          .map(proc => ({
            pid: proc.pid,
            parentPid: proc.parentPid,
            name: proc.name,
            cpu: Number((proc.cpu || 0).toFixed(2)),
            memory: Number((proc.memory || 0).toFixed(2)),
            priority: proc.priority,
            user: proc.user,
            state: proc.state,
            started: proc.started,
            command: proc.command,
            params: proc.params,
            path: proc.path
          }))
      };
    } catch (error) {
      logger.error('Error getting processes:', error);
      throw new Error('Failed to retrieve process information');
    }
  }

  // Get network interfaces with detailed information
  async getNetworkInterfaces() {
    try {
      const [interfaces, connections, stats] = await Promise.all([
        si.networkInterfaces(),
        si.networkConnections(),
        si.networkStats()
      ]);

      return {
        interfaces: interfaces.map(iface => ({
          iface: iface.iface,
          ifaceName: iface.ifaceName,
          ip4: iface.ip4,
          ip4subnet: iface.ip4subnet,
          ip6: iface.ip6,
          ip6subnet: iface.ip6subnet,
          mac: iface.mac,
          internal: iface.internal,
          virtual: iface.virtual,
          operstate: iface.operstate,
          type: iface.type,
          duplex: iface.duplex,
          mtu: iface.mtu,
          speed: iface.speed,
          dhcp: iface.dhcp,
          dnsSuffix: iface.dnsSuffix,
          ieee8021xAuth: iface.ieee8021xAuth,
          ieee8021xState: iface.ieee8021xState,
          carrierChanges: iface.carrierChanges
        })),
        connections: connections.slice(0, 100).map(conn => ({
          protocol: conn.protocol,
          localAddress: conn.localaddress,
          localPort: conn.localport,
          peerAddress: conn.peeraddress,
          peerPort: conn.peerport,
          state: conn.state,
          pid: conn.pid,
          process: conn.process
        })),
        stats: stats.map(stat => ({
          iface: stat.iface,
          operstate: stat.operstate,
          rxBytes: stat.rx_bytes,
          rxDropped: stat.rx_dropped,
          rxErrors: stat.rx_errors,
          txBytes: stat.tx_bytes,
          txDropped: stat.tx_dropped,
          txErrors: stat.tx_errors,
          rxSec: stat.rx_sec,
          txSec: stat.tx_sec
        }))
      };
    } catch (error) {
      logger.error('Error getting network information:', error);
      throw new Error('Failed to retrieve network information');
    }
  }

  // Get storage information
  async getStorageInfo() {
    try {
      const [diskLayout, blockDevices, fsSize, fsStats, disksIO] = await Promise.all([
        si.diskLayout(),
        si.blockDevices(),
        si.fsSize(),
        si.fsStats(),
        si.disksIO()
      ]);

      return {
        disks: diskLayout.map(disk => ({
          device: disk.device,
          type: disk.type,
          name: disk.name,
          vendor: disk.vendor,
          size: disk.size,
          bytesPerSector: disk.bytesPerSector,
          totalCylinders: disk.totalCylinders,
          totalHeads: disk.totalHeads,
          totalSectors: disk.totalSectors,
          totalTracks: disk.totalTracks,
          tracksPerCylinder: disk.tracksPerCylinder,
          sectorsPerTrack: disk.sectorsPerTrack,
          firmwareRevision: disk.firmwareRevision,
          serialNum: disk.serialNum,
          interfaceType: disk.interfaceType,
          smartStatus: disk.smartStatus,
          temperature: disk.temperature
        })),
        blockDevices: blockDevices.map(device => ({
          name: device.name,
          identifier: device.identifier,
          type: device.type,
          fstype: device.fstype,
          mount: device.mount,
          size: device.size,
          physical: device.physical,
          uuid: device.uuid,
          label: device.label,
          model: device.model,
          serial: device.serial,
          removable: device.removable,
          protocol: device.protocol
        })),
        filesystems: fsSize.map(fs => ({
          fs: fs.fs,
          type: fs.type,
          size: fs.size,
          used: fs.used,
          available: fs.available,
          use: fs.use,
          mount: fs.mount
        })),
        io: disksIO ? {
          reads: disksIO.rIO,
          writes: disksIO.wIO,
          readBytes: disksIO.rIO_sec,
          writeBytes: disksIO.wIO_sec,
          readTime: disksIO.tIO,
          writeTime: disksIO.tIO_sec
        } : null
      };
    } catch (error) {
      logger.error('Error getting storage information:', error);
      throw new Error('Failed to retrieve storage information');
    }
  }

  // Get system services
  async getServices() {
    try {
      if (this.isWindows) {
        return await this.getWindowsServices();
      } else if (this.isLinux) {
        return await this.getLinuxServices();
      } else {
        throw new Error('Unsupported platform');
      }
    } catch (error) {
      logger.error('Error getting services:', error);
      throw new Error('Failed to retrieve services information');
    }
  }

  // Get Windows services
  async getWindowsServices() {
    try {
      const { stdout } = await execAsync('powershell "Get-Service | ConvertTo-Json"');
      const services = JSON.parse(stdout);
      
      return Array.isArray(services) ? services.map(service => ({
        name: service.Name,
        displayName: service.DisplayName,
        status: service.Status,
        startType: service.StartType,
        canPauseAndContinue: service.CanPauseAndContinue,
        canShutdown: service.CanShutdown,
        canStop: service.CanStop
      })) : [services];
    } catch (error) {
      logger.error('Error getting Windows services:', error);
      return [];
    }
  }

  // Get Linux services (systemd)
  async getLinuxServices() {
    try {
      const { stdout } = await execAsync('systemctl list-units --type=service --all --no-pager --output=json');
      const services = JSON.parse(stdout);
      
      return services.map(service => ({
        name: service.unit,
        loaded: service.load,
        active: service.active,
        sub: service.sub,
        description: service.description,
        following: service.following
      }));
    } catch (error) {
      logger.error('Error getting Linux services:', error);
      return [];
    }
  }

  // Get system users
  async getSystemUsers() {
    try {
      if (this.isWindows) {
        const { stdout } = await execAsync('powershell "Get-LocalUser | ConvertTo-Json"');
        const users = JSON.parse(stdout);
        return Array.isArray(users) ? users : [users];
      } else {
        const { stdout } = await execAsync('getent passwd');
        return stdout.split('\n')
          .filter(line => line.trim())
          .map(line => {
            const parts = line.split(':');
            return {
              username: parts[0],
              uid: parseInt(parts[2]),
              gid: parseInt(parts[3]),
              comment: parts[4],
              home: parts[5],
              shell: parts[6]
            };
          });
      }
    } catch (error) {
      logger.error('Error getting system users:', error);
      throw new Error('Failed to retrieve system users');
    }
  }

  // Get system environment variables
  async getEnvironmentVariables() {
    try {
      const env = process.env;
      const systemEnv = {};
      
      // Filter out sensitive variables
      const sensitiveKeys = ['PASSWORD', 'SECRET', 'KEY', 'TOKEN', 'AUTH'];
      
      Object.keys(env).forEach(key => {
        const isSensitive = sensitiveKeys.some(sensitive => 
          key.toUpperCase().includes(sensitive)
        );
        
        if (!isSensitive) {
          systemEnv[key] = env[key];
        } else {
          systemEnv[key] = '[HIDDEN]';
        }
      });
      
      return systemEnv;
    } catch (error) {
      logger.error('Error getting environment variables:', error);
      throw new Error('Failed to retrieve environment variables');
    }
  }

  // Get system uptime in different formats
  getUptime() {
    const uptimeSeconds = os.uptime();
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);
    
    return {
      seconds: uptimeSeconds,
      formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`,
      days,
      hours,
      minutes,
      readable: days > 0 ? `${days} days` : 
                hours > 0 ? `${hours} hours` : 
                minutes > 0 ? `${minutes} minutes` : 
                `${seconds} seconds`
    };
  }

  // Get CPU usage over time
  async getCPUUsageHistory(samples = 10, interval = 1000) {
    const history = [];
    
    for (let i = 0; i < samples; i++) {
      const load = await si.currentLoad();
      history.push({
        timestamp: new Date(),
        usage: Number(load.currentload.toFixed(2)),
        user: Number(load.currentload_user.toFixed(2)),
        system: Number(load.currentload_system.toFixed(2))
      });
      
      if (i < samples - 1) {
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
    
    return history;
  }

  // Get memory usage history
  async getMemoryUsageHistory(samples = 10, interval = 1000) {
    const history = [];
    
    for (let i = 0; i < samples; i++) {
      const memory = await si.mem();
      history.push({
        timestamp: new Date(),
        usage: Number(((memory.used / memory.total) * 100).toFixed(2)),
        total: memory.total,
        used: memory.used,
        free: memory.free
      });
      
      if (i < samples - 1) {
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
    
    return history;
  }

  // System health check
  async getSystemHealth() {
    try {
      const stats = await this.getSystemStats();
      const health = {
        overall: 'healthy',
        issues: [],
        score: 100
      };
      
      // Check CPU usage
      if (stats.cpu.usage > config.MONITORING.CPU_THRESHOLD) {
        health.issues.push({
          type: 'cpu',
          severity: stats.cpu.usage > 90 ? 'critical' : 'warning',
          message: `High CPU usage: ${stats.cpu.usage}%`,
          value: stats.cpu.usage,
          threshold: config.MONITORING.CPU_THRESHOLD
        });
        health.score -= stats.cpu.usage > 90 ? 30 : 15;
      }
      
      // Check memory usage
      if (stats.memory.usage > config.MONITORING.MEMORY_THRESHOLD) {
        health.issues.push({
          type: 'memory',
          severity: stats.memory.usage > 95 ? 'critical' : 'warning',
          message: `High memory usage: ${stats.memory.usage}%`,
          value: stats.memory.usage,
          threshold: config.MONITORING.MEMORY_THRESHOLD
        });
        health.score -= stats.memory.usage > 95 ? 25 : 10;
      }
      
      // Check load average
      const loadAvg = stats.loadAverage[0];
      const cpuCores = os.cpus().length;
      const loadPerCore = loadAvg / cpuCores;
      
      if (loadPerCore > 1.5) {
        health.issues.push({
          type: 'load',
          severity: loadPerCore > 3 ? 'critical' : 'warning',
          message: `High system load: ${loadAvg.toFixed(2)}`,
          value: loadPerCore,
          threshold: 1.5
        });
        health.score -= loadPerCore > 3 ? 20 : 10;
      }
      
      // Determine overall health
      if (health.score < 70) {
        health.overall = 'critical';
      } else if (health.score < 85) {
        health.overall = 'warning';
      }
      
      return health;
    } catch (error) {
      logger.error('Error getting system health:', error);
      return {
        overall: 'unknown',
        issues: [{
          type: 'system',
          severity: 'error',
          message: 'Unable to determine system health'
        }],
        score: 0
      };
    }
  }
}

module.exports = {
  SystemService: new SystemService(),
  systemMonitor
};