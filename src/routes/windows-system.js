const express = require('express');
const router = express.Router();
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { requireRole, requirePermission } = require('../middleware/authMiddleware');
const { body, param, query, validationResult } = require('express-validator');
const logger = require('../config/logger');
const config = require('../config/config');

const execAsync = promisify(exec);

// Only load this router on Windows
if (os.platform() !== 'win32') {
  module.exports = router;
  return;
}

// Windows system information
router.get('/windows/info', requirePermission('system:read'), async (req, res) => {
  try {
    // Get comprehensive Windows system information
    const [systemInfo, computerInfo, osInfo, diskInfo] = await Promise.all([
      execAsync('systeminfo /fo csv'),
      execAsync('wmic computersystem get TotalPhysicalMemory,Manufacturer,Model /format:csv'),
      execAsync('wmic os get Caption,Version,BuildNumber,InstallDate,LastBootUpTime /format:csv'),
      execAsync('wmic logicaldisk get Caption,Size,FreeSpace,FileSystem /format:csv')
    ]);

    // Parse CSV outputs
    const parseCSV = (csvText) => {
      const lines = csvText.trim().split('\n');
      if (lines.length < 2) return {};
      const headers = lines[0].split(',');
      const values = lines[1].split(',');
      const result = {};
      headers.forEach((header, index) => {
        result[header.trim()] = values[index] ? values[index].trim() : '';
      });
      return result;
    };

    const systemData = parseCSV(systemInfo.stdout);
    const computerData = parseCSV(computerInfo.stdout);
    const osData = parseCSV(osInfo.stdout);
    
    // Parse disk information
    const diskLines = diskInfo.stdout.trim().split('\n').slice(1);
    const disks = diskLines.map(line => {
      const parts = line.split(',');
      return {
        drive: parts[1] || '',
        fileSystem: parts[2] || '',
        freeSpace: parseInt(parts[3]) || 0,
        totalSize: parseInt(parts[4]) || 0
      };
    }).filter(disk => disk.drive);

    const windowsInfo = {
      system: {
        computerName: systemData['Host Name'] || os.hostname(),
        domain: systemData['Domain'] || 'WORKGROUP',
        manufacturer: computerData['Manufacturer'] || 'Unknown',
        model: computerData['Model'] || 'Unknown',
        totalMemory: parseInt(computerData['TotalPhysicalMemory']) || 0,
        processor: systemData['Processor(s)'] || 'Unknown'
      },
      operatingSystem: {
        caption: osData['Caption'] || 'Windows',
        version: osData['Version'] || '',
        buildNumber: osData['BuildNumber'] || '',
        installDate: osData['InstallDate'] || '',
        lastBootTime: osData['LastBootUpTime'] || ''
      },
      storage: disks,
      network: {
        // Will be populated by additional command
      }
    };

    // Get network information
    try {
      const networkInfo = await execAsync('wmic path win32_networkadapterconfiguration where "IPEnabled=true" get IPAddress,MACAddress,Description /format:csv');
      const networkLines = networkInfo.stdout.trim().split('\n').slice(1);
      windowsInfo.network.adapters = networkLines.map(line => {
        const parts = line.split(',');
        return {
          description: parts[1] || '',
          ipAddress: parts[2] || '',
          macAddress: parts[3] || ''
        };
      }).filter(adapter => adapter.description);
    } catch (error) {
      logger.error('Error getting network info:', error);
      windowsInfo.network.adapters = [];
    }

    res.json({
      success: true,
      data: windowsInfo
    });
  } catch (error) {
    logger.error('Error getting Windows system info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve Windows system information'
    });
  }
});

// Windows services management
router.get('/windows/services', requirePermission('system:read'), async (req, res) => {
  try {
    const { stdout } = await execAsync('sc query type= service state= all');
    const services = parseWindowsServices(stdout);
    
    res.json({
      success: true,
      data: services
    });
  } catch (error) {
    logger.error('Error getting Windows services:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve Windows services'
    });
  }
});

