const si = require('systeminformation');
const os = require('os');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../config/logger');
const config = require('../config/config');

const execAsync = promisify(exec);

class SystemService {
  constructor() {
    this.platform = os.platform();
    this.isWindows = this.platform === 'win32';
    this.isLinux = this.platform === 'linux';
    this.isMac = this.platform === 'darwin';
  }

  // Get comprehensive system information
  async getSystemInfo() {
    try {
      const [cpu, memory, disks, network, system, graphics, battery, bluetooth] = await Promise.all([
        si.cpu(),
        si.mem(),
        si.fsSize(),
        si.networkInterfaces(),
        si.system(),
        si.graphics(),
        si.battery(),
        si.bluetoothDevices()
      ]);

      return {
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
          serial: system.serial || 'Unknown',
          uuid: system.uuid || 'Unknown'
        },
        cpu: {
          manufacturer: cpu.manufacturer,
          brand: cpu.brand,
          vendor: cpu.vendor,
          family: cpu.family,
          model: cpu.model,
          stepping: cpu.stepping,
          revision: cpu.revision,
          voltage: cpu.voltage,
          speed: cpu.speed,
          speedMin: cpu.speedMin,
          speedMax: cpu.speedMax,
          cores: cpu.cores,
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
          buffers: memory.buffers,
          cached: memory.cached,
          slab: memory.slab,
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
          duplex: iface.duplex,
          mtu: iface.mtu,
          operstate: iface.operstate,
          carrierChanges: iface.carrierChanges
        })),
        graphics: graphics.displays.map(display => ({
          vendor: display.vendor,
          model: display.model,
          deviceName: display.deviceName,
          resolutionX: display.resolutionX,
          resolutionY: display.resolutionY,
          sizeX: display.sizeX,
          sizeY: display.sizeY,
          pixelDepth: display.pixelDepth,
          currentRefreshRate: display.currentRefreshRate
        })),
        battery: battery.hasBattery ? {
          hasBattery: battery.hasbattery,
          cycleCount: battery.cycleCount,
          isCharging: battery.ischarging,
          designedCapacity: battery.designedcapacity,
          maxCapacity: battery.maxcapacity,
          currentCapacity: battery.currentcapacity,
          voltage: battery.voltage,
          capacityUnit: battery.capacityunit,
          percent: battery.percent,
          timeRemaining: battery.timeremaining,
          acConnected: battery.acconnected,
          type: battery.type,
          model: battery.model,
          manufacturer: battery.manufacturer,
          serial: battery.serial
        } : null,
        bluetooth: bluetooth.length > 0 ? bluetooth.map(device => ({
          device: device.device,
          name: device.name,
          manufacturer: device.manufacturer,
          macDevice: device.macDevice,
          macHost: device.macHost,
          batteryPercent: device.batteryPercent
        })) : []
      };
    } catch (error) {
      logger.error('Error getting system information:', error);
      throw new Error('Failed to retrieve system information');
    }
  }

  // Get real-time system statistics
  async getSystemStats() {
    try {
      const [currentLoad, memory, temp, processes, networkStats, diskIO] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.cpuTemperature(),
        si.processes(),
        si.networkStats(),
        si.disksIO()
      ]);

      return {
        timestamp: new Date().toISOString(),
        cpu: {
          usage: Number(currentLoad.currentload.toFixed(2)),
          user: Number(currentLoad.currentload_user.toFixed(2)),
          system: Number(currentLoad.currentload_system.toFixed(2)),
          idle: Number(currentLoad.currentload_idle.toFixed(2)),
          nice: Number(currentLoad.currentload_nice.toFixed(2)),
          irq: Number(currentLoad.currentload_irq.toFixed(2)),
          steal: Number(currentLoad.currentload_steal.toFixed(2)),
          guest: Number(currentLoad.currentload_guest.toFixed(2)),
          temperature: temp.main || null,
          cores: currentLoad.cpus.map(cpu => ({
            load: Number(cpu.load.toFixed(2)),
            loadUser: Number(cpu.load_user.toFixed(2)),
            loadSystem: Number(cpu.load_system.toFixed(2)),
            loadNice: Number(cpu.load_nice.toFixed(2)),
            loadIdle: Number(cpu.load_idle.toFixed(2)),
            loadIrq: Number(cpu.load_irq.toFixed(2))
          }))
        },
        memory: {
          total: memory.total,
          used: memory.used,
          free: memory.free,
          shared: memory.shared,
          buffers: memory.buffers,
          cached: memory.cached,
          available: memory.available,
          usage: Number(((memory.used / memory.total) * 100).toFixed(2)),
          swapTotal: memory.swaptotal,
          swapUsed: memory.swapused,
          swapFree: memory.swapfree,
          swapUsage: memory.swaptotal > 0 ? Number(((memory.swapused / memory.swaptotal) * 100).toFixed(2)) : 0
        },
        processes: {
          all: processes.all,
          running: processes.running,
          blocked: processes.blocked,
          sleeping: processes.sleeping,
          unknown: processes.unknown,
          list: processes.list.slice(0, 10).map(proc => ({
            pid: proc.pid,
            name: proc.name,
            cpu: Number(proc.cpu.toFixed(2)),
            memory: Number(proc.memory.toFixed(2)),
            priority: proc.priority,
            user: proc.user,
            state: proc.state,
            started: proc.started,
            command: proc.command
          }))
        },
        network: networkStats.map(net => ({
          iface: net.iface,
          operstate: net.operstate,
          rx_bytes: net.rx_bytes,
          rx_dropped: net.rx_dropped,
          rx_errors: net.rx_errors,
          tx_bytes: net.tx_bytes,
          tx_dropped: net.tx_dropped,
          tx_errors: net.tx_errors,
          rx_sec: net.rx_sec,
          tx_sec: net.tx_sec,
          ms: net.ms
        })),
        disk: {
          reads: diskIO.rIO,
          writes: diskIO.wIO,
          readBytes: diskIO.rIO_sec,
          writeBytes: diskIO.wIO_sec,
          readTime: diskIO.tIO,
          writeTime: diskIO.tIO_sec
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
          .sort((a, b) => b.cpu - a.cpu)
          .slice(0, limit)
          .map(proc => ({
            pid: proc.pid,
            parentPid: proc.parentPid,
            name: proc.name,
            cpu: Number(proc.cpu.toFixed(2)),
            memory: Number(proc.memory.toFixed(2)),
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
        io: {
          reads: disksIO.rIO,
          writes: disksIO.wIO,
          readBytes: disksIO.rIO_sec,
          writeBytes: disksIO.wIO_sec,
          readTime: disksIO.tIO,
          writeTime: disksIO.tIO_sec
        }
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

module.exports = new SystemService();