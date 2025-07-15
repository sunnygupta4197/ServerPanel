// ServerPanel Pro - Main Application JavaScript

class ServerPanelApp {
  constructor() {
    this.currentPage = 'dashboard';
    this.currentUser = null;
    this.socket = null;
    this.charts = {};
    this.theme = localStorage.getItem('theme') || 'dark';
    this.sidebarCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
    
    this.init();
  }

  // Initialize the application
  async init() {
    try {
      this.showLoading();
      
      // Apply saved theme
      this.applyTheme();
      
      // Check authentication
      const isAuthenticated = await this.checkAuth();
      
      if (!isAuthenticated) {
        this.showLogin();
      } else {
        this.showApp();
        this.initializeApp();
      }
    } catch (error) {
      console.error('Application initialization failed:', error);
      this.showError('Failed to initialize application');
    } finally {
      this.hideLoading();
    }
  }

  // Show loading screen
  showLoading() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.display = 'flex';
    }
  }

  // Hide loading screen
  hideLoading() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.classList.add('hidden');
      setTimeout(() => {
        loadingScreen.style.display = 'none';
      }, 300);
    }
  }

  // Check authentication status
  async checkAuth() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return false;

      const response = await fetch('/api/auth/verify', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.currentUser = data.user;
        return true;
      } else {
        localStorage.removeItem('token');
        return false;
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      return false;
    }
  }

  // Show login modal
  showLogin() {
    const loginModal = document.getElementById('login-modal');
    const app = document.getElementById('app');
    
    if (loginModal) loginModal.classList.add('active');
    if (app) app.style.display = 'none';
    
    this.initializeLogin();
  }

  // Show main application
  showApp() {
    const loginModal = document.getElementById('login-modal');
    const app = document.getElementById('app');
    
    if (loginModal) loginModal.classList.remove('active');
    if (app) app.style.display = 'block';
  }

  // Initialize login functionality
  initializeLogin() {
    const loginForm = document.getElementById('login-form');
    
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleLogin(e);
      });
    }
  }

  // Handle login form submission
  async handleLogin(event) {
    try {
      const formData = new FormData(event.target);
      const loginData = {
        username: formData.get('username'),
        password: formData.get('password')
      };

      // Add 2FA code if present
      const twoFactorCode = formData.get('twoFactorCode');
      if (twoFactorCode) {
        loginData.twoFactorCode = twoFactorCode;
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(loginData)
      });

      const data = await response.json();

      if (data.success) {
        if (data.requiresTwoFactor) {
          this.show2FAForm(data.tempToken);
        } else {
          localStorage.setItem('token', data.token);
          this.currentUser = data.user;
          this.showApp();
          this.initializeApp();
          this.showToast('Login successful', 'success');
        }
      } else {
        this.showToast(data.message || 'Login failed', 'error');
      }
    } catch (error) {
      console.error('Login error:', error);
      this.showToast('Login failed. Please try again.', 'error');
    }
  }

  // Show 2FA form
  show2FAForm(tempToken) {
    const twoFactorGroup = document.getElementById('two-factor-group');
    if (twoFactorGroup) {
      twoFactorGroup.style.display = 'block';
      document.getElementById('two-factor-code').focus();
    }
  }

  // Initialize main application
  async initializeApp() {
    try {
      this.initializeEventListeners();
      this.initializeSocket();
      this.initializeCharts();
      this.loadDashboard();
      this.startPeriodicUpdates();
    } catch (error) {
      console.error('App initialization error:', error);
      this.showToast('Failed to initialize application', 'error');
    }
  }

  // Initialize event listeners
  initializeEventListeners() {
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => this.toggleTheme());
    }

    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => this.toggleSidebar());
    }

    // Navigation links
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.getAttribute('data-page');
        this.navigateToPage(page);
      });
    });

    // User menu
    const userMenuBtn = document.getElementById('user-menu-btn');
    const userDropdown = document.getElementById('user-dropdown');
    
    if (userMenuBtn && userDropdown) {
      userMenuBtn.addEventListener('click', () => {
        userDropdown.classList.toggle('active');
      });
    }

    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.logout();
      });
    }

    // Dashboard refresh
    const refreshDashboard = document.getElementById('refresh-dashboard');
    if (refreshDashboard) {
      refreshDashboard.addEventListener('click', () => this.loadDashboard());
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.user-menu')) {
        const dropdown = document.getElementById('user-dropdown');
        if (dropdown) dropdown.classList.remove('active');
      }
    });

    // Apply saved sidebar state
    if (this.sidebarCollapsed) {
      document.getElementById('app').classList.add('sidebar-collapsed');
    }
  }

  // Initialize WebSocket connection
  initializeSocket() {
    try {
      const token = localStorage.getItem('token');
      this.socket = io({
        auth: { token }
      });

      this.socket.on('connect', () => {
        console.log('Connected to server');
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from server');
      });

      this.socket.on('systemStats', (data) => {
        this.updateSystemStats(data);
      });

      this.socket.on('alert', (alert) => {
        this.handleAlert(alert);
      });

      this.socket.on('notification', (notification) => {
        this.handleNotification(notification);
      });

    } catch (error) {
      console.error('Socket initialization error:', error);
    }
  }

  // Initialize charts
  initializeCharts() {
    const performanceChart = document.getElementById('performance-chart');
    const networkChart = document.getElementById('network-chart');

    if (performanceChart) {
      this.charts.performance = new Chart(performanceChart, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'CPU Usage',
            data: [],
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.4
          }, {
            label: 'Memory Usage',
            data: [],
            borderColor: 'rgb(16, 185, 129)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top'
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              max: 100
            }
          }
        }
      });
    }

    if (networkChart) {
      this.charts.network = new Chart(networkChart, {
        type: 'doughnut',
        data: {
          labels: ['Sent', 'Received'],
          datasets: [{
            data: [0, 0],
            backgroundColor: [
              'rgb(59, 130, 246)',
              'rgb(16, 185, 129)'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom'
            }
          }
        }
      });
    }
  }

  // Load dashboard data
  async loadDashboard() {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/system/stats', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.updateDashboard(data.data);
      }
    } catch (error) {
      console.error('Dashboard load error:', error);
    }
  }

  // Update dashboard with new data
  updateDashboard(data) {
    // Update CPU usage
    const cpuUsage = document.getElementById('cpu-usage');
    const cpuProgress = document.getElementById('cpu-progress');
    
    if (cpuUsage && cpuProgress) {
      cpuUsage.textContent = `${data.cpu.usage}%`;
      cpuProgress.style.width = `${data.cpu.usage}%`;
      
      // Change color based on usage
      if (data.cpu.usage > 80) {
        cpuProgress.className = 'metric-progress error';
      } else if (data.cpu.usage > 60) {
        cpuProgress.className = 'metric-progress warning';
      } else {
        cpuProgress.className = 'metric-progress';
      }
    }

    // Update memory usage
    const memoryUsage = document.getElementById('memory-usage');
    const memoryProgress = document.getElementById('memory-progress');
    
    if (memoryUsage && memoryProgress) {
      memoryUsage.textContent = `${data.memory.usage}%`;
      memoryProgress.style.width = `${data.memory.usage}%`;
      
      if (data.memory.usage > 85) {
        memoryProgress.className = 'metric-progress error';
      } else if (data.memory.usage > 70) {
        memoryProgress.className = 'metric-progress warning';
      } else {
        memoryProgress.className = 'metric-progress';
      }
    }

    // Update disk usage (if available)
    const diskUsage = document.getElementById('disk-usage');
    const diskProgress = document.getElementById('disk-progress');
    
    if (diskUsage && diskProgress && data.disk) {
      diskUsage.textContent = `${data.disk.usage}%`;
      diskProgress.style.width = `${data.disk.usage}%`;
      
      if (data.disk.usage > 90) {
        diskProgress.className = 'metric-progress error';
      } else if (data.disk.usage > 80) {
        diskProgress.className = 'metric-progress warning';
      } else {
        diskProgress.className = 'metric-progress';
      }
    }

    // Update load average
    const loadAverage = document.getElementById('load-average');
    if (loadAverage && data.loadAverage) {
      loadAverage.textContent = data.loadAverage[0].toFixed(2);
    }

    // Update system uptime
    const systemUptime = document.getElementById('system-uptime');
    if (systemUptime) {
      systemUptime.textContent = this.formatUptime(data.uptime);
    }

    // Update process count
    const processCount = document.getElementById('process-count');
    if (processCount && data.processes) {
      processCount.textContent = data.processes.all;
    }

    // Update charts
    this.updateCharts(data);
  }

  // Update system stats from socket
  updateSystemStats(data) {
    this.updateDashboard(data);
  }

  // Update charts with new data
  updateCharts(data) {
    if (this.charts.performance) {
      const chart = this.charts.performance;
      const now = new Date().toLocaleTimeString();
      
      chart.data.labels.push(now);
      chart.data.datasets[0].data.push(data.cpu.usage);
      chart.data.datasets[1].data.push(data.memory.usage);
      
      // Keep only last 10 data points
      if (chart.data.labels.length > 10) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
        chart.data.datasets[1].data.shift();
      }
      
      chart.update('none');
    }

    if (this.charts.network && data.network) {
      const chart = this.charts.network;
      const totalRx = data.network.reduce((sum, net) => sum + (net.rx_bytes || 0), 0);
      const totalTx = data.network.reduce((sum, net) => sum + (net.tx_bytes || 0), 0);
      
      chart.data.datasets[0].data = [totalTx, totalRx];
      chart.update('none');
    }
  }

  // Handle alerts
  handleAlert(alert) {
    this.showToast(alert.title, alert.severity);
    this.updateAlertsList(alert);
  }

  // Handle notifications
  handleNotification(notification) {
    this.showToast(notification.message, notification.type);
    this.updateNotificationCount();
  }

  // Update alerts list
  updateAlertsList(alert) {
    const alertsList = document.getElementById('recent-alerts');
    if (alertsList) {
      const alertItem = document.createElement('div');
      alertItem.className = `alert-item ${alert.severity}`;
      alertItem.innerHTML = `
        <i class="fas fa-${this.getAlertIcon(alert.severity)}"></i>
        <span>${alert.title}</span>
        <time>just now</time>
      `;
      
      alertsList.insertBefore(alertItem, alertsList.firstChild);
      
      // Keep only last 5 alerts
      while (alertsList.children.length > 5) {
        alertsList.removeChild(alertsList.lastChild);
      }
    }
  }

  // Get alert icon based on severity
  getAlertIcon(severity) {
    switch (severity) {
      case 'critical':
      case 'error':
        return 'exclamation-circle';
      case 'warning':
        return 