// Control Windows service
router.post('/windows/services/:name/:action', 
  requirePermission('system:write'),
  [
    param('name').isLength({ min: 1 }).withMessage('Service name is required'),
    param('action').isIn(['start', 'stop', 'restart', 'pause', 'continue']).withMessage('Invalid action')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { name, action } = req.params;
      let command;

      // Security check - prevent control of critical system services
      const criticalServices = [
        'Winlogon', 'CSRSS', 'Wininit', 'Services', 'Lsass', 'Smss',
        'System', 'Registry', 'Kernel', 'SecurityHealthService'
      ];
      
      if (criticalServices.some(critical => name.toLowerCase().includes(critical.toLowerCase()))) {
        return res.status(403).json({
          success: false,
          message: 'Cannot control critical system services'
        });
      }

      switch (action) {
        case 'start':
          command = `sc start "${name}"`;
          break;
        case 'stop':
          command = `sc stop "${name}"`;
          break;
        case 'restart':
          // Windows doesn't have native restart, so we stop then start
          await execAsync(`sc stop "${name}"`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          command = `sc start "${name}"`;
          break;
        case 'pause':
          command = `sc pause "${name}"`;
          break;
        case 'continue':
          command = `sc continue "${name}"`;
          break;
      }

      await execAsync(command);
      
      logger.info(`Windows service ${name} ${action} executed by user ${req.user.username}`);
      
      res.json({
        success: true,
        message: `Service ${name} ${action} completed successfully`
      });
    } catch (error) {
      logger.error('Error controlling Windows service:', error);
      res.status(500).json({
        success: false,
        message: `Failed to ${req.params.action} service: ${error.message}`
      });
    }
  }
);

// Windows Event Log viewer
router.get('/windows/eventlog/:logName', 
  requirePermission('system:read'),
  [
    param('logName').isIn(['System', 'Application', 'Security']).withMessage('Invalid log name'),
    query('entries').optional().isInt({ min: 1, max: 1000 }).withMessage('Entries must be 1-1000')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { logName } = req.params;
      const entries = req.query.entries || 100;
      
      const command = `powershell "Get-EventLog -LogName ${logName} -Newest ${entries} | ConvertTo-Json"`;
      const { stdout } = await execAsync(command);
      
      let events = [];
      try {
        events = JSON.parse(stdout);
        if (!Array.isArray(events)) {
          events = [events]; // Single event case
        }
      } catch (parseError) {
        logger.error('Error parsing event log JSON:', parseError);
        events = [];
      }

      // Format events for frontend
      const formattedEvents = events.map(event => ({
        id: event.Index,
        timestamp: event.TimeGenerated,
        level: event.EntryType,
        source: event.Source,
        eventId: event.EventID,
        message: event.Message,
        category: event.Category,
        user: event.UserName
      }));

      res.json({
        success: true,
        data: {
          logName,
          entries: formattedEvents,
          totalReturned: formattedEvents.length
        }
      });
    } catch (error) {
      logger.error('Error reading Windows Event Log:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to read Windows Event Log'
      });
    }
  }
);

// Windows processes with detailed information
router.get('/windows/processes', requirePermission('system:read'), async (req, res) => {
  try {
    const command = 'powershell "Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet,VirtualMemorySize,StartTime,Company,Description | ConvertTo-Json"';
    const { stdout } = await execAsync(command);
    
    let processes = [];
    try {
      processes = JSON.parse(stdout);
      if (!Array.isArray(processes)) {
        processes = [processes];
      }
    } catch (parseError) {
      logger.error('Error parsing processes JSON:', parseError);
      processes = [];
    }

    // Format processes for frontend
    const formattedProcesses = processes.map(proc => ({
      pid: proc.Id,
      name: proc.ProcessName,
      cpu: proc.CPU || 0,
      memory: proc.WorkingSet || 0,
      virtualMemory: proc.VirtualMemorySize || 0,
      startTime: proc.StartTime,
      company: proc.Company || 'Unknown',
      description: proc.Description || ''
    }));

    // Sort by memory usage (descending)
    formattedProcesses.sort((a, b) => b.memory - a.memory);

    res.json({
      success: true,
      data: {
        processes: formattedProcesses.slice(0, 100), // Top 100 processes
        total: formattedProcesses.length
      }
    });
  } catch (error) {
    logger.error('Error getting Windows processes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve Windows processes'
    });
  }
});

// Windows performance counters
router.get('/windows/performance', requirePermission('system:read'), async (req, res) => {
  try {
    const commands = [
      'powershell "(Get-Counter \\"\\Processor(_Total)\\% Processor Time\\").CounterSamples.CookedValue"',
      'powershell "(Get-Counter \\"\\Memory\\Available MBytes\\").CounterSamples.CookedValue"',
      'powershell "(Get-Counter \\"\\Memory\\Committed Bytes\\").CounterSamples.CookedValue"',
      'powershell "(Get-Counter \\"\\System\\Processes\\").CounterSamples.CookedValue"',
      'powershell "(Get-Counter \\"\\System\\Threads\\").CounterSamples.CookedValue"'
    ];

    const results = await Promise.all(commands.map(cmd => 
      execAsync(cmd).catch(err => ({ stdout: '0', stderr: err.message }))
    ));

    const performance = {
      timestamp: new Date().toISOString(),
      cpu: {
        usage: Math.max(0, Math.min(100, parseFloat(results[0].stdout.trim()) || 0))
      },
      memory: {
        availableMB: parseInt(results[1].stdout.trim()) || 0,
        committedMB: parseInt(results[2].stdout.trim()) / (1024 * 1024) || 0
      },
      system: {
        processes: parseInt(results[3].stdout.trim()) || 0,
        threads: parseInt(results[4].stdout.trim()) || 0
      }
    };

    // Calculate memory usage percentage
    const totalMemoryMB = os.totalmem() / (1024 * 1024);
    performance.memory.totalMB = totalMemoryMB;
    performance.memory.usedMB = totalMemoryMB - performance.memory.availableMB;
    performance.memory.usage = ((performance.memory.usedMB / totalMemoryMB) * 100).toFixed(2);

    res.json({
      success: true,
      data: performance
    });
  } catch (error) {
    logger.error('Error getting Windows performance counters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve performance data'
    });
  }
});

// Windows installed programs
router.get('/windows/programs', requirePermission('system:read'), async (req, res) => {
  try {
    const command = 'powershell "Get-WmiObject -Class Win32_Product | Select-Object Name,Version,Vendor,InstallDate | ConvertTo-Json"';
    const { stdout } = await execAsync(command);
    
    let programs = [];
    try {
      programs = JSON.parse(stdout);
      if (!Array.isArray(programs)) {
        programs = [programs];
      }
    } catch (parseError) {
      // Fallback to registry method if WMI fails
      try {
        const regCommand = 'powershell "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Select-Object DisplayName,DisplayVersion,Publisher,InstallDate | Where-Object {$_.DisplayName} | ConvertTo-Json"';
        const regResult = await execAsync(regCommand);
        programs = JSON.parse(regResult.stdout);
        if (!Array.isArray(programs)) {
          programs = [programs];
        }
        // Rename fields to match WMI output
        programs = programs.map(prog => ({
          Name: prog.DisplayName,
          Version: prog.DisplayVersion,
          Vendor: prog.Publisher,
          InstallDate: prog.InstallDate
        }));
      } catch (regError) {
        logger.error('Error parsing programs JSON and registry fallback failed:', regError);
        programs = [];
      }
    }

    const formattedPrograms = programs.map(prog => ({
      name: prog.Name || 'Unknown',
      version: prog.Version || 'Unknown',
      vendor: prog.Vendor || 'Unknown',
      installDate: prog.InstallDate || 'Unknown'
    })).filter(prog => prog.name !== 'Unknown');

    res.json({
      success: true,
      data: {
        programs: formattedPrograms,
        total: formattedPrograms.length
      }
    });
  } catch (error) {
    logger.error('Error getting Windows programs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve installed programs'
    });
  }
});

// Windows registry operations (read-only for security)
router.get('/windows/registry/:hive/:path', 
  requireRole('admin'),
  [
    param('hive').isIn(['HKLM', 'HKCU', 'HKCR', 'HKU', 'HKCC']).withMessage('Invalid registry hive'),
    param('path').isLength({ min: 1 }).withMessage('Registry path is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { hive, path } = req.params;
      const fullPath = `${hive}:\\${path}`;
      
      // Security check - prevent access to sensitive registry areas
      const blockedPaths = [
        'SAM\\', 'SECURITY\\', 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon',
        'SYSTEM\\CurrentControlSet\\Services', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
      ];
      
      if (blockedPaths.some(blocked => path.toUpperCase().includes(blocked.toUpperCase()))) {
        return res.status(403).json({
          success: false,
          message: 'Access to this registry path is restricted'
        });
      }

      const command = `powershell "Get-ItemProperty '${fullPath}' | ConvertTo-Json"`;
      const { stdout } = await execAsync(command);
      
      let registryData = {};
      try {
        registryData = JSON.parse(stdout);
      } catch (parseError) {
        registryData = { error: 'Failed to parse registry data' };
      }

      res.json({
        success: true,
        data: {
          path: fullPath,
          values: registryData
        }
      });
    } catch (error) {
      logger.error('Error reading Windows registry:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to read registry'
      });
    }
  }
);

// Windows Firewall status
router.get('/windows/firewall', requirePermission('system:read'), async (req, res) => {
  try {
    const command = 'powershell "Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction | ConvertTo-Json"';
    const { stdout } = await execAsync(command);
    
    let firewallProfiles = [];
    try {
      firewallProfiles = JSON.parse(stdout);
      if (!Array.isArray(firewallProfiles)) {
        firewallProfiles = [firewallProfiles];
      }
    } catch (parseError) {
      logger.error('Error parsing firewall JSON:', parseError);
      firewallProfiles = [];
    }

    res.json({
      success: true,
      data: {
        profiles: firewallProfiles
      }
    });
  } catch (error) {
    logger.error('Error getting Windows Firewall status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve firewall status'
    });
  }
});

// Windows Updates information
router.get('/windows/updates', requirePermission('system:read'), async (req, res) => {
  try {
    const command = 'powershell "Get-HotFix | Select-Object Description,HotFixID,InstalledBy,InstalledOn | Sort-Object InstalledOn -Descending | Select-Object -First 50 | ConvertTo-Json"';
    const { stdout } = await execAsync(command);
    
    let updates = [];
    try {
      updates = JSON.parse(stdout);
      if (!Array.isArray(updates)) {
        updates = [updates];
      }
    } catch (parseError) {
      logger.error('Error parsing updates JSON:', parseError);
      updates = [];
    }

    res.json({
      success: true,
      data: {
        updates: updates,
        total: updates.length
      }
    });
  } catch (error) {
    logger.error('Error getting Windows Updates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve Windows Updates information'
    });
  }
});

// Execute PowerShell command (admin only)
router.post('/windows/powershell', 
  requireRole('admin'),
  [
    body('command').isLength({ min: 1 }).withMessage('PowerShell command is required'),
    body('timeout').optional().isInt({ min: 1000, max: 300000 }).withMessage('Timeout must be between 1-300 seconds')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { command, timeout = 30000 } = req.body;
      
      // Security: Block dangerous PowerShell commands
      const dangerousCommands = [
        'Remove-Item', 'rm', 'del', 'rmdir', 'Format-Volume', 'Clear-Disk',
        'Remove-Computer', 'Restart-Computer', 'Stop-Computer', 'Remove-WindowsFeature',
        'Disable-WindowsOptionalFeature', 'Set-ExecutionPolicy', 'Invoke-Expression',
        'New-Object System.Net.WebClient', 'DownloadString', 'DownloadFile',
        'Invoke-WebRequest', 'curl', 'wget', 'Start-Process', 'Invoke-Command'
      ];
      
      const isDangerous = dangerousCommands.some(dangerous => 
        command.toLowerCase().includes(dangerous.toLowerCase())
      );
      
      if (isDangerous) {
        return res.status(403).json({
          success: false,
          message: 'PowerShell command contains potentially dangerous operations'
        });
      }

      const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${command.replace(/"/g, '\\"')}"`;
      const { stdout, stderr } = await execAsync(psCommand, { timeout });
      
      logger.info(`PowerShell command executed by ${req.user.username}: ${command}`);
      
      res.json({
        success: true,
        data: {
          command,
          stdout,
          stderr,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Error executing PowerShell command:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'PowerShell command execution failed'
      });
    }
  }
);

// Get Windows scheduled tasks
router.get('/windows/tasks', requirePermission('system:read'), async (req, res) => {
  try {
    const command = 'powershell "Get-ScheduledTask | Where-Object {$_.State -ne \\"Disabled\\"} | Select-Object TaskName,State,TaskPath,Description | ConvertTo-Json"';
    const { stdout } = await execAsync(command);
    
    let tasks = [];
    try {
      tasks = JSON.parse(stdout);
      if (!Array.isArray(tasks)) {
        tasks = [tasks];
      }
    } catch (parseError) {
      logger.error('Error parsing scheduled tasks JSON:', parseError);
      tasks = [];
    }

    res.json({
      success: true,
      data: {
        tasks: tasks,
        total: tasks.length
      }
    });
  } catch (error) {
    logger.error('Error getting Windows scheduled tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve scheduled tasks'
    });
  }
});

// Helper function to parse Windows services output
function parseWindowsServices(output) {
  const services = [];
  const lines = output.split('\n');
  
  let currentService = {};
  
  for (let line of lines) {
    line = line.trim();
    
    if (line.startsWith('SERVICE_NAME:')) {
      if (currentService.name) {
        services.push(currentService);
      }
      currentService = {
        name: line.split(':')[1].trim(),
        displayName: '',
        status: '',
        type: '',
        startType: ''
      };
    } else if (line.startsWith('DISPLAY_NAME:')) {
      currentService.displayName = line.split(':')[1].trim();
    } else if (line.startsWith('STATE:')) {
      const stateParts = line.split(':')[1].trim().split(' ');
      currentService.status = stateParts[1] || stateParts[0];
    } else if (line.startsWith('TYPE:')) {
      currentService.type = line.split(':')[1].trim();
    } else if (line.startsWith('START_TYPE:')) {
      currentService.startType = line.split(':')[1].trim();
    }
  }
  
  // Add the last service
  if (currentService.name) {
    services.push(currentService);
  }
  
  return services;
}

module.exports = router;