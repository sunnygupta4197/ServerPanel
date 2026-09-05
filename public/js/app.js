// ServerPanel Pro - Main Application JavaScript

// Maps each Settings tab's form fields to their /api/settings keys.
const SETTINGS_FIELD_MAP = {
  general: {
    'system.name': { el: 'settings-server-name', parse: (v) => v },
    'system.timezone': { el: 'settings-timezone', parse: (v) => v },
    'monitoring.check_interval': { el: 'settings-stats-refresh', parse: Number },
    'security.session_timeout': { el: 'settings-session-timeout', parse: Number },
    'logging.retention_days': { el: 'settings-log-retention', parse: Number }
  },
  notifications: {
    'monitoring.cpu_threshold': { el: 'settings-cpu-threshold', parse: Number },
    'monitoring.memory_threshold': { el: 'settings-memory-threshold', parse: Number },
    'monitoring.disk_threshold': { el: 'settings-disk-threshold', parse: Number }
  }
};

class ServerPanelApp {
  constructor() {
    this.currentPage = 'dashboard';
    this.currentUser = null;
    this.socket = null;
    this.charts = {};
    this.lastStats = null;
    this.pending2FATempToken = null;
    this.activityPanel = null;

    // Appearance preferences (persisted to localStorage)
    this.theme   = localStorage.getItem('sp_theme')   || 'dark';
    this.accent  = localStorage.getItem('sp_accent')  || '#5b6ef8';
    this.density = localStorage.getItem('sp_density') || 'default';

    this.init();
  }

  // Initialize the application
  async init() {
    try {
      this.showLoading();

      // Restore theme/accent/density from localStorage immediately
      this.restoreAppearance();
      
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
      loadingScreen.style.display = 'none';
    }
  }

  // Check authentication
  async checkAuth() {
    try {
      const response = await fetch('/api/auth/verify');

      if (response.ok) {
        const data = await response.json();
        this.currentUser = data.user;
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  // ── Appearance system ──────────────────────────────────────
  // theme: 'dark' | 'light'
  // accent: hex string
  // density: 'compact' | 'default' | 'comfortable'

  applyTheme(theme) {
    if (theme) this.theme = theme;
    document.body.classList.toggle('theme-light', this.theme === 'light');
    localStorage.setItem('sp_theme', this.theme);

    const icon = document.getElementById('theme-icon');
    if (icon) {
      icon.className = this.theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
    }

    // If settings page is open, refresh active state
    this._refreshAppearanceUI();
  }

  toggleTheme() {
    this.applyTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  applyAccent(hex) {
    if (!hex) return;
    this.accent = hex;
    localStorage.setItem('sp_accent', hex);

    // Parse hex → r,g,b for the dim variant
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    const root = document.documentElement;
    root.style.setProperty('--primary', hex);
    root.style.setProperty('--primary-dim', `rgba(${r},${g},${b},0.12)`);
    root.style.setProperty('--border-focus', `rgba(${r},${g},${b},0.45)`);

    this._refreshAppearanceUI();
  }

  applyDensity(d) {
    if (d) this.density = d;
    localStorage.setItem('sp_density', this.density);
    const html = document.documentElement;
    html.classList.remove('density-compact', 'density-comfortable');
    if (this.density !== 'default') html.classList.add(`density-${this.density}`);
    this._refreshAppearanceUI();
  }

  // Called on app load — restores all saved appearance settings
  restoreAppearance() {
    this.applyTheme();
    this.applyAccent(this.accent);
    this.applyDensity();
  }

  // Update active state of appearance widgets if the settings page is visible
  _refreshAppearanceUI() {
    // Mode cards
    document.querySelectorAll('.mode-card').forEach(el => {
      el.classList.toggle('active', el.dataset.mode === this.theme);
    });
    // Accent swatches
    document.querySelectorAll('.accent-swatch').forEach(el => {
      el.classList.toggle('active', el.dataset.hex === this.accent);
    });
    // Density cards
    document.querySelectorAll('.density-card').forEach(el => {
      el.classList.toggle('active', el.dataset.density === this.density);
    });
  }


  // Show error message
  showError(message) {
    console.error(message);
    alert(message);
  }

  // Show login modal
  showLogin() {
    const loginModal = document.getElementById('login-modal');
    const app = document.getElementById('app');
    
    if (loginModal) loginModal.classList.add('active');
    if (app) app.style.display = 'none';
    
    this.initializeLogin();
  }

  // Show toast notification
  showToast(message, type = 'info') {
    const icons = { success: 'fa-check-circle', warning: 'fa-exclamation-triangle', error: 'fa-times-circle', info: 'fa-info-circle' };
    const icon = icons[type] || icons.info;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <i class="fas ${icon} toast-icon"></i>
      <div class="toast-content"><p class="toast-message"></p></div>
      <button class="toast-close" onclick="this.closest('.toast').remove()"><i class="fas fa-times"></i></button>
    `;
    toast.querySelector('.toast-message').textContent = message;

    const container = document.getElementById('toast-container') || document.body;
    container.appendChild(toast);

    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 4000);
  }

  // Handle login form submission
  async handleLogin(event) {
    const formData = new FormData(event.target);
    const credentials = {
      username: formData.get('username'),
      password: formData.get('password')
    };

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(credentials)
      });

      const data = await response.json();

      if (response.ok) {
        if (data.requiresTwoFactor) {
          this.show2FAForm(data.tempToken);
        } else {
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
    this.pending2FATempToken = tempToken;

    const loginModal = document.getElementById('login-modal');
    if (!loginModal) return;

    loginModal.querySelector('.modal-content').innerHTML = `
      <h2 style="color: var(--text-primary); margin-bottom: 0.5rem;">Two-Factor Authentication</h2>
      <p style="color: var(--text-secondary); margin-bottom: 2rem;">Enter the 6-digit code from your authenticator app.</p>
      <form id="twofa-form">
        <div class="form-group">
          <label for="totp-code" style="color: var(--text-secondary); display: block; margin-bottom: 0.5rem;">Authentication Code</label>
          <input type="text" id="totp-code" name="code" maxlength="6" autocomplete="one-time-code"
            inputmode="numeric" placeholder="000000" required
            style="width: 100%; padding: 0.75rem 1rem; background: var(--dark-light); border: 1px solid var(--border);
                   border-radius: var(--border-radius-sm); color: var(--text-primary); font-size: 1.5rem;
                   letter-spacing: 0.5rem; text-align: center; box-sizing: border-box;">
        </div>
        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1.5rem;">Verify</button>
        <p id="twofa-error" style="color: var(--danger); text-align: center; margin-top: 1rem;"></p>
      </form>
    `;

    document.getElementById('twofa-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('totp-code').value.trim();
      const errorEl = document.getElementById('twofa-error');
      errorEl.textContent = '';

      try {
        const response = await fetch('/api/auth/verify-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tempToken: this.pending2FATempToken, code })
        });
        const data = await response.json();

        if (response.ok) {
          this.currentUser = data.user;
          this.pending2FATempToken = null;
          this.showApp();
          this.initializeApp();
          this.showToast('Login successful', 'success');
        } else {
          errorEl.textContent = data.message || 'Invalid code. Please try again.';
        }
      } catch {
        errorEl.textContent = 'Network error. Please try again.';
      }
    });
  }

  // Show main application
  showApp() {
    const loginModal = document.getElementById('login-modal');
    const app = document.getElementById('app');

    if (loginModal) loginModal.classList.remove('active');
    if (app) app.style.display = 'grid';

    // Populate user identity elements
    if (this.currentUser) {
      const avatar = document.getElementById('user-avatar');
      const nameEl = document.getElementById('user-display-name');
      const initials = (this.currentUser.username || 'A').slice(0, 2).toUpperCase();
      if (avatar) avatar.textContent = initials;
      if (nameEl) nameEl.textContent = this.currentUser.username || 'admin';
    }
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

  // Initialize the full application
  async initializeApp() {
    try {
      this.activityPanel = null;
      this.initializeEventListeners();
      this.initializeActivityPanel();
      this.initializeSocket();
      this.initializeCharts();
      const lastPage = localStorage.getItem('sp_page') || 'dashboard';
      this.navigateToPage(lastPage);
      this.startPeriodicUpdates();
    } catch (error) {
      console.error('App initialization error:', error);
      this.showToast('Failed to initialize application', 'error');
    }
  }

  // Initialize event listeners
  initializeEventListeners() {
    console.log('Event listeners initialized');
    
    // Navigation links
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.getAttribute('data-page');
        if (page) {
          this.navigateToPage(page);
        }
      });
    });

    // User menu toggle
    const userMenuBtn = document.getElementById('user-menu-btn');
    const userDropdown = document.getElementById('user-dropdown');
    
    if (userMenuBtn && userDropdown) {
      userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userDropdown.classList.toggle('active');
      });
      
      // Close dropdown when clicking outside
      document.addEventListener('click', () => {
        userDropdown.classList.remove('active');
      });
    }

    // Logout functionality
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.logout();
      });
    }

    // Theme toggle
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => this.toggleTheme());
    }

    // Stats cards click handlers
    this.initializeStatsCardHandlers();
  }

  // Toggle theme
  toggleTheme() {
    this.applyTheme(this.theme === 'dark' ? 'light' : 'dark');
  }


  // Navigate to page
  navigateToPage(page) {
    // Unsubscribe the room we're leaving
    if (this.socket) {
      const leaveMap = { services: 'unsubscribe_services' };
      const leaveEvent = leaveMap[this.currentPage];
      if (leaveEvent) this.socket.emit(leaveEvent);
    }

    // Clean up stats updates when leaving dashboard
    if (this.currentPage === 'dashboard' && page !== 'dashboard' && this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    
    // Update current page
    this.currentPage = page;
    localStorage.setItem('sp_page', page);
    
    // Update navigation active state
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('data-page') === page) {
        link.classList.add('active');
      }
    });
    
    // Update page title in header with optional LIVE badge
    const headerTitle = document.getElementById('page-title');
    if (headerTitle) {
      const livePages = new Set(['services', 'monitoring', 'backups', 'ssl']);
      if (livePages.has(page)) {
        headerTitle.innerHTML = `${this.getPageTitle(page)} <span class="live-badge">LIVE</span>`;
      } else {
        headerTitle.textContent = this.getPageTitle(page);
      }
    }

    // Hide all pages
    document.querySelectorAll('.page-content').forEach(pageEl => {
      pageEl.style.display = 'none';
    });

    // Show current page
    const currentPageElement = document.getElementById(`${page}-page`);
    if (currentPageElement) {
      currentPageElement.style.display = 'block';
    } else {
      // If page doesn't exist, create it
      this.createPage(page);
    }

    // Subscribe to the room for this page
    this._subscribeCurrentPage();

    // Load page-specific data
    this.loadPageData(page);
  }
  
  // Get page title
  getPageTitle(page) {
    const titles = {
      dashboard: 'Dashboard',
      monitoring: 'System Monitoring',
      services: 'Services Management',
      files: 'File Manager',
      database: 'Database Management',
      users: 'User Management',
      settings: 'Settings',
      domains: 'Domain Management',
      ssl: 'SSL / TLS Certificates',
      email: 'Email Management',
      backups: 'Backup & Restore'
    };
    return titles[page] || 'Unknown Page';
  }
  
  // Create page content dynamically
  createPage(page) {
    const mainContent = document.querySelector('.main-content');
    const pageContent = document.createElement('div');
    pageContent.id = `${page}-page`;
    pageContent.className = 'page-content';
    pageContent.style.display = 'block';
    pageContent.innerHTML = this.getPageContent(page);
    mainContent.appendChild(pageContent);
  }
  
  // Get page content HTML
  getPageContent(page) {
    switch(page) {
      case 'monitoring':
        return this.getMonitoringPageContent();
      case 'services':
        return this.getServicesPageContent();
      case 'files':
        return this.getFilesPageContent();
      case 'database':
        return this.getDatabasePageContent();
      case 'users':
        return this.getUsersPageContent();
      case 'settings':
        return this.getSettingsPageContent();
      case 'domains':
        return this.getDomainsPageContent();
      case 'ssl':
        return this.getSSLPageContent();
      case 'email':
        return this.getEmailPageContent();
      case 'backups':
        return this.getBackupsPageContent();
      default:
        return `
          <div class="card" style="margin-top: 2rem;">
            <h2 style="color: var(--text-primary); margin-bottom: 1rem;">
              <i class="fas fa-construction" style="color: var(--warning);"></i>
              Page Under Construction
            </h2>
            <p style="color: var(--text-secondary);">
              The ${this.getPageTitle(page)} is being developed. Please check back soon!
            </p>
          </div>
        `;
    }
  }
  
  // Load page-specific data
  loadPageData(page) {
    switch(page) {
      case 'dashboard':
        this.loadDashboard();
        break;
      case 'monitoring':
        this.loadMonitoringData();
        break;
      case 'services':
        this.loadServicesData();
        break;
      case 'files':
        this.loadFilesData();
        break;
      case 'database':
        this.loadDatabaseData();
        break;
      case 'users':
        this.loadUsersData();
        break;
      case 'settings':
        this.loadSettingsData();
        break;
      case 'domains':
        this.loadDomainsData();
        break;
      case 'ssl':
        this.loadSSLData();
        break;
      case 'email':
        this.loadEmailData();
        break;
      case 'backups':
        this.loadBackupsData();
        break;
    }
  }

  // Logout
  async logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Continue even if server request fails
    }
    this.currentUser = null;
    this.showLogin();
  }

  // Initialize socket connection
  initializeSocket() {
    if (typeof io !== 'undefined') {
      this.socket = io(window.location.origin, {
        withCredentials: true
      });

      // Single connect handler — fires on initial connect and every reconnect
      this.socket.on('connect', () => {
        this._setHeaderConnected(true);
        this.socket.emit('subscribe_monitoring', {});
        this.socket.emit('subscribe_jobs', {});
        this._subscribeCurrentPage();
      });

      this.socket.on('disconnect', () => {
        this._setHeaderConnected(false);
        this.showToast('Connection lost — reconnecting…', 'warning');
      });

      this.socket.on('connect_error', () => {
        this._setHeaderConnected(false);
      });

      this.socket.on('reconnect', () => {
        this._setHeaderConnected(true);
        this.showToast('Connection restored!', 'success');
      });

      this.socket.on('systemStats', (data) => {
        this.updateSystemStats(data);
      });

      this.socket.on('monitoring_data', (response) => {
        if (response.type === 'initial' || response.type === 'update') {
          this.updateSystemStats(response.data);
        } else if (response.type === 'error') {
          console.error('Monitoring error:', response.message);
          this.showToast('Failed to get system data', 'error');
        }
      });

      // page:refresh — emitted by server when a job finishes or service poll fires
      this.socket.on('page:refresh', ({ page }) => {
        if (this.currentPage === page) {
          this.loadPageData(page);
        }
      });

      // --- Job event handlers ---
      this.socket.on('jobs:snapshot', (jobs) => {
        if (this.activityPanel) this.activityPanel.loadSnapshot(jobs);
      });

      this.socket.on('job:queued', (job) => {
        if (this.activityPanel) this.activityPanel.upsertJob(job);
      });

      this.socket.on('job:update', (job) => {
        if (this.activityPanel) this.activityPanel.upsertJob(job);
        if (job.status === 'completed') {
          this.showToast(`Completed: ${job.label}`, 'success');
        } else if (job.status === 'failed') {
          this.showToast(`Failed: ${job.label}`, 'error');
        }
      });

      // Backend emits these (monitoringService's alert pipeline, and the
      // service-control broadcast helpers) but nothing was listening —
      // alerts/notifications only ever showed up if you happened to check
      // the Alerts list manually, never live.
      this.socket.on('system_alert', (payload) => this.handleAlert(payload.alert || payload));
      this.socket.on('alert', (alert) => this.handleAlert(alert));
      this.socket.on('notification', (notification) => this.handleNotification(notification));

      this.socket.on('service_status_change', ({ service, status }) => {
        this.showToast(`Service ${service}: ${status}`, 'info');
        if (this.currentPage === 'services') this.loadServicesData();
      });
    }
  }

  // Subscribe the current page to its real-time room
  _subscribeCurrentPage() {
    if (!this.socket) return;
    const roomMap = {
      services: 'subscribe_services',
      monitoring: 'subscribe_monitoring',
    };
    const event = roomMap[this.currentPage];
    if (event) this.socket.emit(event, {});
  }

  // Update the header connection dot and label
  _setHeaderConnected(connected) {
    const dot = document.getElementById('conn-dot');
    const label = document.getElementById('conn-label');
    if (dot) dot.className = `header-status-dot ${connected ? 'online' : 'offline'}`;
    if (label) label.textContent = connected ? 'live' : 'offline';
  }

  // -------------------------------------------------------
  // Activity Panel — background job tracker
  // -------------------------------------------------------
  initializeActivityPanel() {
    const panel = document.getElementById('activity-panel');
    const overlay = document.getElementById('activity-overlay');
    const toggleBtn = document.getElementById('activity-toggle');
    const closeBtn = document.getElementById('activity-close');
    const clearBtn = document.getElementById('activity-clear-done');
    const badge = document.getElementById('activity-badge');
    const list = document.getElementById('activity-list');

    if (!panel) return;

    // jobs map: id -> { job, cardEl }
    const jobCards = new Map();

    const open = () => {
      panel.classList.add('open');
      overlay.classList.add('open');
    };

    const close = () => {
      panel.classList.remove('open');
      overlay.classList.remove('open');
    };

    toggleBtn && toggleBtn.addEventListener('click', () => {
      panel.classList.contains('open') ? close() : open();
    });
    closeBtn && closeBtn.addEventListener('click', close);
    overlay && overlay.addEventListener('click', close);

    clearBtn && clearBtn.addEventListener('click', () => {
      for (const [id, { job, cardEl }] of jobCards) {
        if (['completed', 'failed', 'canceled'].includes(job.status)) {
          cardEl.remove();
          jobCards.delete(id);
        }
      }
      this.activityPanel._syncEmpty();
    });

    const statusIcon = (status) => {
      switch (status) {
        case 'queued':   return '<i class="fas fa-clock"></i>';
        case 'running':  return '<i class="fas fa-spinner fa-spin"></i>';
        case 'completed':return '<i class="fas fa-check"></i>';
        case 'failed':   return '<i class="fas fa-times"></i>';
        default:         return '<i class="fas fa-circle"></i>';
      }
    };

    const elapsed = (job) => {
      const start = job.startedAt || job.createdAt;
      const end = job.completedAt || new Date().toISOString();
      const ms = new Date(end) - new Date(start);
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    };

    const renderCard = (job, cardEl) => {
      const progress = job.progress || (job.status === 'completed' ? 100 : 0);
      const fillClass = job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed' : '';

      cardEl.className = `job-card status-${job.status}`;
      cardEl.innerHTML = `
        <div class="job-card-header">
          <div>
            <div class="job-label"></div>
            <div class="job-type"></div>
          </div>
          <span class="job-status-badge ${job.status}">${statusIcon(job.status)} <span></span></span>
        </div>
        <div class="job-progress-bar">
          <div class="job-progress-fill ${fillClass}" style="width: ${progress}%"></div>
        </div>
        <div class="job-meta">
          <span class="job-elapsed"></span>
          <span>${progress}%</span>
        </div>
        ${job.error ? '<div class="job-error"></div>' : ''}
      `;
      cardEl.querySelector('.job-label').textContent = job.label;
      cardEl.querySelector('.job-type').textContent = job.type.replace(/_/g, ' ');
      cardEl.querySelector('.job-status-badge span').textContent = job.status;
      cardEl.querySelector('.job-elapsed').textContent = elapsed(job);
      if (job.error) {
        cardEl.querySelector('.job-error').textContent = job.error;
      }
    };

    const syncEmpty = () => {
      const emptyEl = list.querySelector('.activity-empty');
      if (jobCards.size === 0) {
        if (!emptyEl) {
          list.innerHTML = '<div class="activity-empty"><i class="fas fa-check-circle"></i><p>No background jobs</p></div>';
        }
      } else {
        if (emptyEl) emptyEl.remove();
      }
    };

    const updateBadge = () => {
      const active = Array.from(jobCards.values())
        .filter(({ job }) => ['queued', 'running'].includes(job.status)).length;
      if (active > 0) {
        badge.textContent = active;
        badge.style.display = 'block';
      } else {
        badge.style.display = 'none';
      }
    };

    this.activityPanel = {
      loadSnapshot(jobs) {
        jobCards.clear();
        list.innerHTML = '';
        jobs.slice().reverse().forEach(job => this.upsertJob(job));
      },
      upsertJob(job) {
        let entry = jobCards.get(job.id);
        if (!entry) {
          const cardEl = document.createElement('div');
          cardEl.className = `job-card status-${job.status}`;
          list.insertBefore(cardEl, list.firstChild);
          entry = { job, cardEl };
          jobCards.set(job.id, entry);
        }
        entry.job = job;
        renderCard(job, entry.cardEl);
        syncEmpty();
        updateBadge();
        // Auto-open panel when a new job appears
        if (job.status === 'queued') open();
      },
      _syncEmpty: syncEmpty
    };
  }

  // Initialize charts
  initializeCharts() {
    console.log('Initializing charts...');
    if (typeof Charts !== 'undefined') {
      Charts.init();
    } else {
      console.error('Charts module not loaded');
    }
  }

  // Load dashboard
  async loadDashboard() {
    console.log('Loading dashboard...');
    
    // Show loading state
    this.showDashboardLoading();
    
    // Load real system information
    try {
      const [infoResponse, statsResponse] = await Promise.all([
        fetch('/api/system/info', {
          headers: {
          }
        }),
        fetch('/api/system/stats', {
          headers: {
          }
        })
      ]);

      if (infoResponse.ok && statsResponse.ok) {
        const [infoData, statsData] = await Promise.all([
          infoResponse.json(),
          statsResponse.json()
        ]);

        console.log('📊 System info loaded:', infoData);
        console.log('📊 System stats loaded:', statsData);

        // Populate os-info from server data
        const osEl = document.getElementById('os-info');
        if (osEl && infoData.data?.os) {
          osEl.textContent = `${infoData.data.os.platform || ''} ${infoData.data.os.release || ''}`.trim() || this.getOSInfo();
        } else if (osEl) {
          osEl.textContent = this.getOSInfo();
        }
        // Populate hostname
        const hostEl = document.getElementById('uptime-host');
        if (hostEl && infoData.data?.system?.hostname) {
          hostEl.textContent = infoData.data.system.hostname;
        }

        // Combine data for display
        const disk0 = infoData.data?.storage?.[0];
        const combinedData = {
          cpu: {
            usage: parseFloat(statsData.data.cpu.usage),
            cores: infoData.data?.cpu?.cores
          },
          memory: {
            usage: parseFloat(statsData.data.memory.usage),
            total: statsData.data.memory.total,
            used: statsData.data.memory.used,
            free: statsData.data.memory.free
          },
          disk: {
            usage: disk0 ? ((disk0.used / disk0.size) * 100).toFixed(2) : 0,
            total: disk0?.size || 0,
            used: disk0?.used || 0
          },
          uptime: infoData.data?.system?.uptime
        };

        this.updateSystemStats(combinedData);
        this.startPeriodicStatsUpdate();
      } else {
        throw new Error('Failed to load system data');
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      this.showToast('Failed to load system data', 'error');
      this.showDashboardError('Unable to connect to system monitoring service');
    }
  }

  // Start periodic updates
  startPeriodicUpdates() {
    console.log('Starting periodic updates...');
  }

  // Show dashboard loading state
  showDashboardLoading() {
    const ids = ['cpu-usage','memory-usage','disk-usage','uptime'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '--'; });
    ['cpu-progress','memory-progress','disk-progress'].forEach(id => {
      const el = document.getElementById(id); if (el) el.style.width = '0%';
    });
  }

  // Show dashboard error state
  showDashboardError(message) {
    ['cpu-usage','memory-usage','disk-usage','uptime'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '!';
    });
    const lu = document.getElementById('last-update');
    if (lu) lu.textContent = 'error';
    this.updateConnectionStatus(false);
  }

  // Show services loading state
  showServicesLoading() {
    const servicesGrid = document.getElementById('services-grid');
    if (servicesGrid) {
      servicesGrid.innerHTML = `
        <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
          <div class="loading" style="margin: 0 auto 1rem;"></div>
          <p>Loading services...</p>
        </div>
      `;
    }
  }
  
  // Show services error state
  showServicesError(message) {
    const servicesGrid = document.getElementById('services-grid');
    if (servicesGrid) {
      servicesGrid.innerHTML = `
        <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
          <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: var(--danger); margin-bottom: 1rem;"></i>
          <p>${message}</p>
          <button class="btn btn-primary" onclick="app.loadServicesData()" style="margin-top: 1rem;">
            <i class="fas fa-refresh"></i> Retry
          </button>
        </div>
      `;
    }
    this.showToast(message, 'error');
  }

  showFilesLoading() {
    const tbody = document.querySelector('.file-list tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted);"><i class="fas fa-spinner fa-spin" style="margin-right:0.5rem;"></i>Loading…</td></tr>`;
  }

  showFilesError(message) {
    const tbody = document.querySelector('.file-list tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--danger);"><i class="fas fa-exclamation-triangle" style="margin-right:0.5rem;"></i>${message} <button class="btn btn-sm" style="margin-left:0.5rem;" onclick="app.loadFilesData()">Retry</button></td></tr>`;
    this.showToast(message, 'error');
  }

  // Show users loading state
  showUsersLoading() {
    const usersGrid = document.getElementById('users-grid');
    if (usersGrid) {
      usersGrid.innerHTML = `
        <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
          <div class="loading" style="margin: 0 auto 1rem;"></div>
          <p>Loading users...</p>
        </div>
      `;
    }
  }
  
  // Show users error state
  showUsersError(message) {
    const usersGrid = document.getElementById('users-grid');
    if (usersGrid) {
      usersGrid.innerHTML = `
        <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
          <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: var(--danger); margin-bottom: 1rem;"></i>
          <p>${message}</p>
          <button class="btn btn-primary" onclick="app.loadUsersData()" style="margin-top: 1rem;">
            <i class="fas fa-refresh"></i> Retry
          </button>
        </div>
      `;
    }
    this.showToast(message, 'error');
  }

  // Initialize stats card click handlers
  initializeStatsCardHandlers() {
    const cpuCard = document.getElementById('cpu-card');
    const memoryCard = document.getElementById('memory-card');  
    const diskCard = document.getElementById('disk-card');
    const uptimeCard = document.getElementById('uptime-card');

    if (cpuCard) {
      cpuCard.addEventListener('click', () => this.onCpuCardClick());
    }
    
    if (memoryCard) {
      memoryCard.addEventListener('click', () => this.onMemoryCardClick());
    }
    
    if (diskCard) {
      diskCard.addEventListener('click', () => this.onDiskCardClick());
    }
    
    if (uptimeCard) {
      uptimeCard.addEventListener('click', () => this.onUptimeCardClick());
    }
  }

  // Initialize monitoring page stats card handlers
  initializeMonitoringStatsCardHandlers() {
    [
      ['monitor-cpu-card',     () => this.onMonitorCpuCardClick()],
      ['monitor-memory-card',  () => this.onMonitorMemoryCardClick()],
      ['monitor-network-card', () => this.onMonitorNetworkCardClick()],
      ['monitor-disk-card',    () => this.onMonitorDiskCardClick()],
    ].forEach(([id, handler]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const fresh = el.cloneNode(true);
      el.replaceWith(fresh);
      fresh.addEventListener('click', handler);
    });
  }

  // Stats card click handlers
  onCpuCardClick() {
    console.log('CPU card clicked - navigating to monitoring');
    this.showToast('Viewing detailed CPU monitoring...', 'info');
    this.navigateToPage('monitoring');
  }

  onMemoryCardClick() {
    console.log('Memory card clicked - expanding memory details');
    this.toggleMemoryCardExpansion();
  }

  onDiskCardClick() {
    console.log('Disk card clicked - navigating to file manager');
    this.showToast('Opening file manager for disk management...', 'info');
    this.navigateToPage('files');
  }

  onUptimeCardClick() {
    console.log('Uptime card clicked - expanding system details');
    this.toggleUptimeCardExpansion();
  }

  // Monitoring page stats card click handlers
  onMonitorCpuCardClick() {
    console.log('Monitor CPU card clicked - expanding CPU details');
    this.expandMonitoringCard('cpu');
  }

  onMonitorMemoryCardClick() {
    console.log('Monitor Memory card clicked - expanding memory details');
    this.expandMonitoringCard('memory');
  }

  onMonitorNetworkCardClick() {
    console.log('Monitor Network card clicked - expanding network details');
    this.expandMonitoringCard('network');
  }

  onMonitorDiskCardClick() {
    console.log('Monitor Disk card clicked - expanding disk details');
    this.expandMonitoringCard('disk');
  }

  // Toggle memory card expansion (better UX than modal)
  toggleMemoryCardExpansion() {
    const memoryCard = document.getElementById('memory-card');
    if (!memoryCard) return;

    const existingDetails = memoryCard.querySelector('.card-expansion');
    if (existingDetails) {
      // Collapse
      existingDetails.style.maxHeight = '0px';
      existingDetails.style.opacity = '0';
      setTimeout(() => existingDetails.remove(), 300);
      return;
    }

    // Expand with memory details
    if (!this.lastStats?.memory) {
      this.showToast('Memory data not available yet', 'warning');
      return;
    }

    const memory = this.lastStats.memory;
    const usedMB = Math.round(memory.used / (1024 * 1024));
    const freeMB = Math.round(memory.free / (1024 * 1024));
    const totalMB = Math.round(memory.total / (1024 * 1024));

    const expansionHtml = `
      <div class="card-expansion" style="
        max-height: 0;
        opacity: 0;
        overflow: hidden;
        transition: all 0.3s ease;
        margin-top: 1rem;
        padding: 0 1rem;
        border-top: 1px solid var(--border);
      ">
        <div style="padding: 1rem 0;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
            <div style="text-align: center; padding: 0.75rem; background: rgba(245, 158, 11, 0.1); border-radius: var(--border-radius-sm);">
              <div style="color: var(--warning); font-weight: 600; font-size: 1.1rem;">${usedMB} MB</div>
              <div style="color: var(--text-secondary); font-size: 0.875rem;">Used</div>
            </div>
            <div style="text-align: center; padding: 0.75rem; background: rgba(16, 185, 129, 0.1); border-radius: var(--border-radius-sm);">
              <div style="color: var(--success); font-weight: 600; font-size: 1.1rem;">${freeMB} MB</div>
              <div style="color: var(--text-secondary); font-size: 0.875rem;">Free</div>
            </div>
          </div>
          <div style="text-align: center;">
            <button class="btn btn-primary" onclick="app.navigateToPage('monitoring')" style="font-size: 0.875rem; padding: 0.5rem 1rem;">
              <i class="fas fa-chart-line"></i> View Details
            </button>
          </div>
        </div>
      </div>
    `;

    memoryCard.insertAdjacentHTML('beforeend', expansionHtml);
    
    // Animate expansion
    setTimeout(() => {
      const expansion = memoryCard.querySelector('.card-expansion');
      if (expansion) {
        expansion.style.maxHeight = '200px';
        expansion.style.opacity = '1';
      }
    }, 10);
  }

  // Toggle uptime card expansion
  toggleUptimeCardExpansion() {
    const uptimeCard = document.getElementById('uptime-card');
    if (!uptimeCard) return;

    const existingDetails = uptimeCard.querySelector('.card-expansion');
    if (existingDetails) {
      // Collapse
      existingDetails.style.maxHeight = '0px';
      existingDetails.style.opacity = '0';
      setTimeout(() => existingDetails.remove(), 300);
      return;
    }

    // Expand with system details
    const expansionHtml = `
      <div class="card-expansion" style="
        max-height: 0;
        opacity: 0;
        overflow: hidden;
        transition: all 0.3s ease;
        margin-top: 1rem;
        padding: 0 1rem;
        border-top: 1px solid var(--border);
      ">
        <div style="padding: 1rem 0;">
          <div style="display: grid; gap: 0.75rem; margin-bottom: 1rem;">
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-secondary);">CPU Cores:</span>
              <span style="color: var(--primary); font-weight: 600;">${this.lastStats?.cpu?.cores || '--'}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-secondary);">Total Memory:</span>
              <span style="color: var(--success); font-weight: 600;">${document.getElementById('total-memory')?.textContent || '--'}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-secondary);">OS:</span>
              <span style="color: var(--text-primary); font-weight: 600;">${document.getElementById('os-info')?.textContent || 'Loading...'}</span>
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-primary" onclick="app.navigateToPage('monitoring')" style="flex: 1; font-size: 0.875rem; padding: 0.5rem;">
              <i class="fas fa-chart-line"></i> Monitoring
            </button>
            <button class="btn btn-primary" onclick="app.navigateToPage('services')" style="flex: 1; font-size: 0.875rem; padding: 0.5rem;">
              <i class="fas fa-cogs"></i> Services
            </button>
          </div>
        </div>
      </div>
    `;

    uptimeCard.insertAdjacentHTML('beforeend', expansionHtml);
    
    // Animate expansion
    setTimeout(() => {
      const expansion = uptimeCard.querySelector('.card-expansion');
      if (expansion) {
        expansion.style.maxHeight = '200px';
        expansion.style.opacity = '1';
      }
    }, 10);
  }

  // Expand monitoring card details inline
  expandMonitoringCard(type) {
    this.showToast(`${type.toUpperCase()} details will show inline here - better than modal!`, 'info');
    // TODO: Implement inline card expansion for monitoring page
  }

  // Show memory details modal
  showMemoryDetailsModal() {
    if (!this.lastStats?.memory) {
      this.showToast('Memory data not available', 'warning');
      return;
    }

    const memory = this.lastStats.memory;
    const usedMB = Math.round(memory.used / (1024 * 1024));
    const freeMB = Math.round(memory.free / (1024 * 1024));
    const totalMB = Math.round(memory.total / (1024 * 1024));

    const modalHtml = `
      <div class="modal active" id="memory-modal">
        <div class="modal-content">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem;">
            <h3 style="color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
              <div class="stat-icon memory" style="width: 32px; height: 32px; font-size: 1rem;">
                <i class="fas fa-memory"></i>
              </div>
              Memory Details
            </h3>
            <button id="close-memory-modal" style="background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; cursor: pointer;">&times;</button>
          </div>
          
          <div style="display: grid; gap: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--dark-light); border-radius: var(--border-radius-sm);">
              <span style="color: var(--text-secondary);">Usage</span>
              <span style="color: var(--text-primary); font-weight: 600;">${memory.usage}%</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--dark-light); border-radius: var(--border-radius-sm);">
              <span style="color: var(--text-secondary);">Used Memory</span>
              <span style="color: var(--warning); font-weight: 600;">${usedMB} MB</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--dark-light); border-radius: var(--border-radius-sm);">
              <span style="color: var(--text-secondary);">Free Memory</span>
              <span style="color: var(--success); font-weight: 600;">${freeMB} MB</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--dark-light); border-radius: var(--border-radius-sm);">
              <span style="color: var(--text-secondary);">Total Memory</span>
              <span style="color: var(--text-primary); font-weight: 600;">${totalMB} MB</span>
            </div>

            <div style="margin-top: 1rem;">
              <div class="progress-bar" style="height: 12px;">
                <div class="progress-fill memory" style="width: ${memory.usage}%"></div>
              </div>
              <div style="display: flex; justify-content: space-between; margin-top: 0.5rem; font-size: 0.875rem; color: var(--text-secondary);">
                <span>0%</span>
                <span>${memory.usage}% Used</span>
                <span>100%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this.setupModalCloseHandlers('memory-modal');
  }

  // Show system info modal
  showSystemInfoModal() {
    const modalHtml = `
      <div class="modal active" id="system-modal">
        <div class="modal-content">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem;">
            <h3 style="color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
              <div class="stat-icon network" style="width: 32px; height: 32px; font-size: 1rem;">
                <i class="fas fa-server"></i>
              </div>
              System Information
            </h3>
            <button id="close-system-modal" style="background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; cursor: pointer;">&times;</button>
          </div>
          
          <div style="display: grid; gap: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--dark-light); border-radius: var(--border-radius-sm);">
              <span style="color: var(--text-secondary);">Operating System</span>
              <span style="color: var(--text-primary); font-weight: 600;" id="modal-os-info">${document.getElementById('os-info')?.textContent || 'Loading...'}</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--dark-light); border-radius: var(--border-radius-sm);">
              <span style="color: var(--text-secondary);">CPU Cores</span>
              <span style="color: var(--primary); font-weight: 600;">${this.lastStats?.cpu?.cores || '--'}</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--dark-light); border-radius: var(--border-radius-sm);">
              <span style="color: var(--text-secondary);">Total Memory</span>
              <span style="color: var(--success); font-weight: 600;">${document.getElementById('total-memory')?.textContent || '--'}</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--dark-light); border-radius: var(--border-radius-sm);">
              <span style="color: var(--text-secondary);">System Uptime</span>
              <span style="color: var(--warning); font-weight: 600;">${document.getElementById('uptime')?.textContent || '--'}</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--dark-light); border-radius: var(--border-radius-sm);">
              <span style="color: var(--text-secondary);">Last Updated</span>
              <span style="color: var(--text-secondary); font-size: 0.875rem;">${document.getElementById('last-update')?.textContent || '--'}</span>
            </div>

            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button class="btn btn-primary" id="goto-monitoring" style="flex: 1;">
                <i class="fas fa-chart-line"></i> View Monitoring
              </button>
              <button class="btn btn-primary" id="goto-services" style="flex: 1;">
                <i class="fas fa-cogs"></i> Manage Services
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this.setupModalCloseHandlers('system-modal');
  }

  // Close modal helper
  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => {
        modal.remove();
      }, 300); // Allow for fade out animation
    }
  }

  // Show CPU processes modal
  async showCpuProcessesModal() {
    // Create modal with loading state first
    const modalHtml = `
      <div class="modal active" id="cpu-processes-modal">
        <div class="modal-content" style="max-width: 900px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem;">
            <h3 style="color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
              <div class="stat-icon cpu" style="width: 32px; height: 32px; font-size: 1rem;">
                <i class="fas fa-microchip"></i>
              </div>
              Top CPU Processes
            </h3>
            <button id="close-cpu-processes-modal" style="background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; cursor: pointer;">&times;</button>
          </div>
          
          <div style="margin-bottom: 1rem; padding: 1rem; background: var(--dark-light); border-radius: var(--border-radius-sm);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--text-secondary);">Current CPU Usage:</span>
              <span style="color: var(--primary); font-weight: 600; font-size: 1.2rem;">${this.lastStats?.cpu?.usage || 0}%</span>
            </div>
          </div>

          <div id="processes-content" style="min-height: 300px;">
            <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
              <div class="loading" style="margin: 0 auto 1rem;"></div>
              <p>Loading process data...</p>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this.setupModalCloseHandlers('cpu-processes-modal');

    // Load real process data
    try {
      const response = await fetch('/api/system/processes', {
        headers: {
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.updateProcessesDisplay(data.data.processes);
      } else {
        throw new Error('Failed to load processes');
      }
    } catch (error) {
      console.error('Error loading processes:', error);
      document.getElementById('processes-content').innerHTML = `
        <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
          <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: var(--danger); margin-bottom: 1rem;"></i>
          <p>Failed to load process data</p>
          <button class="btn btn-primary" onclick="app.showCpuProcessesModal(); app.closeModal('cpu-processes-modal');" style="margin-top: 1rem;">
            <i class="fas fa-refresh"></i> Retry
          </button>
        </div>
      `;
    }
  }

  // Update processes display in modal
  updateProcessesDisplay(processes) {
    const processesContent = document.getElementById('processes-content');
    if (!processesContent || !processes || !processes.length) {
      processesContent.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
          <i class="fas fa-info-circle" style="color: var(--info); margin-right: 0.5rem;"></i>
          No process data available
        </div>
      `;
      return;
    }

    // Sort processes by CPU usage (highest first)
    const sortedProcesses = processes.sort((a, b) => parseFloat(b.cpu || 0) - parseFloat(a.cpu || 0));
    const topProcesses = sortedProcesses.slice(0, 15); // Show top 15 processes

    const processesHtml = `
      <div style="overflow-x: auto;">
        <table class="table" style="margin: 0;">
          <thead>
            <tr>
              <th style="padding: 0.75rem; font-size: 0.75rem;">PID</th>
              <th style="padding: 0.75rem; font-size: 0.75rem;">Process Name</th>
              <th style="padding: 0.75rem; font-size: 0.75rem;">CPU %</th>
              <th style="padding: 0.75rem; font-size: 0.75rem;">Memory</th>
              <th style="padding: 0.75rem; font-size: 0.75rem;">User</th>
              <th style="padding: 0.75rem; font-size: 0.75rem;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${topProcesses.map(process => `
              <tr>
                <td style="padding: 0.75rem; font-family: monospace; font-size: 0.875rem;">${process.pid}</td>
                <td style="padding: 0.75rem; font-size: 0.875rem;">
                  <div style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${process.name}">
                    ${process.name || 'Unknown'}
                  </div>
                </td>
                <td style="padding: 0.75rem; font-weight: 600; font-size: 0.875rem;">
                  <span style="color: ${this.getCpuUsageColor(process.cpu)};">
                    ${parseFloat(process.cpu || 0).toFixed(1)}%
                  </span>
                </td>
                <td style="padding: 0.75rem; font-size: 0.875rem;">
                  ${this.formatBytes(process.memory || 0)}
                </td>
                <td style="padding: 0.75rem; font-size: 0.875rem;">${process.user || 'N/A'}</td>
                <td style="padding: 0.75rem; font-size: 0.875rem;">
                  <span class="status ${process.state === 'running' ? 'online' : process.state === 'sleeping' ? 'warning' : 'offline'}" style="padding: 0.25rem 0.5rem; font-size: 0.6rem;">
                    ${process.state || 'unknown'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      <div style="margin-top: 1rem; padding: 1rem; background: rgba(99, 102, 241, 0.1); border-radius: var(--border-radius-sm); text-align: center;">
        <small style="color: var(--text-secondary);">
          <i class="fas fa-info-circle" style="margin-right: 0.5rem;"></i>
          Showing top 15 processes by CPU usage • Updates in real-time
        </small>
      </div>
    `;

    processesContent.innerHTML = processesHtml;
  }

  // Get color based on CPU usage
  getCpuUsageColor(cpu) {
    const usage = parseFloat(cpu || 0);
    if (usage > 80) return 'var(--danger)';
    if (usage > 50) return 'var(--warning)';
    if (usage > 20) return 'var(--primary)';
    return 'var(--success)';
  }

  // Show memory processes modal
  async showMemoryProcessesModal() {
    const modalHtml = `
      <div class="modal active" id="memory-processes-modal">
        <div class="modal-content" style="max-width: 900px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem;">
            <h3 style="color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
              <div class="stat-icon memory" style="width: 32px; height: 32px; font-size: 1rem;">
                <i class="fas fa-memory"></i>
              </div>
              Top Memory Processes
            </h3>
            <button id="close-memory-processes-modal" style="background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; cursor: pointer;">&times;</button>
          </div>
          
          <div style="margin-bottom: 1rem; padding: 1rem; background: var(--dark-light); border-radius: var(--border-radius-sm);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--text-secondary);">Current Memory Usage:</span>
              <span style="color: var(--warning); font-weight: 600; font-size: 1.2rem;">${this.lastStats?.memory?.usage || 0}%</span>
            </div>
          </div>

          <div id="memory-processes-content" style="min-height: 300px;">
            <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
              <div class="loading" style="margin: 0 auto 1rem;"></div>
              <p>Loading memory usage data...</p>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this.setupModalCloseHandlers('memory-processes-modal');

    // Load real process data
    try {
      const response = await fetch('/api/system/processes', {
        headers: {
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.updateMemoryProcessesDisplay(data.data.processes);
      } else {
        throw new Error('Failed to load processes');
      }
    } catch (error) {
      console.error('Error loading memory processes:', error);
      document.getElementById('memory-processes-content').innerHTML = `
        <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
          <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: var(--danger); margin-bottom: 1rem;"></i>
          <p>Failed to load memory data</p>
          <button class="btn btn-primary" onclick="app.showMemoryProcessesModal(); app.closeModal('memory-processes-modal');" style="margin-top: 1rem;">
            <i class="fas fa-refresh"></i> Retry
          </button>
        </div>
      `;
    }
  }

  // Update memory processes display in modal
  updateMemoryProcessesDisplay(processes) {
    const content = document.getElementById('memory-processes-content');
    if (!content || !processes || !processes.length) {
      content.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
          <i class="fas fa-info-circle" style="color: var(--info); margin-right: 0.5rem;"></i>
          No memory data available
        </div>
      `;
      return;
    }

    // Sort processes by memory usage (highest first)
    const sortedProcesses = processes.sort((a, b) => parseFloat(b.memory || 0) - parseFloat(a.memory || 0));
    const topProcesses = sortedProcesses.slice(0, 15); // Show top 15 processes

    const processesHtml = `
      <div style="overflow-x: auto;">
        <table class="table" style="margin: 0;">
          <thead>
            <tr>
              <th style="padding: 0.75rem; font-size: 0.75rem;">PID</th>
              <th style="padding: 0.75rem; font-size: 0.75rem;">Process Name</th>
              <th style="padding: 0.75rem; font-size: 0.75rem;">Memory Usage</th>
              <th style="padding: 0.75rem; font-size: 0.75rem;">CPU %</th>
              <th style="padding: 0.75rem; font-size: 0.75rem;">User</th>
              <th style="padding: 0.75rem; font-size: 0.75rem;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${topProcesses.map(process => `
              <tr>
                <td style="padding: 0.75rem; font-family: monospace; font-size: 0.875rem;">${process.pid}</td>
                <td style="padding: 0.75rem; font-size: 0.875rem;">
                  <div style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${process.name}">
                    ${process.name || 'Unknown'}
                  </div>
                </td>
                <td style="padding: 0.75rem; font-weight: 600; font-size: 0.875rem;">
                  <span style="color: ${this.getMemoryUsageColor(process.memory)};">
                    ${this.formatBytes(process.memory || 0)}
                  </span>
                </td>
                <td style="padding: 0.75rem; font-size: 0.875rem;">
                  ${parseFloat(process.cpu || 0).toFixed(1)}%
                </td>
                <td style="padding: 0.75rem; font-size: 0.875rem;">${process.user || 'N/A'}</td>
                <td style="padding: 0.75rem; font-size: 0.875rem;">
                  <span class="status ${process.state === 'running' ? 'online' : process.state === 'sleeping' ? 'warning' : 'offline'}" style="padding: 0.25rem 0.5rem; font-size: 0.6rem;">
                    ${process.state || 'unknown'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      <div style="margin-top: 1rem; padding: 1rem; background: rgba(245, 158, 11, 0.1); border-radius: var(--border-radius-sm); text-align: center;">
        <small style="color: var(--text-secondary);">
          <i class="fas fa-info-circle" style="margin-right: 0.5rem;"></i>
          Showing top 15 processes by memory usage • Updates in real-time
        </small>
      </div>
    `;

    content.innerHTML = processesHtml;
  }

  // Get color based on memory usage
  getMemoryUsageColor(memory) {
    const memoryMB = parseFloat(memory || 0) / (1024 * 1024); // Convert to MB
    if (memoryMB > 1000) return 'var(--danger)';   // > 1GB
    if (memoryMB > 500) return 'var(--warning)';   // > 500MB
    if (memoryMB > 100) return 'var(--primary)';   // > 100MB
    return 'var(--success)';
  }

  // Show network connections modal
  async showNetworkConnectionsModal() {
    const modalHtml = `
      <div class="modal active" id="network-connections-modal">
        <div class="modal-content" style="max-width: 900px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem;">
            <h3 style="color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
              <div class="stat-icon network" style="width: 32px; height: 32px; font-size: 1rem;">
                <i class="fas fa-network-wired"></i>
              </div>
              Network Interfaces
            </h3>
            <button id="close-network-connections-modal" style="background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; cursor: pointer;">&times;</button>
          </div>

          <div id="network-content" style="min-height: 300px;">
            <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
              <div class="loading" style="margin: 0 auto 1rem;"></div>
              <p>Loading network information...</p>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this.setupModalCloseHandlers('network-connections-modal');

    // Load real network data
    try {
      const response = await fetch('/api/system/info', {
        headers: {
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.updateNetworkDisplay(data.data.network);
      } else {
        throw new Error('Failed to load network data');
      }
    } catch (error) {
      console.error('Error loading network data:', error);
      document.getElementById('network-content').innerHTML = `
        <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
          <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: var(--danger); margin-bottom: 1rem;"></i>
          <p>Failed to load network data</p>
          <button class="btn btn-primary" onclick="app.showNetworkConnectionsModal(); app.closeModal('network-connections-modal');" style="margin-top: 1rem;">
            <i class="fas fa-refresh"></i> Retry
          </button>
        </div>
      `;
    }
  }

  // Update network display in modal
  updateNetworkDisplay(networkInterfaces) {
    const content = document.getElementById('network-content');
    if (!content || !networkInterfaces || !networkInterfaces.length) {
      content.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
          <i class="fas fa-info-circle" style="color: var(--info); margin-right: 0.5rem;"></i>
          No network interfaces found
        </div>
      `;
      return;
    }

    // Filter out loopback and internal interfaces, prioritize active ones
    const activeInterfaces = networkInterfaces.filter(iface => 
      iface.name && 
      !iface.name.startsWith('lo') && 
      iface.ip4 && 
      iface.ip4 !== '127.0.0.1'
    );

    const interfacesHtml = `
      <div style="display: grid; gap: 1.5rem;">
        ${activeInterfaces.map(iface => `
          <div style="padding: 1.5rem; background: var(--dark-light); border: 1px solid var(--border); border-radius: var(--border-radius-sm);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
              <h4 style="color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas fa-ethernet" style="color: var(--primary);"></i>
                ${iface.name}
              </h4>
              <span class="status ${iface.operstate === 'up' ? 'online' : 'offline'}" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;">
                ${iface.operstate || 'unknown'}
              </span>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
              <div>
                <div style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.25rem;">IPv4 Address</div>
                <div style="color: var(--text-primary); font-weight: 600; font-family: monospace;">${iface.ip4 || 'N/A'}</div>
              </div>
              
              <div>
                <div style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.25rem;">MAC Address</div>
                <div style="color: var(--text-primary); font-weight: 600; font-family: monospace;">${iface.mac || 'N/A'}</div>
              </div>
              
              <div>
                <div style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.25rem;">Speed</div>
                <div style="color: var(--primary); font-weight: 600;">
                  ${iface.speed ? `${iface.speed} Mbps` : 'Unknown'}
                </div>
              </div>
              
              <div>
                <div style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.25rem;">Type</div>
                <div style="color: var(--text-primary); font-weight: 600;">${iface.type || 'Ethernet'}</div>
              </div>
            </div>

            ${iface.ip6 ? `
              <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border);">
                <div style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.25rem;">IPv6 Address</div>
                <div style="color: var(--text-primary); font-weight: 600; font-family: monospace; font-size: 0.875rem;">${iface.ip6}</div>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
      
      <div style="margin-top: 1.5rem; padding: 1rem; background: rgba(239, 68, 68, 0.1); border-radius: var(--border-radius-sm); text-align: center;">
        <small style="color: var(--text-secondary);">
          <i class="fas fa-info-circle" style="margin-right: 0.5rem;"></i>
          Showing active network interfaces • Connection monitoring feature coming soon
        </small>
      </div>
    `;

    content.innerHTML = interfacesHtml;
  }

  // Show disk processes modal
  async showDiskProcessesModal() {
    const modalHtml = `
      <div class="modal active" id="disk-processes-modal">
        <div class="modal-content" style="max-width: 900px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem;">
            <h3 style="color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
              <div class="stat-icon disk" style="width: 32px; height: 32px; font-size: 1rem;">
                <i class="fas fa-hdd"></i>
              </div>
              Disk Usage Details
            </h3>
            <button id="close-disk-processes-modal" style="background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; cursor: pointer;">&times;</button>
          </div>

          <div id="disk-content" style="min-height: 300px;">
            <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
              <div class="loading" style="margin: 0 auto 1rem;"></div>
              <p>Loading disk information...</p>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this.setupModalCloseHandlers('disk-processes-modal');

    // Load real disk data
    try {
      const response = await fetch('/api/system/info', {
        headers: {
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.updateDiskDisplay(data.data.storage);
      } else {
        throw new Error('Failed to load disk data');
      }
    } catch (error) {
      console.error('Error loading disk data:', error);
      document.getElementById('disk-content').innerHTML = `
        <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
          <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: var(--danger); margin-bottom: 1rem;"></i>
          <p>Failed to load disk data</p>
          <button class="btn btn-primary" onclick="app.showDiskProcessesModal(); app.closeModal('disk-processes-modal');" style="margin-top: 1rem;">
            <i class="fas fa-refresh"></i> Retry
          </button>
        </div>
      `;
    }
  }

  // Update disk display in modal
  updateDiskDisplay(storageDevices) {
    const content = document.getElementById('disk-content');
    if (!content || !storageDevices || !storageDevices.length) {
      content.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
          <i class="fas fa-info-circle" style="color: var(--info); margin-right: 0.5rem;"></i>
          No disk information available
        </div>
      `;
      return;
    }

    const disksHtml = `
      <div style="display: grid; gap: 1.5rem;">
        ${storageDevices.map(disk => {
          const usagePercent = disk.size > 0 ? ((disk.used / disk.size) * 100).toFixed(1) : 0;
          const freeSpace = disk.size - disk.used;
          
          return `
            <div style="padding: 1.5rem; background: var(--dark-light); border: 1px solid var(--border); border-radius: var(--border-radius-sm);">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
                <h4 style="color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
                  <i class="fas fa-hdd" style="color: var(--success);"></i>
                  ${disk.fs || disk.mount || 'Unknown Drive'}
                </h4>
                <span style="color: ${this.getDiskUsageColor(usagePercent)}; font-weight: 600; font-size: 1.1rem;">
                  ${usagePercent}% Used
                </span>
              </div>
              
              <div style="margin-bottom: 1rem;">
                <div class="progress-bar" style="height: 12px; margin-bottom: 0.5rem;">
                  <div class="progress-fill disk" style="width: ${usagePercent}%; background: ${this.getDiskUsageColor(usagePercent)};"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.875rem; color: var(--text-secondary);">
                  <span>0%</span>
                  <span>${usagePercent}% of ${this.formatBytes(disk.size)}</span>
                  <span>100%</span>
                </div>
              </div>
              
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                <div>
                  <div style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.25rem;">Mount Point</div>
                  <div style="color: var(--text-primary); font-weight: 600; font-family: monospace;">${disk.mount || 'N/A'}</div>
                </div>
                
                <div>
                  <div style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.25rem;">File System</div>
                  <div style="color: var(--text-primary); font-weight: 600;">${disk.type || 'Unknown'}</div>
                </div>
                
                <div>
                  <div style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.25rem;">Used Space</div>
                  <div style="color: var(--warning); font-weight: 600;">${this.formatBytes(disk.used)}</div>
                </div>
                
                <div>
                  <div style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.25rem;">Free Space</div>
                  <div style="color: var(--success); font-weight: 600;">${this.formatBytes(freeSpace)}</div>
                </div>
                
                <div>
                  <div style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.25rem;">Total Size</div>
                  <div style="color: var(--primary); font-weight: 600;">${this.formatBytes(disk.size)}</div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      
      <div style="margin-top: 1.5rem; padding: 1rem; background: rgba(16, 185, 129, 0.1); border-radius: var(--border-radius-sm); text-align: center;">
        <small style="color: var(--text-secondary);">
          <i class="fas fa-info-circle" style="margin-right: 0.5rem;"></i>
          Real-time disk usage information • Process I/O monitoring feature coming soon
        </small>
      </div>
    `;

    content.innerHTML = disksHtml;
  }

  // Get color based on disk usage percentage
  getDiskUsageColor(percent) {
    const usage = parseFloat(percent || 0);
    if (usage > 90) return 'var(--danger)';
    if (usage > 75) return 'var(--warning)';
    if (usage > 50) return 'var(--primary)';
    return 'var(--success)';
  }

  // Close modal when clicking outside
  setupModalCloseHandlers(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      // Close when clicking outside modal content
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeModal(modalId);
        }
      });

      // Close with Escape key
      const escapeHandler = (e) => {
        if (e.key === 'Escape') {
          this.closeModal(modalId);
          document.removeEventListener('keydown', escapeHandler);
        }
      };
      document.addEventListener('keydown', escapeHandler);

      // Add close button event listeners (try multiple possible ID patterns)
      const possibleCloseButtonIds = [
        `close-${modalId}`,
        modalId.replace('-modal', '-modal').replace('modal', 'close-modal'),
        `close-${modalId.replace('-modal', '')}-modal`
      ];
      
      for (const buttonId of possibleCloseButtonIds) {
        const closeButton = document.getElementById(buttonId);
        if (closeButton) {
          closeButton.addEventListener('click', () => this.closeModal(modalId));
          break; // Found and attached listener, exit loop
        }
      }

      // Special handlers for system modal navigation buttons
      if (modalId === 'system-modal') {
        const gotoMonitoring = document.getElementById('goto-monitoring');
        const gotoServices = document.getElementById('goto-services');
        
        if (gotoMonitoring) {
          gotoMonitoring.addEventListener('click', () => {
            this.navigateToPage('monitoring');
            this.closeModal('system-modal');
          });
        }
        
        if (gotoServices) {
          gotoServices.addEventListener('click', () => {
            this.navigateToPage('services');
            this.closeModal('system-modal');
          });
        }
      }
    }
  }

  // Start periodic stats updates for real-time dashboard
  startPeriodicStatsUpdate() {
    console.log('Starting periodic stats updates...');
    
    // Clear any existing interval
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    
    // Update stats every 5 seconds
    this.statsInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/system/stats', {
          headers: {
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          
          const statsData = {
            cpu: {
              usage: parseFloat(data.data.cpu.usage),
              cores: this.lastStats?.cpu?.cores || 4 // Use cached core count
            },
            memory: {
              usage: parseFloat(data.data.memory.usage),
              total: data.data.memory.total,
              used: data.data.memory.used,
              free: data.data.memory.free
            },
            disk: {
              usage: this.lastStats?.disk?.usage || 0, // Keep previous disk usage
              total: this.lastStats?.disk?.total || 0
            },
            uptime: this.lastStats?.uptime || 0 // Keep uptime from initial load
          };
          
          this.updateSystemStats(statsData);
          // Reset connection error flag on successful update
          this.connectionErrorShown = false;
        }
      } catch (error) {
        console.error('Error updating stats:', error);
        // Only show connection error once to avoid spam
        if (!this.connectionErrorShown) {
          this.updateConnectionStatus(false);
          this.connectionErrorShown = true;
        }
      }
    }, 5000);
  }

  // Update system stats
  updateSystemStats(data) {
    if (!data) return;
    this.lastStats = data;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null) el.textContent = val;
    };

    // CPU
    if (data.cpu) {
      const cpuPct = Math.round(data.cpu.usage) || 0;
      set('cpu-usage', `${cpuPct}%`);
      const cpuBar = document.getElementById('cpu-progress');
      if (cpuBar) cpuBar.style.width = `${cpuPct}%`;
      const cores = data.cpu.cores || data.cpu.physicalCores || '--';
      set('cpu-cores', `${cores} cores`);
      set('cpu-cores-info', cores);
      if (data.cpu.temperature) set('cpu-temp', `${data.cpu.temperature}°C`);
    }

    // Memory
    if (data.memory) {
      const memPct = Math.round(data.memory.usage) || 0;
      set('memory-usage', `${memPct}%`);
      const memBar = document.getElementById('memory-progress');
      if (memBar) memBar.style.width = `${memPct}%`;
      if (data.memory.used) set('memory-used', this.formatBytes(data.memory.used));
      if (data.memory.total) {
        const fmt = this.formatBytes(data.memory.total);
        set('memory-total-sub', fmt);
        set('total-memory', fmt);
      }
    }

    // Disk
    if (data.disk) {
      const diskPct = Math.round(data.disk.usage) || 0;
      set('disk-usage', `${diskPct}%`);
      const diskBar = document.getElementById('disk-progress');
      if (diskBar) diskBar.style.width = `${diskPct}%`;
      if (data.disk.used) set('disk-used', this.formatBytes(data.disk.used));
      if (data.disk.total) {
        const fmt = this.formatBytes(data.disk.total);
        set('disk-total-sub', fmt);
        set('total-disk', fmt);
      }
    }

    // Uptime
    if (data.uptime) {
      set('uptime', this.formatUptime(data.uptime));
    }

    // Timestamp
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    set('last-update', now);
    set('chart-ts', `updated ${now}`);

    // OS info (server-side is more accurate, fallback to browser)
    const osEl = document.getElementById('os-info');
    if (osEl && osEl.textContent === '—') osEl.textContent = this.getOSInfo();

    this.updateConnectionStatus(true);

    if (typeof Charts !== 'undefined') {
      if (Charts.updateSystemPerformanceChart) Charts.updateSystemPerformanceChart(data);
      if (Charts.updateAdvancedChart)          Charts.updateAdvancedChart(data);
    }

    // Keep monitoring page stat cards live if visible
    if (this.currentPage === 'monitoring') {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('monitor-cpu',        (data.cpu?.usage    ?? '—') + (data.cpu?.usage    != null ? '%' : ''));
      set('monitor-memory',     (data.memory?.usage ?? '—') + (data.memory?.usage != null ? '%' : ''));
      set('monitor-disk-pct',   (data.disk?.usage   ?? '—') + (data.disk?.usage   != null ? '%' : ''));
      set('monitor-disk-used',  data.disk?.used  ? this.formatBytes(data.disk.used)  : '');
      set('monitor-disk-total', data.disk?.total ? '/ ' + this.formatBytes(data.disk.total) : '');
    }
  }

  // Handle alert (from monitoringService's threshold-check pipeline).
  // severity is one of low/medium/high/critical (system_alerts.severity).
  handleAlert(alert) {
    if (!alert) return;
    const toastType = ['critical', 'high'].includes(alert.severity) ? 'error'
      : alert.severity === 'medium' ? 'warning'
      : 'info';
    this.showToast(alert.title || alert.description || 'System alert', toastType);
  }

  // Handle notification (currently unreachable — nothing on the backend
  // emits a 'notification' event yet; wired up so it's ready the moment
  // something does, same as the socket listener above)
  handleNotification(notification) {
    if (!notification) return;
    this.showToast(notification.message || notification.title || 'New notification', 'info');
  }

  // Format uptime
  formatUptime(uptime) {
    if (!uptime || uptime === 0) return '0d 0h 0m';
    
    const seconds = Math.floor(uptime);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    return `${days}d ${hours}h ${minutes}m`;
  }

  // Format bytes to human readable
  formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // Get OS info
  getOSInfo() {
    const platform = navigator.platform;
    if (platform.indexOf('Win') !== -1) return 'Windows';
    if (platform.indexOf('Mac') !== -1) return 'macOS';
    if (platform.indexOf('Linux') !== -1) return 'Linux';
    return platform;
  }

  // Update connection status (chart badge + header dot)
  updateConnectionStatus(connected) {
    const badge = document.getElementById('connection-status');
    if (badge) {
      badge.style.display = connected ? '' : 'none';
      badge.className = connected ? 'badge badge-success' : 'badge badge-danger';
      badge.innerHTML = connected
        ? '<i class="fas fa-wifi" style="margin-right:0.2rem;"></i>Live'
        : '<i class="fas fa-wifi-slash" style="margin-right:0.2rem;"></i>Offline';
    }
    this._setHeaderConnected(connected);
  }

  // Update dashboard
  updateDashboard(data) {
    console.log('Dashboard update:', data);
  }

  // Update charts
  updateCharts(data) {
    console.log('Charts update:', data);
  }

  // Update alerts list
  updateAlertsList(alert) {
    console.log('Alert added to list:', alert);
  }

  // Update notification count
  updateNotificationCount() {
    console.log('Notification count updated');
  }

  // Get alert icon based on severity (matches system_alerts.severity:
  // low/medium/high/critical)
  getAlertIcon(severity) {
    switch (severity) {
      case 'critical':
      case 'error':
        return 'exclamation-circle';
      case 'high':
      case 'warning':
        return 'exclamation-triangle';
      case 'medium':
        return 'exclamation';
      case 'info':
      case 'low':
        return 'info-circle';
      default:
        return 'question-circle';
    }
  }

  // === PAGE CONTENT METHODS ===

  getMonitoringPageContent() {
    return `
      <div style="margin-top: 2rem;">
        <div class="stats-grid">
          <div class="stat-card" id="monitor-cpu-card" title="Click to expand CPU process details">
            <div class="stat-header">
              <div class="stat-icon cpu">
                <i class="fas fa-chart-line"></i>
              </div>
              <div class="status online">Live</div>
            </div>
            <div class="stat-value" id="monitor-cpu">--</div>
            <div class="stat-label">Real-time CPU</div>
          </div>
          
          <div class="stat-card" id="monitor-memory-card" title="Click to expand memory usage details">
            <div class="stat-header">
              <div class="stat-icon memory">
                <i class="fas fa-memory"></i>
              </div>
              <div class="status online">Live</div>
            </div>
            <div class="stat-value" id="monitor-memory">--</div>
            <div class="stat-label">Memory Usage</div>
          </div>
          
          <div class="stat-card" id="monitor-network-card">
            <div class="stat-header">
              <div class="stat-icon network"><i class="fas fa-network-wired"></i></div>
              <div class="status online">Live</div>
            </div>
            <div class="stat-value mono" id="monitor-network">—</div>
            <div class="stat-label">Network I/O</div>
            <div class="stat-sub"><span id="monitor-net-rx" style="color:var(--text-muted)"></span><span id="monitor-net-tx" style="color:var(--text-muted)"></span></div>
          </div>

          <div class="stat-card" id="monitor-disk-card">
            <div class="stat-header">
              <div class="stat-icon disk"><i class="fas fa-hdd"></i></div>
              <div class="status online">Live</div>
            </div>
            <div class="stat-value mono" id="monitor-disk-pct">—</div>
            <div class="stat-label">Disk Usage</div>
            <div class="stat-sub"><span id="monitor-disk-used" style="color:var(--text-muted)"></span><span id="monitor-disk-total" style="color:var(--text-muted)"></span></div>
          </div>
        </div>

        <div class="chart-container">
          <div class="chart-header">
            <h3 class="chart-title">Advanced System Monitoring</h3>
            <div style="display: flex; gap: 1rem;">
              <button class="btn" onclick="app.exportMonitoringData()">
                <i class="fas fa-download"></i>
                Export Data
              </button>
              <button class="btn" onclick="app.configureAlerts()">
                <i class="fas fa-cog"></i>
                Configure Alerts
              </button>
            </div>
          </div>
          <div style="position:relative;height:280px;">
            <canvas id="advanced-performance-chart"></canvas>
          </div>
        </div>

        <div class="card" style="margin-top: 2rem;">
          <h3 style="color: var(--text-primary); margin-bottom: 1.5rem;">
            <i class="fas fa-list"></i>
            Active Processes
            <button class="btn btn-icon" id="refresh-processes" title="Refresh Processes" style="float: right; margin-top: -0.25rem;">
              <i class="fas fa-sync-alt"></i>
            </button>
          </h3>
          <div id="processes-container">
            <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
              <div class="loading" style="margin: 0 auto 1rem;"></div>
              <p>Loading active processes...</p>
            </div>
          </div>
        </div>

        <div id="configure-alerts-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
          <div class="card" style="width:460px;max-width:95vw;">
            <h3 style="color:var(--text-primary);margin-bottom:1.25rem;">Configure Alerts</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
              <div>
                <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">CPU Threshold (%)</label>
                <input id="alert-cpu-threshold" type="number" min="0" max="100" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
              </div>
              <div>
                <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Memory Threshold (%)</label>
                <input id="alert-memory-threshold" type="number" min="0" max="100" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
              </div>
              <div>
                <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Disk Threshold (%)</label>
                <input id="alert-disk-threshold" type="number" min="0" max="100" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
              </div>
              <div>
                <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Load Threshold</label>
                <input id="alert-load-threshold" type="number" min="0" step="0.1" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
              </div>
            </div>
            <div class="form-group" style="margin-bottom:1.5rem;display:flex;align-items:center;gap:0.6rem;">
              <input id="alert-alerts-enabled" type="checkbox" style="width:auto;">
              <label style="color:var(--text-secondary);margin:0;">Alerts enabled</label>
            </div>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
              <button class="btn" onclick="app.hideModal('configure-alerts-modal')">Cancel</button>
              <button class="btn btn-primary" onclick="app.saveAlertConfig()"><i class="fas fa-check"></i> Save</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  getServicesPageContent() {
    return `
      <div class="page-header">
        <h2><i class="fas fa-cogs" style="color:var(--primary);margin-right:0.5rem;font-size:0.9rem;"></i>Services</h2>
        <div class="page-actions">
          <button class="btn" onclick="app.refreshServices()"><i class="fas fa-sync-alt"></i> Refresh</button>
        </div>
      </div>

      <div class="stats-grid" style="margin-bottom:0.75rem;">
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon cpu"><i class="fas fa-server"></i></div></div>
          <div class="stat-value mono" id="svc-stat-total">—</div>
          <div class="stat-label">Total</div>
          <div class="progress-bar"><div class="progress-fill cpu" id="svc-bar-total" style="width:100%"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon" style="background:rgba(34,200,126,0.15);color:var(--success);"><i class="fas fa-check-circle"></i></div></div>
          <div class="stat-value mono" id="svc-stat-running" style="color:var(--success);">—</div>
          <div class="stat-label">Running</div>
          <div class="progress-bar"><div class="progress-fill" id="svc-bar-running" style="width:0%;background:var(--success);"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon" style="background:rgba(107,114,128,0.15);color:var(--text-muted);"><i class="fas fa-stop-circle"></i></div></div>
          <div class="stat-value mono" id="svc-stat-stopped" style="color:var(--text-muted);">—</div>
          <div class="stat-label">Stopped</div>
          <div class="progress-bar"><div class="progress-fill" id="svc-bar-stopped" style="width:0%;background:var(--text-muted);"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon" style="background:rgba(240,64,64,0.15);color:var(--danger);"><i class="fas fa-exclamation-circle"></i></div></div>
          <div class="stat-value mono" id="svc-stat-errors" style="color:var(--text-muted);">—</div>
          <div class="stat-label">Errors</div>
          <div class="progress-bar"><div class="progress-fill" id="svc-bar-errors" style="width:0%;background:var(--danger);"></div></div>
        </div>
      </div>

      <div class="card" style="padding:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;border-bottom:1px solid var(--border);gap:0.5rem;flex-wrap:wrap;">
          <span class="section-label" style="margin:0;">All Services</span>
          <div style="display:flex;gap:0.5rem;">
            <input type="text" placeholder="Filter…" style="width:160px;" oninput="app.filterServices(this.value)">
            <select onchange="app.filterServicesByState(this.value)" style="width:120px;">
              <option value="all">All states</option>
              <option value="running">Running</option>
              <option value="stopped">Stopped</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="svc-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Start Type</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="services-tbody">
              <tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted);"><i class="fas fa-spinner fa-spin" style="margin-right:0.5rem;"></i>Loading services…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  getFilesPageContent() {
    return `
      <div class="page-header">
        <h2><i class="fas fa-folder-open" style="color:var(--primary);margin-right:0.5rem;font-size:0.9rem;"></i>File Manager</h2>
        <div class="page-actions">
          <input id="file-search-input" type="text" placeholder="Search files…" class="form-control"
                 style="width:200px;padding:0.5rem 0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);"
                 onkeydown="if(event.key==='Enter') app.searchFiles()">
          <button class="btn btn-icon btn-sm" title="Search" onclick="app.searchFiles()"><i class="fas fa-search"></i></button>
          <button class="btn" onclick="app.uploadFile()"><i class="fas fa-upload"></i> Upload</button>
          <button class="btn" onclick="app.createFolder()"><i class="fas fa-folder-plus"></i> New Folder</button>
          <button class="btn" onclick="app.archiveCurrentFolder()"><i class="fas fa-file-archive"></i> Archive Folder</button>
        </div>
      </div>

      <div class="card" style="padding:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.875rem;border-bottom:1px solid var(--border);gap:0.5rem;flex-wrap:wrap;">
          <div class="path-breadcrumb" id="file-breadcrumb">/</div>
          <div style="display:flex;gap:0.375rem;">
            <button class="btn btn-icon btn-sm" title="Go up" onclick="app.navigateUp()"><i class="fas fa-arrow-up"></i></button>
            <button class="btn btn-icon btn-sm" title="Home" onclick="app.goHome()"><i class="fas fa-home"></i></button>
            <button class="btn btn-icon btn-sm" title="Refresh" onclick="app.loadFilesData()"><i class="fas fa-sync-alt"></i></button>
          </div>
        </div>
        <div class="file-list" style="max-height:60vh;overflow-y:auto;">
          <table class="svc-table" style="font-size:0.8rem;">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th><th></th></tr>
            </thead>
            <tbody>
              <tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted);"><i class="fas fa-spinner fa-spin" style="margin-right:0.5rem;"></i>Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- File Editor Modal -->
      <div id="file-editor-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
        <div class="card" style="width:720px;max-width:95vw;">
          <h3 id="file-editor-title" style="color:var(--text-primary);margin-bottom:1rem;word-break:break-all;">Edit File</h3>
          <textarea id="file-editor-content" spellcheck="false"
                    style="width:100%;height:50vh;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);font-family:monospace;font-size:0.8125rem;resize:vertical;"></textarea>
          <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1rem;">
            <button class="btn" onclick="app.hideModal('file-editor-modal')">Cancel</button>
            <button class="btn btn-primary" onclick="app.saveFileEdit()"><i class="fas fa-save"></i> Save</button>
          </div>
        </div>
      </div>

      <!-- Properties / Permissions Modal -->
      <div id="file-properties-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
        <div class="card" style="width:420px;max-width:95vw;">
          <h3 style="color:var(--text-primary);margin-bottom:1rem;">Properties</h3>
          <div id="file-properties-body" style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:1rem;"></div>
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Permissions (chmod, Linux only)</label>
            <div style="display:flex;gap:0.5rem;">
              <input id="file-properties-mode" type="text" placeholder="755" maxlength="4" class="form-control"
                     style="width:100px;padding:0.5rem 0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
              <button class="btn btn-primary" onclick="app.applyFilePermissions()">Apply</button>
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;">
            <button class="btn" onclick="app.hideModal('file-properties-modal')">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  // === PAGE DATA LOADING METHODS ===

  loadMonitoringData() {
    console.log('Loading advanced monitoring data...');
    
    // Initialize monitoring charts
    if (typeof Charts !== 'undefined' && Charts.initializeMonitoringCharts) {
      Charts.initializeMonitoringCharts();
    }
    
    // Populate monitoring stat cards from last known stats
    if (this.lastStats) {
      const s = this.lastStats;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('monitor-cpu',       (s.cpu?.usage    ?? '—') + (s.cpu?.usage    != null ? '%' : ''));
      set('monitor-memory',    (s.memory?.usage ?? '—') + (s.memory?.usage != null ? '%' : ''));
      set('monitor-disk-pct',  (s.disk?.usage   ?? '—') + (s.disk?.usage   != null ? '%' : ''));
      set('monitor-disk-used', s.disk?.used  ? this.formatBytes(s.disk.used)  : '');
      set('monitor-disk-total',s.disk?.total ? '/ ' + this.formatBytes(s.disk.total) : '');
      set('monitor-network',   '—');
    }

    // Load active processes
    this.loadActiveProcesses();

    // Add click handlers for monitoring stats cards
    this.initializeMonitoringStatsCardHandlers();

    // Wire refresh button — replace the node to clear any previous listeners
    const refreshBtn = document.getElementById('refresh-processes');
    if (refreshBtn) {
      const fresh = refreshBtn.cloneNode(true);
      refreshBtn.replaceWith(fresh);
      fresh.addEventListener('click', () => this.loadActiveProcesses());
    }
  }

  async loadActiveProcesses() {
    console.log('Loading active processes...');
    const container = document.getElementById('processes-container');
    if (!container) return;

    // Show loading state
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
        <div class="loading" style="margin: 0 auto 1rem;"></div>
        <p>Loading active processes...</p>
      </div>
    `;

    try {
      const response = await fetch('/api/system/processes', {
        headers: {
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Processes data loaded:', data);
        this.updateActiveProcessesDisplay(data.data);
      } else {
        console.error('Failed to load processes data');
        this.showProcessesError('Failed to load processes data');
      }
    } catch (error) {
      console.error('Error loading processes data:', error);
      this.showProcessesError('Unable to connect to system API');
    }
  }

  updateActiveProcessesDisplay(processData) {
    const container = document.getElementById('processes-container');
    if (!container) return;

    const { total, running, processes } = processData;

    if (!processes || processes.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
          <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
          <p>No process data available</p>
        </div>
      `;
      return;
    }

    const processRows = processes.slice(0, 10).map(process => `
      <tr>
        <td>
          <div>
            <strong style="color: var(--text-primary);">${this.escapeHtml(process.name)}</strong>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">
              PID: ${process.pid}
            </div>
          </div>
        </td>
        <td>
          <span style="color: ${process.cpu > 50 ? 'var(--danger)' : process.cpu > 20 ? 'var(--warning)' : 'var(--text-primary)'}; font-weight: 600;">
            ${process.cpu.toFixed(1)}%
          </span>
        </td>
        <td>
          <span style="color: var(--text-primary); font-weight: 500;">
            ${this.formatBytes(process.memory * 1024 * 1024)}
          </span>
        </td>
        <td>
          <div class="status ${process.state === 'running' ? 'online' : 'warning'}" style="font-size: 0.75rem;">
            ${this.escapeHtml(process.state)}
          </div>
        </td>
        <td>
          <button class="btn btn-icon" title="View Process Details" onclick="app.showProcessDetails(${process.pid})">
            <i class="fas fa-info-circle"></i>
          </button>
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div style="margin-bottom: 1rem; display: flex; gap: 2rem; padding: 1rem; background: var(--bg-secondary); border-radius: var(--border-radius-sm);">
        <div style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${total}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary);">Total Processes</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--success);">${running}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary);">Running</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--primary);">${processes.length}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary);">Top Processes</div>
        </div>
      </div>
      <div class="table">
        <table style="width: 100%;">
          <thead>
            <tr>
              <th>Process</th>
              <th>CPU %</th>
              <th>Memory</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${processRows}
          </tbody>
        </table>
      </div>
    `;
  }

  showProcessesError(message) {
    const container = document.getElementById('processes-container');
    if (!container) return;

    container.innerHTML = `
      <div style="text-align: center; padding: 2rem;">
        <i class="fas fa-exclamation-triangle" style="color: var(--warning); font-size: 2rem; margin-bottom: 1rem;"></i>
        <p style="color: var(--text-secondary); margin-bottom: 1rem;">${this.escapeHtml(message)}</p>
        <button class="btn btn-primary" onclick="app.loadActiveProcesses()" style="font-size: 0.875rem;">
          <i class="fas fa-sync-alt"></i>
          Try Again
        </button>
      </div>
    `;
  }

  showProcessDetails(pid) {
    this.showToast(`Process details for PID ${pid} - Feature coming soon!`, 'info');
  }

  async loadServicesData() {
    console.log('Loading services data...');
    this.showServicesLoading();
    try {
      const response = await fetch('/api/services', {
        headers: {
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('Services data loaded:', data);
        this.updateServicesDisplay(data.data.services);
        this.updateServicesStats(data.data.services);
      } else {
        console.error('Failed to load services data');
        this.showServicesError('Failed to load services data');
      }
    } catch (error) {
      console.error('Error loading services data:', error);
      this.showServicesError('Unable to connect to services API');
    }
  }

  async loadFilesData() {
    console.log('Loading files data...');
    this.showFilesLoading();
    try {
      const currentPath = this.currentFilePath;
      const url = currentPath
        ? `/api/files/browse?path=${encodeURIComponent(currentPath)}`
        : '/api/files/browse';
      const response = await fetch(url, {
        headers: {
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        // Normalize to forward slashes so browser-side path logic works on Windows paths too
        this.currentFilePath = (data.data.currentPath || '').replace(/\\/g, '/');
        this.parentFilePath  = (data.data.parentPath  || '').replace(/\\/g, '/');
        this.currentFiles = data.data.files || [];
        this.updateFilesDisplay(data.data.files, this.currentFilePath);
        this.updateFilesStats(data.data);
      } else {
        console.error('Failed to load files data');
        this.showFilesError('Failed to load files data');
      }
    } catch (error) {
      console.error('Error loading files data:', error);
      this.showFilesError('Unable to connect to file system API');
    }
  }

  async loadDatabaseData() {
    try {
      const [infoRes, tablesRes] = await Promise.all([
        fetch('/api/database/info'),
        fetch('/api/database/tables'),
      ]);
      if (infoRes.ok) {
        const { data } = await infoRes.json();
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('db-stat-client', (data.info?.client || '—').toUpperCase());
        set('db-stat-tables', data.stats?.table_count ?? '—');
        set('db-stat-size',   data.stats?.size_mb != null ? data.stats.size_mb + ' MB' : '—');
        set('db-stat-host',   data.info?.connection?.host || 'localhost');
      }
      if (tablesRes.ok) {
        const { data } = await tablesRes.json();
        this.updateDatabaseDisplay(data.tables || data);
      } else {
        this.updateDatabaseDisplay([]);
      }
    } catch (e) {
      const tbody = document.getElementById('db-tables-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--danger);">Failed to load database info</td></tr>`;
    }
  }

  updateDatabaseDisplay(tables) {
    const tbody = document.getElementById('db-tables-tbody');
    if (!tbody) return;
    if (!tables || tables.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted);">No tables found</td></tr>`;
      return;
    }
    tbody.innerHTML = tables.map(t => `
      <tr>
        <td style="font-weight:500;color:var(--text-primary);font-size:0.8125rem;">${this.escapeHtml(t.name || t.table_name || t.TABLE_NAME || '')}</td>
        <td class="mono" style="font-size:0.75rem;color:var(--text-secondary);">${t.rows ?? t.TABLE_ROWS ?? '—'}</td>
        <td class="mono" style="font-size:0.75rem;color:var(--text-secondary);">${t.size ?? (t.DATA_LENGTH ? Math.round(t.DATA_LENGTH/1024) + ' KB' : '—')}</td>
        <td style="font-size:0.75rem;color:var(--text-muted);">${t.engine ?? t.ENGINE ?? '—'}</td>
      </tr>`).join('');
  }

  async loadUsersData() {
    console.log('Loading users data...');
    this.showUsersLoading();
    try {
      const response = await fetch('/api/users', {
        headers: {
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('Users data loaded:', data);
        this.updateUsersDisplay(data.data.users);
        this.updateUsersStats(data.data.users);
      } else {
        console.error('Failed to load users data');
        this.showUsersError('Failed to load users data');
      }
    } catch (error) {
      console.error('Error loading users data:', error);
      this.showUsersError('Unable to connect to users API');
    }
  }

  async loadSettingsData() {
    this._refreshAppearanceUI();
    const accentLabel = document.getElementById('accent-hex-label');
    if (accentLabel) accentLabel.textContent = this.accent;

    try {
      const response = await fetch('/api/settings');
      if (!response.ok) return;
      const data = await response.json();
      const settings = data.data || {};

      for (const fieldMap of Object.values(SETTINGS_FIELD_MAP)) {
        for (const [key, { el }] of Object.entries(fieldMap)) {
          const input = document.getElementById(el);
          if (input && settings[key] !== undefined) {
            input.value = settings[key].value;
          }
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  // Placeholder methods for remaining pages
  getDatabasePageContent() {
    return `
      <div class="page-header">
        <h2><i class="fas fa-database" style="color:var(--primary);margin-right:0.5rem;font-size:0.9rem;"></i>Database</h2>
        <div class="page-actions">
          <button class="btn" onclick="app.refreshDatabases()"><i class="fas fa-sync-alt"></i> Refresh</button>
        </div>
      </div>

      <div class="cols-2" style="margin-bottom:0.75rem;">
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon cpu"><i class="fas fa-database"></i></div></div>
          <div class="stat-value mono" id="db-stat-client">—</div>
          <div class="stat-label">Engine</div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon disk"><i class="fas fa-table"></i></div></div>
          <div class="stat-value mono" id="db-stat-tables">—</div>
          <div class="stat-label">Tables</div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon memory"><i class="fas fa-weight"></i></div></div>
          <div class="stat-value mono" id="db-stat-size">—</div>
          <div class="stat-label">Size</div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon network"><i class="fas fa-plug"></i></div></div>
          <div class="stat-value mono" id="db-stat-host">—</div>
          <div class="stat-label">Host</div>
        </div>
      </div>

      <div class="card" style="padding:0;">
        <div style="padding:0.75rem 1rem;border-bottom:1px solid var(--border);">
          <span class="section-label" style="margin:0;">Tables</span>
        </div>
        <div style="overflow-x:auto;">
          <table class="svc-table">
            <thead>
              <tr><th>Table</th><th>Rows</th><th>Size</th><th>Engine</th></tr>
            </thead>
            <tbody id="db-tables-tbody">
              <tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted);"><i class="fas fa-spinner fa-spin" style="margin-right:0.5rem;"></i>Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  getUsersPageContent() {
    return `
      <div class="page-header">
        <h2><i class="fas fa-users" style="color:var(--primary);margin-right:0.5rem;font-size:0.9rem;"></i>Users</h2>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="app.createUser()"><i class="fas fa-plus"></i> Add User</button>
        </div>
      </div>

      <div class="stats-grid" style="margin-bottom:0.75rem;">
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon cpu"><i class="fas fa-users"></i></div></div>
          <div class="stat-value mono" id="usr-stat-total">—</div>
          <div class="stat-label">Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon" style="background:rgba(34,200,126,0.15);color:var(--success);"><i class="fas fa-check-circle"></i></div></div>
          <div class="stat-value mono" id="usr-stat-active" style="color:var(--success);">—</div>
          <div class="stat-label">Active</div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon" style="background:rgba(240,64,64,0.15);color:var(--danger);"><i class="fas fa-shield-alt"></i></div></div>
          <div class="stat-value mono" id="usr-stat-admins">—</div>
          <div class="stat-label">Admins</div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><div class="stat-icon" style="background:rgba(107,114,128,0.15);color:var(--text-muted);"><i class="fas fa-ban"></i></div></div>
          <div class="stat-value mono" id="usr-stat-inactive" style="color:var(--text-muted);">—</div>
          <div class="stat-label">Inactive</div>
        </div>
      </div>

      <div class="card" style="padding:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;border-bottom:1px solid var(--border);gap:0.5rem;flex-wrap:wrap;">
          <span class="section-label" style="margin:0;">All Users</span>
          <input type="text" placeholder="Filter…" style="width:160px;" oninput="app.filterUsers(this.value)">
        </div>
        <div style="overflow-x:auto;">
          <table class="svc-table">
            <thead>
              <tr><th>User</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr>
            </thead>
            <tbody id="users-tbody">
              <tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted);"><i class="fas fa-spinner fa-spin" style="margin-right:0.5rem;"></i>Loading users…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Add User Modal -->
      <div id="add-user-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
        <div class="card" style="width:420px;max-width:95vw;">
          <h3 style="color:var(--text-primary);margin-bottom:1.25rem;">Add User</h3>
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Username</label>
            <input id="new-user-username" type="text" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
          </div>
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Email</label>
            <input id="new-user-email" type="email" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
          </div>
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Password</label>
            <input id="new-user-password" type="password" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
          </div>
          <div class="form-group" style="margin-bottom:1.5rem;">
            <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Role</label>
            <select id="new-user-role" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
              <option value="user">User</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
            <button class="btn" onclick="app.hideModal('add-user-modal')">Cancel</button>
            <button class="btn btn-primary" onclick="app.submitCreateUser()"><i class="fas fa-plus"></i> Create</button>
          </div>
        </div>
      </div>

      <!-- Edit User Modal -->
      <div id="edit-user-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
        <div class="card" style="width:420px;max-width:95vw;">
          <h3 style="color:var(--text-primary);margin-bottom:1.25rem;">Edit User</h3>
          <input id="edit-user-id" type="hidden">
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Username</label>
            <input id="edit-user-username" type="text" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
          </div>
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Email</label>
            <input id="edit-user-email" type="email" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
          </div>
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Role</label>
            <select id="edit-user-role" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
              <option value="user">User</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:1.5rem;display:flex;align-items:center;gap:0.6rem;">
            <input id="edit-user-active" type="checkbox" style="width:auto;">
            <label style="color:var(--text-secondary);margin:0;">Active</label>
          </div>
          <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
            <button class="btn" onclick="app.hideModal('edit-user-modal')">Cancel</button>
            <button class="btn btn-primary" onclick="app.submitEditUser()"><i class="fas fa-check"></i> Save</button>
          </div>
        </div>
      </div>

      <!-- View User Modal -->
      <div id="view-user-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
        <div class="card" style="width:460px;max-width:95vw;">
          <h3 style="color:var(--text-primary);margin-bottom:1.25rem;">User Profile</h3>
          <div id="view-user-content"></div>
          <div style="display:flex;justify-content:flex-end;margin-top:1rem;">
            <button class="btn" onclick="app.hideModal('view-user-modal')">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  getSettingsPageContent() {
    const accent = this.accent || '#5b6ef8';
    const density = this.density || 'default';
    const theme = this.theme || 'dark';

    const accents = [
      { label:'Indigo',  hex:'#5b6ef8' },
      { label:'Cyan',    hex:'#0ea5e9' },
      { label:'Emerald', hex:'#10b981' },
      { label:'Amber',   hex:'#f59e0b' },
      { label:'Rose',    hex:'#f43f5e' },
      { label:'Violet',  hex:'#8b5cf6' },
    ];

    const densities = [
      { id:'compact',     label:'Compact',     desc:'More on screen' },
      { id:'default',     label:'Default',     desc:'Balanced' },
      { id:'comfortable', label:'Comfortable', desc:'More whitespace' },
    ];

    return `
      <div style="display:grid;grid-template-columns:180px 1fr;gap:1rem;align-items:start;">

        <!-- Settings nav -->
        <div class="card" style="padding:0.5rem 0;">
          <nav>
            <ul class="nav-menu">
              <li><a href="#" class="nav-link active" data-settings-tab="appearance" onclick="app.showSettingsSection('appearance',this)"><i class="fas fa-palette"></i><span>Appearance</span></a></li>
              <li><a href="#" class="nav-link" data-settings-tab="general" onclick="app.showSettingsSection('general',this)"><i class="fas fa-sliders-h"></i><span>General</span></a></li>
              <li><a href="#" class="nav-link" data-settings-tab="security" onclick="app.showSettingsSection('security',this)"><i class="fas fa-shield-alt"></i><span>Security</span></a></li>
              <li><a href="#" class="nav-link" data-settings-tab="notifications" onclick="app.showSettingsSection('notifications',this)"><i class="fas fa-bell"></i><span>Notifications</span></a></li>
            </ul>
          </nav>
        </div>

        <!-- Settings panels -->
        <div>

          <!-- ── Appearance ─────────────────────────────────── -->
          <div class="card" id="settings-appearance">

            <div style="margin-bottom:1.25rem;">
              <h2 style="margin:0 0 0.25rem;">Appearance</h2>
              <p style="margin:0;font-size:0.8125rem;color:var(--text-secondary);">Customize how ServerPanel looks and feels</p>
            </div>

            <!-- Mode -->
            <div class="appearance-section">
              <div class="appearance-section-label">Color Mode</div>
              <div class="mode-grid">
                <div class="mode-card ${theme==='dark'?'active':''}" data-mode="dark" onclick="app.applyTheme('dark')">
                  <div class="mode-preview dark-preview"></div>
                  <div>
                    <div class="mode-label">Dark</div>
                    <div style="font-size:0.6875rem;color:var(--text-muted);">Easy on the eyes</div>
                  </div>
                  ${theme==='dark' ? '<i class="fas fa-check" style="margin-left:auto;color:var(--primary);font-size:0.75rem;"></i>' : ''}
                </div>
                <div class="mode-card ${theme==='light'?'active':''}" data-mode="light" onclick="app.applyTheme('light')">
                  <div class="mode-preview light-preview"></div>
                  <div>
                    <div class="mode-label">Light</div>
                    <div style="font-size:0.6875rem;color:var(--text-muted);">High contrast</div>
                  </div>
                  ${theme==='light' ? '<i class="fas fa-check" style="margin-left:auto;color:var(--primary);font-size:0.75rem;"></i>' : ''}
                </div>
              </div>
            </div>

            <!-- Accent color -->
            <div class="appearance-section">
              <div class="appearance-section-label">Accent Color</div>
              <div class="accent-grid">
                ${accents.map(a => `
                  <div class="accent-swatch ${a.hex===accent?'active':''}"
                       data-hex="${a.hex}"
                       title="${a.label}"
                       style="background:${a.hex};"
                       onclick="app.applyAccent('${a.hex}')">
                    ${a.hex===accent ? '<i class="fas fa-check" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:0.625rem;color:#fff;"></i>' : ''}
                  </div>
                `).join('')}
              </div>
              <div style="margin-top:0.75rem;display:flex;align-items:center;gap:0.5rem;">
                <label style="font-size:0.75rem;color:var(--text-secondary);margin:0;">Custom</label>
                <input type="color" value="${accent}" style="width:32px;height:26px;padding:2px;border-radius:4px;cursor:pointer;border:1px solid var(--border);background:var(--surface-2);"
                       oninput="app.applyAccent(this.value)">
                <span style="font-size:0.75rem;color:var(--text-muted);font-family:var(--mono);" id="accent-hex-label">${accent}</span>
              </div>
            </div>

            <!-- Density -->
            <div class="appearance-section">
              <div class="appearance-section-label">Interface Density</div>
              <div class="density-grid">
                ${densities.map(d => `
                  <div class="density-card ${d.id===density?'active':''}" data-density="${d.id}" onclick="app.applyDensity('${d.id}')">
                    <div class="density-preview ${d.id}">
                      <span></span><span></span><span style="width:70%"></span>
                    </div>
                    <div class="density-label">${d.label}</div>
                    <div class="density-desc">${d.desc}</div>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Reset -->
            <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">
              <button class="btn" onclick="app.resetAppearance()">
                <i class="fas fa-undo"></i> Reset to Defaults
              </button>
            </div>

          </div><!-- /appearance -->

          <!-- ── General ─────────────────────────────────────── -->
          <div class="card" id="settings-general" style="display:none;">

            <div style="margin-bottom:1.25rem;">
              <h2 style="margin:0 0 0.25rem;">General</h2>
              <p style="margin:0;font-size:0.8125rem;color:var(--text-secondary);">System preferences and behavior</p>
            </div>

            <div class="info-row" style="padding:0.625rem 0;">
              <strong>Server Name</strong>
              <input type="text" id="settings-server-name" value="ServerPanel Pro" style="width:180px;">
            </div>
            <div class="info-row" style="padding:0.625rem 0;">
              <strong>Timezone</strong>
              <select id="settings-timezone" style="width:180px;">
                <option value="UTC">UTC (GMT+0)</option>
                <option value="America/New_York">Eastern (GMT-5)</option>
                <option value="America/Los_Angeles">Pacific (GMT-8)</option>
                <option value="Europe/Berlin">Central Europe (GMT+1)</option>
              </select>
            </div>
            <div class="info-row" style="padding:0.625rem 0;">
              <strong>Stats Refresh</strong>
              <select id="settings-stats-refresh" style="width:180px;">
                <option value="1000">1 second</option>
                <option value="5000" selected>5 seconds</option>
                <option value="10000">10 seconds</option>
                <option value="30000">30 seconds</option>
              </select>
            </div>
            <div class="info-row" style="padding:0.625rem 0;">
              <strong>Session Timeout</strong>
              <select id="settings-session-timeout" style="width:180px;">
                <option value="900000">15 minutes</option>
                <option value="1800000">30 minutes</option>
                <option value="3600000" selected>1 hour</option>
                <option value="14400000">4 hours</option>
              </select>
            </div>
            <div class="info-row" style="padding:0.625rem 0;">
              <strong>Log Retention</strong>
              <select id="settings-log-retention" style="width:180px;">
                <option value="7">7 days</option>
                <option value="30" selected>30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </div>

            <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:0.5rem;">
              <button class="btn btn-primary" onclick="app.saveSettings('general')"><i class="fas fa-save"></i> Save</button>
            </div>

          </div><!-- /general -->

          <!-- ── Security ────────────────────────────────────── -->
          <div class="card" id="settings-security" style="display:none;">
            <div style="margin-bottom:1.25rem;">
              <h2 style="margin:0 0 0.25rem;">Security</h2>
              <p style="margin:0;font-size:0.8125rem;color:var(--text-secondary);">Manage passwords and two-factor authentication</p>
            </div>
            <div class="form-group">
              <label>Current Password</label>
              <input type="password" id="settings-current-password" placeholder="••••••••">
            </div>
            <div class="form-group">
              <label>New Password</label>
              <input type="password" id="settings-new-password" placeholder="••••••••">
            </div>
            <div class="form-group">
              <label>Confirm New Password</label>
              <input type="password" id="settings-confirm-password" placeholder="••••••••">
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:0.5rem;">
              <button class="btn btn-primary" onclick="app.updatePassword()"><i class="fas fa-key"></i> Update Password</button>
            </div>
          </div><!-- /security -->

          <!-- ── Notifications ───────────────────────────────── -->
          <div class="card" id="settings-notifications" style="display:none;">
            <div style="margin-bottom:1.25rem;">
              <h2 style="margin:0 0 0.25rem;">Notifications</h2>
              <p style="margin:0;font-size:0.8125rem;color:var(--text-secondary);">Control when and how you're alerted</p>
            </div>
            <div class="info-row" style="padding:0.625rem 0;">
              <span>
                <strong style="display:block;">CPU alert threshold</strong>
                <small style="color:var(--text-muted);">Alert when CPU exceeds this %</small>
              </span>
              <input type="number" id="settings-cpu-threshold" value="85" min="10" max="100" style="width:80px;">
            </div>
            <div class="info-row" style="padding:0.625rem 0;">
              <span>
                <strong style="display:block;">Memory alert threshold</strong>
                <small style="color:var(--text-muted);">Alert when RAM exceeds this %</small>
              </span>
              <input type="number" id="settings-memory-threshold" value="90" min="10" max="100" style="width:80px;">
            </div>
            <div class="info-row" style="padding:0.625rem 0;">
              <span>
                <strong style="display:block;">Disk alert threshold</strong>
                <small style="color:var(--text-muted);">Alert when disk exceeds this %</small>
              </span>
              <input type="number" id="settings-disk-threshold" value="80" min="10" max="100" style="width:80px;">
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:1rem;">
              <button class="btn btn-primary" onclick="app.saveSettings('notifications')"><i class="fas fa-save"></i> Save</button>
            </div>
          </div><!-- /notifications -->

        </div><!-- /panels -->
      </div><!-- /grid -->
    `;
  }

  // Update services display with real data
  updateServicesDisplay(services) {
    const tbody = document.getElementById('services-tbody');
    if (!tbody || !services) return;

    if (services.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted);">No services found</td></tr>`;
      return;
    }

    const statusBadge = s => {
      const st = s.toLowerCase();
      if (st === 'running' || st === 'active')   return `<span class="badge badge-success"><i class="fas fa-circle" style="font-size:0.45rem;margin-right:0.3rem;"></i>Running</span>`;
      if (st === 'stopped' || st === 'inactive') return `<span class="badge badge-muted"><i class="fas fa-circle" style="font-size:0.45rem;margin-right:0.3rem;"></i>Stopped</span>`;
      if (st === 'failed'  || st === 'error')    return `<span class="badge badge-danger"><i class="fas fa-exclamation-circle" style="font-size:0.6rem;margin-right:0.3rem;"></i>Failed</span>`;
      return `<span class="badge badge-muted">${s}</span>`;
    };

    tbody.innerHTML = services.map(svc => {
      const name    = this.escapeHtml(svc.name || '');
      const display = this.escapeHtml(svc.displayName || svc.name || '');
      const desc    = this.escapeHtml(svc.description || '');
      const status  = (svc.status || 'unknown').toLowerCase();
      const start   = this.escapeHtml(svc.startType || '—');
      const isRunning = status === 'running' || status === 'active';
      const isFailed  = status === 'failed'  || status === 'error';

      const toggleBtn = isRunning
        ? `<button class="btn btn-icon btn-sm" title="Stop"    onclick="app.stopService('${name}')"><i class="fas fa-stop"></i></button>`
        : `<button class="btn btn-icon btn-sm" title="Start"   onclick="app.startService('${name}')"><i class="fas fa-play" style="color:var(--success)"></i></button>`;

      return `
        <tr class="svc-row${isFailed ? ' svc-error' : ''}">
          <td>
            <div style="display:flex;align-items:center;gap:0.625rem;">
              <div class="svc-icon"><i class="fas fa-cog"></i></div>
              <div>
                <div style="font-weight:500;color:var(--text-primary);font-size:0.8125rem;">${display}</div>
                ${desc && desc !== display ? `<div style="font-size:0.6875rem;color:var(--text-muted);">${desc}</div>` : ''}
              </div>
            </div>
          </td>
          <td>${statusBadge(svc.status || 'unknown')}</td>
          <td style="font-size:0.75rem;color:var(--text-muted);">${start}</td>
          <td>
            <div style="display:flex;gap:0.25rem;">
              ${toggleBtn}
              <button class="btn btn-icon btn-sm" title="Restart" onclick="app.restartService('${name}')" ${!isRunning ? 'disabled style="opacity:0.35"' : ''}><i class="fas fa-redo"></i></button>
              <button class="btn btn-icon btn-sm" title="Logs"    onclick="app.viewServiceLogs('${name}')"><i class="fas fa-align-left"></i></button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  updateServicesStats(services) {
    if (!services) return;
    const total   = services.length;
    const running = services.filter(s => ['running','active'].includes((s.status||'').toLowerCase())).length;
    const stopped = services.filter(s => ['stopped','inactive'].includes((s.status||'').toLowerCase())).length;
    const errors  = services.filter(s => ['failed','error'].includes((s.status||'').toLowerCase())).length;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const bar = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = pct + '%'; };

    set('svc-stat-total',   total);
    set('svc-stat-running', running);
    set('svc-stat-stopped', stopped);
    set('svc-stat-errors',  errors);
    bar('svc-bar-running', total ? Math.round(running / total * 100) : 0);
    bar('svc-bar-stopped', total ? Math.round(stopped / total * 100) : 0);
    bar('svc-bar-errors',  total ? Math.round(errors  / total * 100) : 0);

    const errEl = document.getElementById('svc-stat-errors');
    if (errEl) errEl.style.color = errors > 0 ? 'var(--danger)' : 'var(--text-muted)';
  }

  // Service control methods
  async startService(serviceName) {
    await this.controlService(serviceName, 'start');
  }

  async stopService(serviceName) {
    await this.controlService(serviceName, 'stop');
  }

  async restartService(serviceName) {
    await this.controlService(serviceName, 'restart');
  }

  async controlService(serviceName, action) {
    try {
      const response = await fetch(`/api/services/${serviceName}/${action}`, {
        method: 'POST'
      });

      const data = await response.json();

      if (response.ok) {
        // 202 Accepted — job dispatched; activity panel will show live progress
        this.showToast(`${this.capitalizeFirst(action)} ${serviceName}: job queued`, 'info');
      } else {
        this.showToast(data.message || `Failed to ${action} service`, 'error');
      }
    } catch (error) {
      console.error(`Error ${action}ing service:`, error);
      this.showToast(`Error ${action}ing service`, 'error');
    }
  }

  async viewServiceLogs(serviceName) {
    try {
      const response = await fetch(`/api/services/${serviceName}/logs?lines=50`, {
        headers: {
        }
      });
      
      const data = await response.json();
      
      if (response.ok) {
        this.showServiceLogs(serviceName, data.data.logs);
      } else {
        this.showToast(data.message || 'Failed to load service logs', 'error');
      }
    } catch (error) {
      console.error('Error loading service logs:', error);
      this.showToast('Error loading service logs', 'error');
    }
  }

  showServiceLogs(serviceName, logs) {
    // Create a modal or dedicated view for service logs
    console.log(`Logs for ${serviceName}:`, logs);
    this.showToast(`Loaded ${logs.length} log entries for ${serviceName}`, 'info');
  }

  // Utility methods
  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0MB';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
  }

  // File management methods
  updateFilesDisplay(files, currentPath) {
    const fileList = document.querySelector('.file-list tbody');
    if (!fileList || !files) return;

    // Update breadcrumb
    this.updateBreadcrumb(currentPath);
    
    fileList.innerHTML = '';
    
    // Add parent directory link if not at root
    if (currentPath !== '/' && currentPath !== '') {
      const parentRow = this.createParentDirectoryRow();
      fileList.appendChild(parentRow);
    }
    
    // Add files and folders
    files.forEach(file => {
      const fileRow = this.createFileRow(file);
      fileList.appendChild(fileRow);
    });
  }

  createParentDirectoryRow() {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.onclick = () => this.navigateUp();
    tr.onmouseover = () => tr.style.background = 'rgba(255,255,255,0.05)';
    tr.onmouseout = () => tr.style.background = '';
    
    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="color: var(--text-secondary); font-size: 1.25rem;">⬆️</div>
          <strong style="color: var(--text-secondary);">..</strong>
        </div>
      </td>
      <td style="color: var(--text-secondary);">Parent Directory</td>
      <td>--</td>
      <td>--</td>
      <td></td>
    `;
    
    return tr;
  }

  createFileRow(file) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.onclick = () => file.isDirectory ? this.openFolder(file.name) : this.openFile(file.name);
    tr.onmouseover = () => tr.style.background = 'rgba(255,255,255,0.05)';
    tr.onmouseout = () => tr.style.background = '';
    
    const icon = this.getFileIcon(file);
    const size = file.isDirectory ? '--' : this.formatBytes(file.size);
    const actions = this.getFileActions(file);
    
    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="color: ${this.getFileIconColor(file)}; font-size: 1.25rem;">${icon}</div>
          <strong>${file.name}</strong>
        </div>
      </td>
      <td>${file.isDirectory ? 'Folder' : this.getFileType(file.name)}</td>
      <td>${size}</td>
      <td>${this.formatFileDate(file.modified)}</td>
      <td>
        <div style="display: flex; gap: 0.25rem;">
          ${actions}
        </div>
      </td>
    `;
    
    return tr;
  }

  _fileExt(name) {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot).toLowerCase() : '';
  }

  getFileIcon(file) {
    if (file.isDirectory) return '📁';
    const ext = this._fileExt(file.name);
    const iconMap = {
      '.js': '⚙️', '.json': '📄', '.md': '📝', '.txt': '📄',
      '.html': '🌐', '.css': '🎨', '.sql': '🗄️', '.db': '🗄️',
      '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️',
      '.pdf': '📕', '.zip': '📦', '.tar': '📦', '.gz': '📦'
    };
    return iconMap[ext] || '📄';
  }

  getFileIconColor(file) {
    if (file.isDirectory) return 'var(--warning)';
    const ext = this._fileExt(file.name);
    if (['.js', '.json'].includes(ext)) return 'var(--info)';
    if (['.md', '.txt'].includes(ext)) return 'var(--success)';
    if (['.sql', '.db'].includes(ext)) return 'var(--secondary)';
    if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) return 'var(--primary)';
    return 'var(--text-muted)';
  }

  getFileType(filename) {
    const ext = this._fileExt(filename);
    const typeMap = {
      '.js': 'JavaScript', '.json': 'JSON', '.md': 'Markdown', '.txt': 'Text',
      '.html': 'HTML', '.css': 'CSS', '.sql': 'SQL', '.db': 'Database',
      '.jpg': 'JPEG Image', '.jpeg': 'JPEG Image', '.png': 'PNG Image', '.gif': 'GIF Image',
      '.pdf': 'PDF', '.zip': 'Archive', '.tar': 'Archive', '.gz': 'Archive'
    };
    return typeMap[ext] || 'File';
  }

  getFileActions(file) {
    let actions = '';
    const archiveExts = ['.zip', '.tar', '.gz'];

    if (file.isDirectory) {
      actions += `<button class="btn btn-icon" title="Open Folder" onclick="event.stopPropagation(); window.app.openFolder('${file.name}')">📂</button>`;
      actions += `<button class="btn btn-icon" title="Rename" onclick="event.stopPropagation(); window.app.rename('${file.name}')">✏️</button>`;
      actions += `<button class="btn btn-icon" title="Properties" onclick="event.stopPropagation(); window.app.showProperties('${file.name}')">ℹ️</button>`;
    } else {
      actions += `<button class="btn btn-icon" title="Edit File" onclick="event.stopPropagation(); window.app.editFile('${file.name}')">✏️</button>`;
      actions += `<button class="btn btn-icon" title="Rename" onclick="event.stopPropagation(); window.app.rename('${file.name}')">📝</button>`;
      actions += `<button class="btn btn-icon" title="Copy" onclick="event.stopPropagation(); window.app.copyFile('${file.name}')">📋</button>`;
      if (archiveExts.includes(this._fileExt(file.name))) {
        actions += `<button class="btn btn-icon" title="Extract" onclick="event.stopPropagation(); window.app.extractArchive('${file.name}')">📦</button>`;
      }
      actions += `<button class="btn btn-icon" title="Properties" onclick="event.stopPropagation(); window.app.showProperties('${file.name}')">ℹ️</button>`;
      actions += `<button class="btn btn-icon" title="Download" onclick="event.stopPropagation(); window.app.downloadFile('${file.name}')">💾</button>`;
      actions += `<button class="btn btn-icon" title="Delete" onclick="event.stopPropagation(); window.app.deleteFile('${file.name}')">🗑️</button>`;
    }

    return actions;
  }

  formatFileDate(date) {
    if (!date) return 'Unknown';
    return new Date(date).toLocaleString();
  }

  updateBreadcrumb(currentPath) {
    const breadcrumb = document.getElementById('file-breadcrumb');
    if (!breadcrumb) return;

    const pathParts = (currentPath || '/').split('/').filter(part => part);
    let html = `<span style="color:var(--text-muted);cursor:pointer;" onclick="app.goHome()">/</span>`;

    pathParts.forEach((part, index) => {
      const partPath = '/' + pathParts.slice(0, index + 1).join('/');
      if (index === pathParts.length - 1) {
        html += ` <span style="color:var(--text-primary);">${part}</span>`;
      } else {
        html += ` <span style="color:var(--text-muted);cursor:pointer;" onclick="app.navigateToFolder('${partPath}')">${part}</span> /`;
      }
    });

    breadcrumb.innerHTML = html;
  }

  updateFilesStats(data) {
    // No stat cards on the file manager page — nothing to update
  }

  // File operations
  async openFolder(folderName) {
    const base = (this.currentFilePath || '').replace(/[/\\]+$/, '');
    this.currentFilePath = base + '/' + folderName;
    await this.loadFilesData();
  }

  async navigateUp() {
    // Use server-supplied parentPath when available; otherwise trim last segment
    if (this.parentFilePath && this.parentFilePath !== this.currentFilePath) {
      this.currentFilePath = this.parentFilePath;
    } else {
      const parts = (this.currentFilePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
      parts.pop();
      this.currentFilePath = parts.length ? parts.join('/') : null;
    }
    await this.loadFilesData();
  }

  async goHome() {
    this.currentFilePath = null; // server will default to home dir
    await this.loadFilesData();
  }

  async navigateToFolder(folderPath) {
    this.currentFilePath = folderPath;
    await this.loadFilesData();
  }

  async downloadFile(filename) {
    try {
      const base = (this.currentFilePath || '/').replace(/\/$/, '');
      const filePath = base + '/' + filename;
      const response = await fetch(`/api/files/download?path=${encodeURIComponent(filePath)}`, {
        headers: {
        }
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        window.URL.revokeObjectURL(url);
        this.showToast(`Downloading ${filename}`, 'success');
      } else {
        this.showToast('Failed to download file', 'error');
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      this.showToast('Error downloading file', 'error');
    }
  }

  async deleteFile(filename) {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;
    
    try {
      const base = (this.currentFilePath || '/').replace(/\/$/, '');
      const filePath = base + '/' + filename;
      const response = await fetch(`/api/files/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: filePath })
      });
      
      if (response.ok) {
        this.showToast(`Deleted ${filename}`, 'success');
        await this.loadFilesData(); // Refresh
      } else {
        this.showToast('Failed to delete file', 'error');
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      this.showToast('Error deleting file', 'error');
    }
  }

  async editFile(filename) {
    const base = (this.currentFilePath || '/').replace(/\/$/, '');
    const filePath = base + '/' + filename;

    try {
      const response = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const data = await response.json();

      if (!response.ok) {
        this.showToast(data.message || `Failed to open ${filename}`, 'error');
        return;
      }

      this._editingFilePath = filePath;
      document.getElementById('file-editor-title').textContent = filePath;
      document.getElementById('file-editor-content').value = data.data.content || '';
      this.showModal('file-editor-modal');
    } catch (error) {
      console.error('Error reading file:', error);
      this.showToast(`Failed to open ${filename}`, 'error');
    }
  }

  async saveFileEdit() {
    if (!this._editingFilePath) return;
    const content = document.getElementById('file-editor-content').value;

    try {
      const response = await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this._editingFilePath, content })
      });

      const data = await response.json();

      if (response.ok) {
        this.showToast('File saved successfully', 'success');
        this.hideModal('file-editor-modal');
        await this.loadFilesData();
      } else {
        this.showToast(data.message || 'Failed to save file', 'error');
      }
    } catch (error) {
      console.error('Error saving file:', error);
      this.showToast('Failed to save file', 'error');
    }
  }

  async uploadFile() {
    // Create file input
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (event) => {
      const files = event.target.files;
      if (files.length > 0) {
        await this.handleFileUpload(files);
      }
    };
    input.click();
  }

  async handleFileUpload(files) {
    const formData = new FormData();
    formData.append('path', this.currentFilePath || '/');
    
    for (let file of files) {
      formData.append('files', file);
    }
    
    try {
      this.showToast(`Uploading ${files.length} file(s)...`, 'info');
      
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
        },
        body: formData
      });
      
      if (response.ok) {
        this.showToast('Files uploaded successfully', 'success');
        await this.loadFilesData(); // Refresh
      } else {
        this.showToast('Failed to upload files', 'error');
      }
    } catch (error) {
      console.error('Error uploading files:', error);
      this.showToast('Error uploading files', 'error');
    }
  }

  async createFolder() {
    const folderName = prompt('Enter folder name:');
    if (!folderName) return;
    
    try {
      const base = (this.currentFilePath || '/').replace(/\/$/, '');
      const folderPath = base + '/' + folderName;
      const response = await fetch('/api/files/mkdir', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: folderPath })
      });
      
      if (response.ok) {
        this.showToast(`Created folder ${folderName}`, 'success');
        await this.loadFilesData(); // Refresh
      } else {
        this.showToast('Failed to create folder', 'error');
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      this.showToast('Error creating folder', 'error');
    }
  }

  // Placeholder methods for UI buttons that don't have backend implementations yet
  refreshServices() {
    this.showToast('Services refreshed', 'success');
    this.loadServicesData();
  }

  filterServices(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('#services-tbody .svc-row').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(q) ? '' : 'none';
    });
  }

  filterServicesByState(state) {
    document.querySelectorAll('#services-tbody .svc-row').forEach(row => {
      if (state === 'all') { row.style.display = ''; return; }
      const badge = row.querySelector('.badge');
      const matches = badge && badge.textContent.trim().toLowerCase().startsWith(state);
      row.style.display = matches ? '' : 'none';
    });
  }

  // File manager placeholder methods
  openFile(filename) {
    this.editFile(filename);
  }

  async rename(name) {
    const newName = prompt(`Rename ${name} to:`);
    if (!newName || newName === name) return;

    const base = (this.currentFilePath || '/').replace(/\/$/, '');
    const source = base + '/' + name;
    const destination = base + '/' + newName;

    try {
      const response = await fetch('/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, destination })
      });
      const data = await response.json();

      if (response.ok) {
        this.showToast(`Renamed to ${newName}`, 'success');
        await this.loadFilesData();
      } else {
        this.showToast(data.message || 'Failed to rename', 'error');
      }
    } catch (error) {
      console.error('Error renaming:', error);
      this.showToast('Failed to rename', 'error');
    }
  }

  showProperties(name) {
    const file = (this.currentFiles || []).find(f => f.name === name);
    const base = (this.currentFilePath || '/').replace(/\/$/, '');
    this._propertiesFilePath = base + '/' + name;

    const body = document.getElementById('file-properties-body');
    if (file) {
      body.innerHTML = `
        <div class="info-row"><span>Name</span><strong>${this.escapeHtml(file.name)}</strong></div>
        <div class="info-row"><span>Type</span><strong>${file.isDirectory ? 'Folder' : this.getFileType(file.name)}</strong></div>
        <div class="info-row"><span>Size</span><strong>${file.isDirectory ? '--' : this.formatBytes(file.size)}</strong></div>
        <div class="info-row"><span>Modified</span><strong>${this.formatFileDate(file.modified)}</strong></div>
        <div class="info-row"><span>Permissions</span><strong>${this.escapeHtml(file.permissions || 'N/A')}</strong></div>
      `;
      document.getElementById('file-properties-mode').value = (file.permissions || '').replace(/^0/, '') || '';
    } else {
      body.innerHTML = `<div class="info-row"><span>Name</span><strong>${this.escapeHtml(name)}</strong></div>`;
    }

    this.showModal('file-properties-modal');
  }

  async applyFilePermissions() {
    if (!this._propertiesFilePath) return;
    const mode = document.getElementById('file-properties-mode').value.trim();

    if (!/^[0-7]{3,4}$/.test(mode)) {
      this.showToast('Enter a valid octal mode, e.g. 755', 'error');
      return;
    }

    try {
      const response = await fetch('/api/files/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this._propertiesFilePath, mode })
      });
      const data = await response.json();

      if (response.ok) {
        this.showToast('Permissions updated', 'success');
        this.hideModal('file-properties-modal');
        await this.loadFilesData();
      } else {
        this.showToast(data.message || 'Failed to update permissions', 'error');
      }
    } catch (error) {
      console.error('Error updating permissions:', error);
      this.showToast('Failed to update permissions', 'error');
    }
  }

  async copyFile(filename) {
    const destinationName = prompt(`Copy ${filename} to (new name in current folder):`, filename + '-copy');
    if (!destinationName) return;

    const base = (this.currentFilePath || '/').replace(/\/$/, '');
    const source = base + '/' + filename;
    const destination = base + '/' + destinationName;

    try {
      const response = await fetch('/api/files/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, destination })
      });
      const data = await response.json();

      if (response.ok) {
        this.showToast(`Copied to ${destinationName}`, 'success');
        await this.loadFilesData();
      } else {
        this.showToast(data.message || 'Failed to copy', 'error');
      }
    } catch (error) {
      console.error('Error copying file:', error);
      this.showToast('Failed to copy', 'error');
    }
  }

  async searchFiles() {
    const query = document.getElementById('file-search-input').value.trim();
    if (!query) return;

    try {
      const searchPath = this.currentFilePath || '/';
      const response = await fetch(`/api/files/search?query=${encodeURIComponent(query)}&path=${encodeURIComponent(searchPath)}`);
      const data = await response.json();

      if (response.ok) {
        this.renderSearchResults(data.data.results || [], query);
      } else {
        this.showToast(data.message || 'Search failed', 'error');
      }
    } catch (error) {
      console.error('Error searching files:', error);
      this.showToast('Search failed', 'error');
    }
  }

  // Search results can be nested arbitrarily deep under the search path, so
  // (unlike a directory listing) each row knows its own full path — it can't
  // be reconstructed from currentFilePath + name. Rendered separately from
  // updateFilesDisplay/createFileRow for that reason.
  renderSearchResults(results, query) {
    const tbody = document.querySelector('.file-list tbody');
    if (!tbody) return;

    this.updateBreadcrumb(this.currentFilePath);

    if (results.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted);">No results for "${this.escapeHtml(query)}" — <a href="#" onclick="event.preventDefault(); app.loadFilesData();" style="color:var(--primary);">clear search</a></td></tr>`;
      return;
    }

    tbody.innerHTML = results.map(result => {
      const isDir = result.type === 'directory';
      const icon = isDir ? '📁' : this.getFileIcon({ name: result.name, isDirectory: false });
      const size = isDir ? '--' : this.formatBytes(result.size);
      const normalizedPath = result.path.replace(/\\/g, '/');

      return `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:0.75rem;">
              <div style="font-size:1.25rem;">${icon}</div>
              <div>
                <strong>${this.escapeHtml(result.name)}</strong>
                <div style="font-size:0.75rem;color:var(--text-muted);">${this.escapeHtml(normalizedPath)}</div>
              </div>
            </div>
          </td>
          <td>${isDir ? 'Folder' : this.getFileType(result.name)}</td>
          <td>${size}</td>
          <td>${this.formatFileDate(result.modified)}</td>
          <td>
            <div style="display:flex;gap:0.25rem;">
              ${isDir
                ? `<button class="btn btn-icon" title="Open Folder" onclick="app.navigateToFolder('${normalizedPath}')">📂</button>`
                : `<button class="btn btn-icon" title="Reveal in folder" onclick="app.navigateToFolder('${normalizedPath.slice(0, normalizedPath.lastIndexOf('/'))}')">📂</button>`}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  async archiveCurrentFolder() {
    const archiveName = prompt('Archive name (without extension):', 'archive-' + Date.now());
    if (!archiveName) return;

    try {
      const response = await fetch('/api/files/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paths: [this.currentFilePath || '/'],
          archiveName: archiveName + '.zip',
          format: 'zip'
        })
      });
      const data = await response.json();

      if (response.ok) {
        this.showToast('Archive created in backups directory', 'success');
      } else {
        this.showToast(data.message || 'Failed to create archive', 'error');
      }
    } catch (error) {
      console.error('Error creating archive:', error);
      this.showToast('Failed to create archive', 'error');
    }
  }

  async extractArchive(filename) {
    const base = (this.currentFilePath || '/').replace(/\/$/, '');
    const archivePath = base + '/' + filename;

    try {
      const response = await fetch('/api/files/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivePath, destinationPath: base })
      });
      const data = await response.json();

      if (response.ok) {
        this.showToast(`Extracted ${filename}`, 'success');
        await this.loadFilesData();
      } else {
        this.showToast(data.message || 'Failed to extract archive', 'error');
      }
    } catch (error) {
      console.error('Error extracting archive:', error);
      this.showToast('Failed to extract archive', 'error');
    }
  }

  backupDatabase(dbName) {
    this.showToast(`Backup ${dbName} functionality coming soon`, 'info');
  }

  setViewMode(mode) {
    this.showToast(`View mode: ${mode}`, 'info');
  }

  setUserView(view) {
    this.showToast(`User view: ${view}`, 'info');
  }

  updateUsersDisplay(users) {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    if (!users || users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted);">No users found</td></tr>`;
      return;
    }
    const selfId = this.currentUser?.id;
    tbody.innerHTML = users.map(u => {
      const initials = (u.username || '?').slice(0,2).toUpperCase();
      const active   = u.is_active ? `<span class="badge badge-success">Active</span>` : `<span class="badge badge-muted">Inactive</span>`;
      const roleCls  = u.role === 'admin' ? 'badge-danger' : u.role === 'viewer' ? 'badge-muted' : 'badge-info';
      const lastLogin = u.last_login ? new Date(u.last_login).toLocaleDateString() : '—';
      const isSelf = selfId === u.id;
      return `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:0.625rem;">
              <div class="user-avatar" style="width:28px;height:28px;font-size:0.6rem;">${initials}</div>
              <div>
                <div style="font-weight:500;color:var(--text-primary);font-size:0.8125rem;">${this.escapeHtml(u.username)}</div>
                <div style="font-size:0.6875rem;color:var(--text-muted);">${this.escapeHtml(u.email || '')}</div>
              </div>
            </div>
          </td>
          <td><span class="badge ${roleCls}">${u.role || '—'}</span></td>
          <td>${active}</td>
          <td class="mono" style="font-size:0.75rem;color:var(--text-muted);">${lastLogin}</td>
          <td>
            <div style="display:flex;gap:0.25rem;">
              <button class="btn btn-icon btn-sm" title="View" onclick="app.viewUserProfile(${u.id})"><i class="fas fa-eye"></i></button>
              <button class="btn btn-icon btn-sm" title="Edit" onclick="app.editUser(${u.id})"><i class="fas fa-pencil-alt"></i></button>
              <button class="btn btn-icon btn-sm" title="${u.is_active ? 'Deactivate' : 'Activate'}" ${isSelf ? 'disabled' : ''} onclick="app.toggleUserStatus(${u.id})"><i class="fas fa-${u.is_active ? 'ban' : 'check'}"></i></button>
              <button class="btn btn-icon btn-sm" title="Delete" ${isSelf ? 'disabled' : ''} style="${isSelf ? '' : 'color:var(--danger);'}" onclick="app.deleteUser(${u.id}, '${this.escapeHtml(u.username)}')"><i class="fas fa-trash"></i></button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  updateUsersStats(users) {
    if (!users) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('usr-stat-total',    users.length);
    set('usr-stat-active',   users.filter(u => u.is_active).length);
    set('usr-stat-admins',   users.filter(u => u.role === 'admin').length);
    set('usr-stat-inactive', users.filter(u => !u.is_active).length);
  }

  filterUsers(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('#users-tbody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  }

  createUser() {
    document.getElementById('new-user-username').value = '';
    document.getElementById('new-user-email').value = '';
    document.getElementById('new-user-password').value = '';
    document.getElementById('new-user-role').value = 'user';
    this.showModal('add-user-modal');
  }

  async submitCreateUser() {
    const username = document.getElementById('new-user-username').value.trim();
    const email = document.getElementById('new-user-email').value.trim();
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;

    if (!username || !email || !password) {
      return this.showToast('Username, email, and password are required', 'error');
    }

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, role })
      });
      const data = await res.json();
      if (res.ok) {
        this.hideModal('add-user-modal');
        this.showToast(`User ${username} created`, 'success');
        this.loadUsersData();
      } else {
        this.showToast(data.message || data.errors?.[0]?.msg || 'Failed to create user', 'error');
      }
    } catch (error) {
      console.error('Error creating user:', error);
      this.showToast('Failed to create user', 'error');
    }
  }

  async editUser(userId) {
    try {
      const res = await fetch(`/api/users/${userId}`);
      const data = await res.json();
      if (!res.ok) return this.showToast(data.message || 'Failed to load user', 'error');

      const u = data.data.user;
      document.getElementById('edit-user-id').value = u.id;
      document.getElementById('edit-user-username').value = u.username;
      document.getElementById('edit-user-email').value = u.email;
      document.getElementById('edit-user-role').value = u.role;
      document.getElementById('edit-user-active').checked = !!u.is_active;
      this.showModal('edit-user-modal');
    } catch (error) {
      console.error('Error loading user:', error);
      this.showToast('Failed to load user', 'error');
    }
  }

  async submitEditUser() {
    const id = document.getElementById('edit-user-id').value;
    const username = document.getElementById('edit-user-username').value.trim();
    const email = document.getElementById('edit-user-email').value.trim();
    const role = document.getElementById('edit-user-role').value;
    const is_active = document.getElementById('edit-user-active').checked;

    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, role, is_active })
      });
      const data = await res.json();
      if (res.ok) {
        this.hideModal('edit-user-modal');
        this.showToast('User updated', 'success');
        this.loadUsersData();
      } else {
        this.showToast(data.message || data.errors?.[0]?.msg || 'Failed to update user', 'error');
      }
    } catch (error) {
      console.error('Error updating user:', error);
      this.showToast('Failed to update user', 'error');
    }
  }

  async viewUserProfile(userId) {
    try {
      const res = await fetch(`/api/users/${userId}`);
      const data = await res.json();
      if (!res.ok) return this.showToast(data.message || 'Failed to load user', 'error');

      const { user, recentActivity } = data.data;
      const activityHtml = (recentActivity || []).length
        ? recentActivity.map(a => `<div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;">
            <span style="color:var(--text-primary);">${this.escapeHtml(a.action)}</span>
            <span style="color:var(--text-muted);float:right;">${new Date(a.performed_at).toLocaleString()}</span>
          </div>`).join('')
        : `<div style="color:var(--text-muted);font-size:0.8rem;padding:0.5rem 0;">No recent activity</div>`;

      document.getElementById('view-user-content').innerHTML = `
        <div style="margin-bottom:1rem;">
          <div style="font-weight:600;color:var(--text-primary);font-size:1rem;">${this.escapeHtml(user.username)}</div>
          <div style="color:var(--text-muted);font-size:0.8125rem;">${this.escapeHtml(user.email)}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem;font-size:0.8125rem;">
          <div><span style="color:var(--text-muted);">Role:</span> ${this.escapeHtml(user.role)}</div>
          <div><span style="color:var(--text-muted);">Status:</span> ${user.is_active ? 'Active' : 'Inactive'}</div>
          <div><span style="color:var(--text-muted);">Last login:</span> ${user.last_login ? new Date(user.last_login).toLocaleString() : '—'}</div>
          <div><span style="color:var(--text-muted);">Created:</span> ${new Date(user.created_at).toLocaleString()}</div>
        </div>
        <div class="section-label" style="margin-bottom:0.5rem;">Recent Activity</div>
        ${activityHtml}
      `;
      this.showModal('view-user-modal');
    } catch (error) {
      console.error('Error loading user profile:', error);
      this.showToast('Failed to load user profile', 'error');
    }
  }

  async toggleUserStatus(userId) {
    try {
      const res = await fetch(`/api/users/${userId}/toggle-status`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        this.showToast(data.message, 'success');
        this.loadUsersData();
      } else {
        this.showToast(data.message || 'Failed to change user status', 'error');
      }
    } catch (error) {
      console.error('Error toggling user status:', error);
      this.showToast('Failed to change user status', 'error');
    }
  }

  async deleteUser(userId, username) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        this.showToast(`User ${username} deleted`, 'success');
        this.loadUsersData();
      } else {
        this.showToast(data.message || 'Failed to delete user', 'error');
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      this.showToast('Failed to delete user', 'error');
    }
  }

  refreshDatabases() {
    this.loadDatabaseData();
  }

  async exportMonitoringData() {
    try {
      const res = await fetch('/api/monitoring/metrics?format=json');
      if (!res.ok) throw new Error('Export request failed');
      const data = await res.json();
      const payload = typeof data.data === 'string' ? data.data : JSON.stringify(data.data ?? data, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monitoring-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.showToast('Monitoring data exported', 'success');
    } catch (error) {
      console.error('Error exporting monitoring data:', error);
      this.showToast('Failed to export monitoring data', 'error');
    }
  }

  async configureAlerts() {
    try {
      const res = await fetch('/api/monitoring/config');
      const data = await res.json();
      if (res.ok && data.data) {
        const t = data.data.thresholds || {};
        document.getElementById('alert-cpu-threshold').value = t.cpu ?? 80;
        document.getElementById('alert-memory-threshold').value = t.memory ?? 85;
        document.getElementById('alert-disk-threshold').value = t.disk ?? 90;
        document.getElementById('alert-load-threshold').value = t.load ?? 5;
        document.getElementById('alert-alerts-enabled').checked = !!data.data.alertsEnabled;
      }
    } catch (error) {
      console.error('Error loading alert configuration:', error);
    }
    this.showModal('configure-alerts-modal');
  }

  async saveAlertConfig() {
    const thresholds = {
      cpu: parseFloat(document.getElementById('alert-cpu-threshold').value),
      memory: parseFloat(document.getElementById('alert-memory-threshold').value),
      disk: parseFloat(document.getElementById('alert-disk-threshold').value),
      load: parseFloat(document.getElementById('alert-load-threshold').value)
    };
    const alertsEnabled = document.getElementById('alert-alerts-enabled').checked;

    try {
      const res = await fetch('/api/monitoring/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thresholds, alertsEnabled })
      });
      const data = await res.json();
      if (res.ok) {
        this.hideModal('configure-alerts-modal');
        this.showToast('Alert configuration saved', 'success');
      } else {
        this.showToast(data.message || 'Failed to save alert configuration', 'error');
      }
    } catch (error) {
      console.error('Error saving alert configuration:', error);
      this.showToast('Failed to save alert configuration', 'error');
    }
  }

  async saveSettings(section) {
    const fieldMap = SETTINGS_FIELD_MAP[section];
    if (!fieldMap) {
      this.showToast('This settings section is not implemented yet', 'info');
      return;
    }

    const settings = {};
    for (const [key, { el, parse }] of Object.entries(fieldMap)) {
      const input = document.getElementById(el);
      if (!input) continue;
      settings[key] = parse(input.value);
    }

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });

      const data = await response.json();

      if (response.ok) {
        this.showToast('Settings saved successfully', 'success');
      } else {
        this.showToast(data.message || 'Failed to save settings', 'error');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      this.showToast('Failed to save settings', 'error');
    }
  }

  async updatePassword() {
    const currentPasswordEl = document.getElementById('settings-current-password');
    const newPasswordEl = document.getElementById('settings-new-password');
    const confirmPasswordEl = document.getElementById('settings-confirm-password');

    const currentPassword = currentPasswordEl.value;
    const newPassword = newPasswordEl.value;
    const confirmPassword = confirmPasswordEl.value;

    if (!currentPassword || !newPassword) {
      this.showToast('Please fill in all password fields', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      this.showToast('New password and confirmation do not match', 'error');
      return;
    }

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const data = await response.json();

      if (response.ok) {
        this.showToast('Password updated successfully', 'success');
        currentPasswordEl.value = '';
        newPasswordEl.value = '';
        confirmPasswordEl.value = '';
      } else {
        this.showToast(data.message || 'Failed to update password', 'error');
      }
    } catch (error) {
      console.error('Error updating password:', error);
      this.showToast('Failed to update password', 'error');
    }
  }

  showSettingsSection(section, linkEl) {
    const panels = ['appearance', 'general', 'security', 'notifications'];
    panels.forEach(id => {
      const el = document.getElementById(`settings-${id}`);
      if (el) el.style.display = id === section ? '' : 'none';
    });
    if (linkEl) {
      const nav = linkEl.closest('nav');
      if (nav) nav.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
      linkEl.classList.add('active');
    }
  }

  resetAppearance() {
    this.applyTheme('dark');
    this.applyAccent('#5b6ef8');
    this.applyDensity('default');
    this.showToast('Appearance reset to defaults', 'success');
  }

  // =====================================================
  // DOMAINS PAGE
  // =====================================================

  getDomainsPageContent() {
    return `
      <div style="margin-top:2rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
          <div>
            <h2 style="color:var(--text-primary);margin:0;">Domain Management</h2>
            <p style="color:var(--text-secondary);margin:0.25rem 0 0;">Manage your domains and DNS records</p>
          </div>
          <button class="btn btn-primary" onclick="app.showAddDomainModal()">
            <i class="fas fa-plus"></i> Add Domain
          </button>
        </div>
        <div id="domains-list" class="card" style="padding:0;overflow:hidden;">
          <div style="text-align:center;padding:3rem;color:var(--text-secondary);">
            <div class="loading" style="margin:0 auto 1rem;"></div>
            <p>Loading domains...</p>
          </div>
        </div>
        <!-- DNS Editor Panel -->
        <div id="dns-editor" class="card" style="margin-top:1.5rem;display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
            <h3 style="color:var(--text-primary);margin:0;"><i class="fas fa-database" style="color:var(--primary);margin-right:0.5rem;"></i>DNS Records — <span id="dns-domain-name"></span></h3>
            <div style="display:flex;gap:0.75rem;">
              <button class="btn btn-primary btn-sm" onclick="app.showAddDNSModal()"><i class="fas fa-plus"></i> Add Record</button>
              <button class="btn btn-sm" onclick="document.getElementById('dns-editor').style.display='none'"><i class="fas fa-times"></i></button>
            </div>
          </div>
          <div id="dns-records-list"></div>
        </div>
        <!-- Add Domain Modal -->
        <div id="add-domain-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
          <div class="card" style="width:460px;max-width:95vw;">
            <h3 style="color:var(--text-primary);margin-bottom:1.25rem;">Add Domain</h3>
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Domain Name</label>
              <input id="new-domain-name" type="text" placeholder="example.com" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
            </div>
            <div class="form-group" style="margin-bottom:1.5rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Type</label>
              <select id="new-domain-type" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
                <option value="addon">Addon Domain</option>
                <option value="subdomain">Subdomain</option>
                <option value="parked">Parked Domain</option>
                <option value="primary">Primary Domain</option>
              </select>
            </div>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
              <button class="btn" onclick="app.hideModal('add-domain-modal')">Cancel</button>
              <button class="btn btn-primary" onclick="app.addDomain()"><i class="fas fa-plus"></i> Add Domain</button>
            </div>
          </div>
        </div>
        <!-- Add DNS Record Modal -->
        <div id="add-dns-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
          <div class="card" style="width:480px;max-width:95vw;">
            <h3 style="color:var(--text-primary);margin-bottom:1.25rem;">Add DNS Record</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
              <div>
                <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Type</label>
                <select id="dns-type" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
                  <option>A</option><option>AAAA</option><option>CNAME</option>
                  <option>MX</option><option>TXT</option><option>NS</option><option>SRV</option>
                </select>
              </div>
              <div>
                <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">TTL (seconds)</label>
                <input id="dns-ttl" type="number" value="3600" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
              </div>
            </div>
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Name</label>
              <input id="dns-name" type="text" placeholder="@ or subdomain" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
            </div>
            <div class="form-group" style="margin-bottom:1.5rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Value</label>
              <input id="dns-value" type="text" placeholder="IP address, hostname, or text" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
            </div>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
              <button class="btn" onclick="app.hideModal('add-dns-modal')">Cancel</button>
              <button class="btn btn-primary" onclick="app.addDNSRecord()"><i class="fas fa-plus"></i> Add Record</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async loadDomainsData() {
    try {
      const res = await fetch('/api/domains');
      const data = await res.json();
      const list = document.getElementById('domains-list');
      if (!list) return;
      if (!data.success || !data.data.length) {
        list.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-secondary);"><i class="fas fa-globe" style="font-size:3rem;opacity:0.3;margin-bottom:1rem;display:block;"></i><p>No domains added yet.</p><button class="btn btn-primary" onclick="app.showAddDomainModal()" style="margin-top:1rem;"><i class="fas fa-plus"></i> Add Your First Domain</button></div>`;
        return;
      }
      list.innerHTML = `
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);">
              <th style="padding:1rem 1.25rem;text-align:left;color:var(--text-secondary);font-weight:500;font-size:0.8125rem;text-transform:uppercase;">Domain</th>
              <th style="padding:1rem;text-align:left;color:var(--text-secondary);font-weight:500;font-size:0.8125rem;text-transform:uppercase;">Type</th>
              <th style="padding:1rem;text-align:left;color:var(--text-secondary);font-weight:500;font-size:0.8125rem;text-transform:uppercase;">Status</th>
              <th style="padding:1rem;text-align:left;color:var(--text-secondary);font-weight:500;font-size:0.8125rem;text-transform:uppercase;">DNS Records</th>
              <th style="padding:1rem;text-align:right;color:var(--text-secondary);font-weight:500;font-size:0.8125rem;text-transform:uppercase;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.data.map(d => `
              <tr style="border-bottom:1px solid var(--border);" onmouseenter="this.style.background='rgba(255,255,255,0.02)'" onmouseleave="this.style.background=''">
                <td style="padding:1rem 1.25rem;">
                  <div style="font-weight:600;color:var(--text-primary);">${this.escapeHtml(d.domain)}</div>
                  <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.2rem;">${this.escapeHtml(d.document_root || '')}</div>
                </td>
                <td style="padding:1rem;"><span style="padding:0.25rem 0.6rem;background:rgba(99,102,241,0.15);color:#818cf8;border-radius:12px;font-size:0.75rem;font-weight:600;">${d.type}</span></td>
                <td style="padding:1rem;"><span style="padding:0.25rem 0.6rem;background:${d.status==='active'?'rgba(16,185,129,0.15)':'rgba(239,68,68,0.15)'};color:${d.status==='active'?'#34d399':'#f87171'};border-radius:12px;font-size:0.75rem;font-weight:600;">${d.status}</span></td>
                <td style="padding:1rem;color:var(--text-secondary);">${d.dns_record_count} records</td>
                <td style="padding:1rem;text-align:right;">
                  <button class="btn btn-sm" onclick="app.showDNSEditor(${d.id}, '${this.escapeHtml(d.domain)}')" title="Manage DNS"><i class="fas fa-database"></i></button>
                  <button class="btn btn-sm" onclick="app.toggleDomainStatus(${d.id}, '${d.status}')" title="${d.status==='active'?'Suspend':'Activate'}" style="margin-left:0.4rem;"><i class="fas fa-${d.status==='active'?'pause':'play'}"></i></button>
                  <button class="btn btn-sm" onclick="app.deleteDomain(${d.id}, '${this.escapeHtml(d.domain)}')" title="Delete" style="margin-left:0.4rem;color:var(--danger);"><i class="fas fa-trash"></i></button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    } catch (err) {
      console.error('Error loading domains:', err);
      this.showToast('Failed to load domains', 'error');
    }
  }

  showAddDomainModal() { this.showModal('add-domain-modal'); }

  async addDomain() {
    const domain = document.getElementById('new-domain-name').value.trim();
    const type = document.getElementById('new-domain-type').value;
    if (!domain) return this.showToast('Enter a domain name', 'error');
    try {
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, type })
      });
      const data = await res.json();
      if (res.ok) {
        this.hideModal('add-domain-modal');
        this.showToast(`Domain ${domain} added`, 'success');
        this.loadDomainsData();
      } else {
        this.showToast(data.message || data.errors?.[0]?.msg || 'Failed to add domain', 'error');
      }
    } catch (err) { this.showToast('Failed to add domain', 'error'); }
  }

  async toggleDomainStatus(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      const res = await fetch(`/api/domains/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) { this.showToast(`Domain ${newStatus}`, 'success'); this.loadDomainsData(); }
      else this.showToast('Failed to update domain', 'error');
    } catch (err) { this.showToast('Failed to update domain', 'error'); }
  }

  async deleteDomain(id, domain) {
    if (!confirm(`Delete domain ${domain} and all its DNS records?`)) return;
    try {
      const res = await fetch(`/api/domains/${id}`, { method: 'DELETE' });
      if (res.ok) { this.showToast(`Domain ${domain} deleted`, 'success'); this.loadDomainsData(); document.getElementById('dns-editor').style.display = 'none'; }
      else this.showToast('Failed to delete domain', 'error');
    } catch (err) { this.showToast('Failed to delete domain', 'error'); }
  }

  async showDNSEditor(domainId, domain) {
    this._activeDomainId = domainId;
    document.getElementById('dns-domain-name').textContent = domain;
    const editor = document.getElementById('dns-editor');
    editor.style.display = 'block';
    editor.scrollIntoView({ behavior: 'smooth' });
    await this.loadDNSRecords(domainId);
  }

  async loadDNSRecords(domainId) {
    try {
      const res = await fetch(`/api/domains/${domainId}/dns`);
      const data = await res.json();
      const el = document.getElementById('dns-records-list');
      if (!data.success || !data.data.length) {
        el.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:1.5rem;">No DNS records yet.</p>`;
        return;
      }
      const typeColor = { A:'#60a5fa',AAAA:'#60a5fa',CNAME:'#a78bfa',MX:'#34d399',TXT:'#fbbf24',NS:'#f87171',SRV:'#fb923c',PTR:'#94a3b8' };
      el.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="padding:0.6rem 0.75rem;text-align:left;color:var(--text-secondary);font-size:0.75rem;text-transform:uppercase;">Type</th>
            <th style="padding:0.6rem 0.75rem;text-align:left;color:var(--text-secondary);font-size:0.75rem;text-transform:uppercase;">Name</th>
            <th style="padding:0.6rem 0.75rem;text-align:left;color:var(--text-secondary);font-size:0.75rem;text-transform:uppercase;">Value</th>
            <th style="padding:0.6rem 0.75rem;text-align:left;color:var(--text-secondary);font-size:0.75rem;text-transform:uppercase;">TTL</th>
            <th style="padding:0.6rem 0.75rem;text-align:right;color:var(--text-secondary);font-size:0.75rem;text-transform:uppercase;">Del</th>
          </tr></thead>
          <tbody>${data.data.map(r => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:0.6rem 0.75rem;"><span style="padding:0.2rem 0.5rem;background:rgba(${typeColor[r.type]||'#94a3b8'},0.15);color:${typeColor[r.type]||'#94a3b8'};border-radius:4px;font-weight:700;font-size:0.7rem;">${r.type}</span></td>
              <td style="padding:0.6rem 0.75rem;color:var(--text-primary);font-family:monospace;">${this.escapeHtml(r.name)}</td>
              <td style="padding:0.6rem 0.75rem;color:var(--text-secondary);font-family:monospace;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this.escapeHtml(r.value)}">${this.escapeHtml(r.value)}</td>
              <td style="padding:0.6rem 0.75rem;color:var(--text-secondary);">${r.ttl}s</td>
              <td style="padding:0.6rem 0.75rem;text-align:right;"><button class="btn btn-sm" onclick="app.deleteDNSRecord(${domainId},${r.id})" style="color:var(--danger);padding:0.2rem 0.5rem;"><i class="fas fa-times"></i></button></td>
            </tr>`).join('')}
          </tbody>
        </table>`;
    } catch (err) { this.showToast('Failed to load DNS records', 'error'); }
  }

  showAddDNSModal() { this.showModal('add-dns-modal'); }

  async addDNSRecord() {
    const domainId = this._activeDomainId;
    if (!domainId) return;
    const type = document.getElementById('dns-type').value;
    const name = document.getElementById('dns-name').value.trim();
    const value = document.getElementById('dns-value').value.trim();
    const ttl = parseInt(document.getElementById('dns-ttl').value) || 3600;
    if (!name || !value) return this.showToast('Name and value are required', 'error');
    try {
      const res = await fetch(`/api/domains/${domainId}/dns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, value, ttl })
      });
      const data = await res.json();
      if (res.ok) { this.hideModal('add-dns-modal'); this.showToast('DNS record added', 'success'); this.loadDNSRecords(domainId); }
      else this.showToast(data.message || 'Failed to add record', 'error');
    } catch (err) { this.showToast('Failed to add DNS record', 'error'); }
  }

  async deleteDNSRecord(domainId, recordId) {
    if (!confirm('Delete this DNS record?')) return;
    try {
      const res = await fetch(`/api/domains/${domainId}/dns/${recordId}`, { method: 'DELETE' });
      if (res.ok) { this.showToast('DNS record deleted', 'success'); this.loadDNSRecords(domainId); }
      else this.showToast('Failed to delete record', 'error');
    } catch (err) { this.showToast('Failed to delete DNS record', 'error'); }
  }

  // =====================================================
  // SSL / TLS PAGE
  // =====================================================

  getSSLPageContent() {
    return `
      <div style="margin-top:2rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
          <div>
            <h2 style="color:var(--text-primary);margin:0;">SSL / TLS Certificates</h2>
            <p style="color:var(--text-secondary);margin:0.25rem 0 0;">Manage HTTPS certificates for your domains</p>
          </div>
          <div style="display:flex;gap:0.75rem;">
            <button class="btn btn-primary" onclick="app.showIssueSSLModal()"><i class="fas fa-magic"></i> Issue Free SSL</button>
            <button class="btn" onclick="app.showUploadSSLModal()"><i class="fas fa-upload"></i> Upload Cert</button>
          </div>
        </div>
        <div id="ssl-list" class="card" style="padding:0;overflow:hidden;">
          <div style="text-align:center;padding:3rem;color:var(--text-secondary);"><div class="loading" style="margin:0 auto 1rem;"></div><p>Loading certificates...</p></div>
        </div>
        <!-- Issue SSL Modal -->
        <div id="issue-ssl-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
          <div class="card" style="width:440px;max-width:95vw;">
            <h3 style="color:var(--text-primary);margin-bottom:0.5rem;"><i class="fas fa-lock" style="color:var(--success);margin-right:0.5rem;"></i>Issue Let's Encrypt SSL</h3>
            <p style="color:var(--text-secondary);font-size:0.875rem;margin-bottom:1.25rem;">Free 90-day certificate. Auto-renewal enabled by default.</p>
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Domain Name</label>
              <input id="ssl-issue-domain" type="text" placeholder="example.com" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1.5rem;">
              <input type="checkbox" id="ssl-auto-renew" checked style="width:16px;height:16px;">
              <label for="ssl-auto-renew" style="color:var(--text-secondary);font-size:0.875rem;">Auto-renew before expiry</label>
            </div>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
              <button class="btn" onclick="app.hideModal('issue-ssl-modal')">Cancel</button>
              <button class="btn btn-primary" onclick="app.issueSSL()"><i class="fas fa-magic"></i> Issue Certificate</button>
            </div>
          </div>
        </div>
        <!-- Upload SSL Modal -->
        <div id="upload-ssl-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
          <div class="card" style="width:520px;max-width:95vw;">
            <h3 style="color:var(--text-primary);margin-bottom:1.25rem;"><i class="fas fa-upload" style="color:var(--primary);margin-right:0.5rem;"></i>Upload Certificate</h3>
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Domain</label>
              <input id="upload-ssl-domain" type="text" placeholder="example.com" class="form-control" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
            </div>
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Certificate (PEM)</label>
              <textarea id="upload-ssl-cert" rows="4" placeholder="-----BEGIN CERTIFICATE-----" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);font-family:monospace;font-size:0.8rem;resize:vertical;box-sizing:border-box;"></textarea>
            </div>
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Private Key (PEM)</label>
              <textarea id="upload-ssl-key" rows="4" placeholder="-----BEGIN PRIVATE KEY-----" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);font-family:monospace;font-size:0.8rem;resize:vertical;box-sizing:border-box;"></textarea>
            </div>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
              <button class="btn" onclick="app.hideModal('upload-ssl-modal')">Cancel</button>
              <button class="btn btn-primary" onclick="app.uploadSSL()"><i class="fas fa-upload"></i> Upload</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async loadSSLData() {
    try {
      const res = await fetch('/api/ssl');
      const data = await res.json();
      const list = document.getElementById('ssl-list');
      if (!list) return;
      if (!data.success || !data.data.length) {
        list.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-secondary);"><i class="fas fa-lock-open" style="font-size:3rem;opacity:0.3;margin-bottom:1rem;display:block;"></i><p>No certificates yet.</p><button class="btn btn-primary" onclick="app.showIssueSSLModal()" style="margin-top:1rem;"><i class="fas fa-magic"></i> Issue Free SSL</button></div>`;
        return;
      }
      list.innerHTML = `
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="padding:1rem 1.25rem;text-align:left;color:var(--text-secondary);font-weight:500;font-size:0.8125rem;text-transform:uppercase;">Domain</th>
            <th style="padding:1rem;text-align:left;color:var(--text-secondary);font-weight:500;font-size:0.8125rem;text-transform:uppercase;">Issuer</th>
            <th style="padding:1rem;text-align:left;color:var(--text-secondary);font-weight:500;font-size:0.8125rem;text-transform:uppercase;">Status</th>
            <th style="padding:1rem;text-align:left;color:var(--text-secondary);font-weight:500;font-size:0.8125rem;text-transform:uppercase;">Expires</th>
            <th style="padding:1rem;text-align:right;color:var(--text-secondary);font-weight:500;font-size:0.8125rem;text-transform:uppercase;">Actions</th>
          </tr></thead>
          <tbody>${data.data.map(c => {
            const expireColor = c.is_expired ? 'var(--danger)' : c.days_until_expiry < 30 ? 'var(--warning)' : 'var(--success)';
            const statusColor = { active:'rgba(16,185,129,0.15)', expired:'rgba(239,68,68,0.15)', pending:'rgba(251,191,36,0.15)', failed:'rgba(239,68,68,0.15)' }[c.status] || 'rgba(100,116,139,0.2)';
            const statusText = { active:'#34d399', expired:'#f87171', pending:'#fbbf24', failed:'#f87171' }[c.status] || '#94a3b8';
            return `<tr style="border-bottom:1px solid var(--border);" onmouseenter="this.style.background='rgba(255,255,255,0.02)'" onmouseleave="this.style.background=''">
              <td style="padding:1rem 1.25rem;font-weight:600;color:var(--text-primary);">${this.escapeHtml(c.domain)}</td>
              <td style="padding:1rem;color:var(--text-secondary);">${this.escapeHtml(c.issuer)}</td>
              <td style="padding:1rem;"><span style="padding:0.25rem 0.6rem;background:${statusColor};color:${statusText};border-radius:12px;font-size:0.75rem;font-weight:600;">${c.status}</span></td>
              <td style="padding:1rem;color:${expireColor};font-size:0.875rem;">
                ${c.expires_at ? `${new Date(c.expires_at).toLocaleDateString()} (${c.is_expired?'expired':`${c.days_until_expiry}d left`})` : '—'}
              </td>
              <td style="padding:1rem;text-align:right;">
                ${c.source==='letsencrypt'?`<button class="btn btn-sm" onclick="app.renewSSL(${c.id})" title="Renew"><i class="fas fa-sync"></i></button>`:''}
                <button class="btn btn-sm" onclick="app.deleteSSL(${c.id},'${this.escapeHtml(c.domain)}')" title="Delete" style="margin-left:0.4rem;color:var(--danger);"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`;}).join('')}
          </tbody>
        </table>`;
    } catch (err) { console.error('SSL load error:', err); this.showToast('Failed to load certificates', 'error'); }
  }

  showIssueSSLModal() { this.showModal('issue-ssl-modal'); }
  showUploadSSLModal() { this.showModal('upload-ssl-modal'); }

  async issueSSL() {
    const domain = document.getElementById('ssl-issue-domain').value.trim();
    const auto_renew = document.getElementById('ssl-auto-renew').checked;
    if (!domain) return this.showToast('Enter a domain name', 'error');
    try {
      const res = await fetch('/api/ssl/issue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, auto_renew })
      });
      const data = await res.json();
      if (res.ok) { this.hideModal('issue-ssl-modal'); this.showToast(`SSL issuance started for ${domain}`, 'info'); this.loadSSLData(); }
      else this.showToast(data.message || 'Failed to issue certificate', 'error');
    } catch (err) { this.showToast('Failed to issue certificate', 'error'); }
  }

  async uploadSSL() {
    const domain = document.getElementById('upload-ssl-domain').value.trim();
    const certificate = document.getElementById('upload-ssl-cert').value.trim();
    const private_key = document.getElementById('upload-ssl-key').value.trim();
    if (!domain || !certificate || !private_key) return this.showToast('All fields are required', 'error');
    try {
      const res = await fetch('/api/ssl/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, certificate, private_key })
      });
      const data = await res.json();
      if (res.ok) { this.hideModal('upload-ssl-modal'); this.showToast('Certificate uploaded', 'success'); this.loadSSLData(); }
      else this.showToast(data.message || 'Upload failed', 'error');
    } catch (err) { this.showToast('Failed to upload certificate', 'error'); }
  }

  async renewSSL(id) {
    try {
      const res = await fetch(`/api/ssl/${id}/renew`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) this.showToast('Certificate renewal started', 'info');
      else this.showToast(data.message || 'Renewal failed', 'error');
    } catch (err) { this.showToast('Failed to start renewal', 'error'); }
  }

  async deleteSSL(id, domain) {
    if (!confirm(`Delete certificate for ${domain}?`)) return;
    try {
      const res = await fetch(`/api/ssl/${id}`, { method: 'DELETE' });
      if (res.ok) { this.showToast('Certificate deleted', 'success'); this.loadSSLData(); }
      else this.showToast('Failed to delete certificate', 'error');
    } catch (err) { this.showToast('Failed to delete certificate', 'error'); }
  }

  // =====================================================
  // EMAIL PAGE
  // =====================================================

  getEmailPageContent() {
    return `
      <div style="margin-top:2rem;">
        <div style="display:flex;gap:1rem;margin-bottom:1.5rem;border-bottom:1px solid var(--border);padding-bottom:0;">
          <button id="email-tab-accounts" class="email-tab active-tab" onclick="app.switchEmailTab('accounts')" style="padding:0.75rem 1.25rem;background:none;border:none;border-bottom:2px solid var(--primary);color:var(--primary);font-weight:600;cursor:pointer;">
            <i class="fas fa-user"></i> Accounts
          </button>
          <button id="email-tab-forwarders" class="email-tab" onclick="app.switchEmailTab('forwarders')" style="padding:0.75rem 1.25rem;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-secondary);font-weight:600;cursor:pointer;">
            <i class="fas fa-forward"></i> Forwarders
          </button>
        </div>
        <!-- Accounts Tab -->
        <div id="email-accounts-tab">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
            <h3 style="color:var(--text-primary);margin:0;">Email Accounts</h3>
            <button class="btn btn-primary" onclick="app.showCreateEmailModal()"><i class="fas fa-plus"></i> Create Account</button>
          </div>
          <div id="email-accounts-list" class="card" style="padding:0;overflow:hidden;">
            <div style="text-align:center;padding:3rem;color:var(--text-secondary);"><div class="loading" style="margin:0 auto 1rem;"></div><p>Loading...</p></div>
          </div>
        </div>
        <!-- Forwarders Tab -->
        <div id="email-forwarders-tab" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
            <h3 style="color:var(--text-primary);margin:0;">Email Forwarders</h3>
            <button class="btn btn-primary" onclick="app.showAddForwarderModal()"><i class="fas fa-plus"></i> Add Forwarder</button>
          </div>
          <div id="email-forwarders-list" class="card" style="padding:0;overflow:hidden;">
            <div style="text-align:center;padding:3rem;color:var(--text-secondary);"><div class="loading" style="margin:0 auto 1rem;"></div><p>Loading...</p></div>
          </div>
        </div>
        <!-- Create Email Modal -->
        <div id="create-email-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
          <div class="card" style="width:460px;max-width:95vw;">
            <h3 style="color:var(--text-primary);margin-bottom:1.25rem;">Create Email Account</h3>
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Username</label>
              <input id="email-local-part" type="text" placeholder="user" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);box-sizing:border-box;">
            </div>
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Domain</label>
              <select id="email-domain-id" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
                <option value="">Loading domains...</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Password</label>
              <input id="email-password" type="password" placeholder="••••••••" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);box-sizing:border-box;">
            </div>
            <div class="form-group" style="margin-bottom:1.5rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Storage Quota (MB)</label>
              <input id="email-quota" type="number" value="1024" min="0" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);box-sizing:border-box;">
            </div>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
              <button class="btn" onclick="app.hideModal('create-email-modal')">Cancel</button>
              <button class="btn btn-primary" onclick="app.createEmailAccount()"><i class="fas fa-plus"></i> Create</button>
            </div>
          </div>
        </div>
        <!-- Add Forwarder Modal -->
        <div id="add-forwarder-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
          <div class="card" style="width:460px;max-width:95vw;">
            <h3 style="color:var(--text-primary);margin-bottom:1.25rem;">Add Email Forwarder</h3>
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Source Address</label>
              <input id="fwd-source" type="email" placeholder="info@yourdomain.com" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);box-sizing:border-box;">
            </div>
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Domain</label>
              <select id="fwd-domain-id" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
                <option value="">Loading domains...</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:1.5rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Forward To</label>
              <input id="fwd-dest" type="email" placeholder="you@gmail.com" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);box-sizing:border-box;">
            </div>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
              <button class="btn" onclick="app.hideModal('add-forwarder-modal')">Cancel</button>
              <button class="btn btn-primary" onclick="app.addForwarder()"><i class="fas fa-plus"></i> Add</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async loadEmailData() {
    await Promise.all([this.loadEmailAccounts(), this.loadEmailForwarders()]);
  }

  switchEmailTab(tab) {
    document.getElementById('email-accounts-tab').style.display = tab === 'accounts' ? 'block' : 'none';
    document.getElementById('email-forwarders-tab').style.display = tab === 'forwarders' ? 'block' : 'none';
    document.querySelectorAll('.email-tab').forEach(btn => {
      const isActive = btn.id === `email-tab-${tab}`;
      btn.style.color = isActive ? 'var(--primary)' : 'var(--text-secondary)';
      btn.style.borderBottom = isActive ? '2px solid var(--primary)' : '2px solid transparent';
    });
  }

  async loadEmailAccounts() {
    try {
      const res = await fetch('/api/email/accounts');
      const data = await res.json();
      const el = document.getElementById('email-accounts-list');
      if (!el) return;
      if (!data.success || !data.data.length) {
        el.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-secondary);"><i class="fas fa-envelope" style="font-size:3rem;opacity:0.3;margin-bottom:1rem;display:block;"></i><p>No email accounts yet.</p></div>`;
        return;
      }
      el.innerHTML = `
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="padding:1rem 1.25rem;text-align:left;color:var(--text-secondary);font-size:0.8125rem;text-transform:uppercase;">Address</th>
            <th style="padding:1rem;text-align:left;color:var(--text-secondary);font-size:0.8125rem;text-transform:uppercase;">Storage</th>
            <th style="padding:1rem;text-align:left;color:var(--text-secondary);font-size:0.8125rem;text-transform:uppercase;">Status</th>
            <th style="padding:1rem;text-align:right;color:var(--text-secondary);font-size:0.8125rem;text-transform:uppercase;">Actions</th>
          </tr></thead>
          <tbody>${data.data.map(a => {
            const pct = a.quota_mb > 0 ? Math.round((a.used_mb / a.quota_mb) * 100) : 0;
            const barColor = pct > 85 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--success)';
            return `<tr style="border-bottom:1px solid var(--border);" onmouseenter="this.style.background='rgba(255,255,255,0.02)'" onmouseleave="this.style.background=''">
              <td style="padding:1rem 1.25rem;">
                <div style="font-weight:600;color:var(--text-primary);">${this.escapeHtml(a.local_part)}@${this.escapeHtml(a.domain)}</div>
              </td>
              <td style="padding:1rem;">
                <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.3rem;">${a.used_mb} / ${a.quota_mb} MB</div>
                <div style="height:4px;background:var(--border);border-radius:2px;width:120px;"><div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px;"></div></div>
              </td>
              <td style="padding:1rem;"><span style="padding:0.25rem 0.6rem;background:${a.is_active?'rgba(16,185,129,0.15)':'rgba(239,68,68,0.15)'};color:${a.is_active?'#34d399':'#f87171'};border-radius:12px;font-size:0.75rem;font-weight:600;">${a.is_active?'Active':'Suspended'}</span></td>
              <td style="padding:1rem;text-align:right;">
                <button class="btn btn-sm" onclick="app.deleteEmailAccount(${a.id},'${this.escapeHtml(a.local_part)}@${this.escapeHtml(a.domain)}')" style="color:var(--danger);"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`;}).join('')}
          </tbody>
        </table>`;
    } catch (err) { this.showToast('Failed to load email accounts', 'error'); }
  }

  async loadEmailForwarders() {
    try {
      const res = await fetch('/api/email/forwarders');
      const data = await res.json();
      const el = document.getElementById('email-forwarders-list');
      if (!el) return;
      if (!data.success || !data.data.length) {
        el.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-secondary);"><i class="fas fa-forward" style="font-size:3rem;opacity:0.3;margin-bottom:1rem;display:block;"></i><p>No forwarders yet.</p></div>`;
        return;
      }
      el.innerHTML = `
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="padding:1rem 1.25rem;text-align:left;color:var(--text-secondary);font-size:0.8125rem;text-transform:uppercase;">Source</th>
            <th style="padding:1rem;text-align:left;color:var(--text-secondary);font-size:0.8125rem;text-transform:uppercase;"> </th>
            <th style="padding:1rem;text-align:left;color:var(--text-secondary);font-size:0.8125rem;text-transform:uppercase;">Destination</th>
            <th style="padding:1rem;text-align:right;color:var(--text-secondary);font-size:0.8125rem;text-transform:uppercase;">Actions</th>
          </tr></thead>
          <tbody>${data.data.map(f => `
            <tr style="border-bottom:1px solid var(--border);" onmouseenter="this.style.background='rgba(255,255,255,0.02)'" onmouseleave="this.style.background=''">
              <td style="padding:1rem 1.25rem;font-family:monospace;color:var(--text-primary);">${this.escapeHtml(f.source)}</td>
              <td style="padding:1rem;color:var(--text-secondary);"><i class="fas fa-arrow-right"></i></td>
              <td style="padding:1rem;font-family:monospace;color:var(--primary);">${this.escapeHtml(f.destination)}</td>
              <td style="padding:1rem;text-align:right;">
                <button class="btn btn-sm" onclick="app.deleteForwarder(${f.id})" style="color:var(--danger);"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>`;
    } catch (err) { this.showToast('Failed to load forwarders', 'error'); }
  }

  async showCreateEmailModal() {
    await this._populateDomainSelect('email-domain-id');
    this.showModal('create-email-modal');
  }

  async showAddForwarderModal() {
    await this._populateDomainSelect('fwd-domain-id');
    this.showModal('add-forwarder-modal');
  }

  async _populateDomainSelect(selectId) {
    try {
      const res = await fetch('/api/domains');
      const data = await res.json();
      const sel = document.getElementById(selectId);
      if (!sel || !data.success) return;
      sel.innerHTML = data.data.map(d => `<option value="${d.id}">${this.escapeHtml(d.domain)}</option>`).join('');
    } catch (err) { /* silently fail */ }
  }

  async createEmailAccount() {
    const local_part = document.getElementById('email-local-part').value.trim();
    const domain_id = document.getElementById('email-domain-id').value;
    const password = document.getElementById('email-password').value;
    const quota_mb = parseInt(document.getElementById('email-quota').value) || 1024;
    if (!local_part || !domain_id || !password) return this.showToast('All fields are required', 'error');
    try {
      const res = await fetch('/api/email/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ local_part, domain_id, password, quota_mb })
      });
      const data = await res.json();
      if (res.ok) { this.hideModal('create-email-modal'); this.showToast(`Email account created`, 'success'); this.loadEmailAccounts(); }
      else this.showToast(data.message || 'Failed to create account', 'error');
    } catch (err) { this.showToast('Failed to create email account', 'error'); }
  }

  async deleteEmailAccount(id, address) {
    if (!confirm(`Delete email account ${address}?`)) return;
    try {
      const res = await fetch(`/api/email/accounts/${id}`, { method: 'DELETE' });
      if (res.ok) { this.showToast('Account deleted', 'success'); this.loadEmailAccounts(); }
      else this.showToast('Failed to delete account', 'error');
    } catch (err) { this.showToast('Failed to delete account', 'error'); }
  }

  async addForwarder() {
    const source = document.getElementById('fwd-source').value.trim();
    const destination = document.getElementById('fwd-dest').value.trim();
    const domain_id = document.getElementById('fwd-domain-id').value;
    if (!source || !destination || !domain_id) return this.showToast('All fields are required', 'error');
    try {
      const res = await fetch('/api/email/forwarders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, destination, domain_id })
      });
      const data = await res.json();
      if (res.ok) { this.hideModal('add-forwarder-modal'); this.showToast('Forwarder added', 'success'); this.loadEmailForwarders(); }
      else this.showToast(data.message || 'Failed to add forwarder', 'error');
    } catch (err) { this.showToast('Failed to add forwarder', 'error'); }
  }

  async deleteForwarder(id) {
    if (!confirm('Delete this forwarder?')) return;
    try {
      const res = await fetch(`/api/email/forwarders/${id}`, { method: 'DELETE' });
      if (res.ok) { this.showToast('Forwarder deleted', 'success'); this.loadEmailForwarders(); }
      else this.showToast('Failed to delete forwarder', 'error');
    } catch (err) { this.showToast('Failed to delete forwarder', 'error'); }
  }

  // =====================================================
  // BACKUPS PAGE
  // =====================================================

  getBackupsPageContent() {
    return `
      <div style="margin-top:2rem;">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem;">
          ${[['full','Full Backup','fas fa-hdd','var(--primary)'],['files','Files Only','fas fa-folder','var(--warning)'],['database','Databases','fas fa-database','var(--info)'],['emails','Emails','fas fa-envelope','var(--success)']].map(([type,label,icon,color]) => `
            <div class="card" style="text-align:center;padding:1.5rem;cursor:pointer;transition:border-color 0.2s;" onmouseenter="this.style.borderColor='${color}'" onmouseleave="this.style.borderColor=''" onclick="app.createBackup('${type}')">
              <i class="${icon}" style="font-size:2rem;color:${color};margin-bottom:0.75rem;display:block;"></i>
              <div style="font-weight:600;color:var(--text-primary);margin-bottom:0.25rem;">${label}</div>
              <div style="font-size:0.75rem;color:var(--text-secondary);">Click to back up</div>
            </div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
          <!-- Backup History -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
              <h3 style="color:var(--text-primary);margin:0;">Backup History</h3>
              <button class="btn btn-sm" onclick="app.loadBackupsData()"><i class="fas fa-sync"></i> Refresh</button>
            </div>
            <div id="backup-history" class="card" style="padding:0;overflow:hidden;max-height:480px;overflow-y:auto;">
              <div style="text-align:center;padding:2rem;color:var(--text-secondary);"><div class="loading" style="margin:0 auto 0.75rem;"></div><p>Loading...</p></div>
            </div>
          </div>
          <!-- Schedules -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
              <h3 style="color:var(--text-primary);margin:0;">Schedules</h3>
              <button class="btn btn-primary btn-sm" onclick="app.showAddScheduleModal()"><i class="fas fa-plus"></i> Add Schedule</button>
            </div>
            <div id="backup-schedules" class="card" style="padding:0;overflow:hidden;">
              <div style="text-align:center;padding:2rem;color:var(--text-secondary);"><div class="loading" style="margin:0 auto 0.75rem;"></div><p>Loading...</p></div>
            </div>
          </div>
        </div>
        <!-- Add Schedule Modal -->
        <div id="add-schedule-modal" class="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:500;align-items:center;justify-content:center;">
          <div class="card" style="width:440px;max-width:95vw;">
            <h3 style="color:var(--text-primary);margin-bottom:1.25rem;">Add Backup Schedule</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
              <div>
                <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Backup Type</label>
                <select id="sched-type" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
                  <option value="full">Full</option><option value="files">Files</option>
                  <option value="database">Database</option><option value="emails">Emails</option>
                </select>
              </div>
              <div>
                <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Frequency</label>
                <select id="sched-freq" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);">
                  <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div class="form-group" style="margin-bottom:1.5rem;">
              <label style="color:var(--text-secondary);display:block;margin-bottom:0.4rem;">Retain for (days)</label>
              <input id="sched-retention" type="number" value="7" min="1" max="365" style="width:100%;padding:0.75rem;background:var(--dark-light);border:1px solid var(--border);border-radius:var(--border-radius-sm);color:var(--text-primary);box-sizing:border-box;">
            </div>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
              <button class="btn" onclick="app.hideModal('add-schedule-modal')">Cancel</button>
              <button class="btn btn-primary" onclick="app.addBackupSchedule()"><i class="fas fa-plus"></i> Create Schedule</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async loadBackupsData() {
    await Promise.all([this.loadBackupHistory(), this.loadBackupSchedules()]);
  }

  async loadBackupHistory() {
    try {
      const res = await fetch('/api/backups');
      const data = await res.json();
      const el = document.getElementById('backup-history');
      if (!el) return;
      if (!data.success || !data.data.length) {
        el.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--text-secondary);"><i class="fas fa-inbox" style="font-size:2.5rem;opacity:0.3;margin-bottom:0.75rem;display:block;"></i><p>No backups yet.</p></div>`;
        return;
      }
      const typeIcon = { full:'fa-hdd', files:'fa-folder', database:'fa-database', emails:'fa-envelope' };
      el.innerHTML = data.data.map(b => {
        const statusColor = { completed:'var(--success)', failed:'var(--danger)', running:'var(--primary)', queued:'var(--text-secondary)' }[b.status] || 'var(--text-secondary)';
        const size = b.size_bytes > 0 ? this.formatBytes(b.size_bytes) : '—';
        return `<div style="display:flex;align-items:center;gap:1rem;padding:0.875rem 1.25rem;border-bottom:1px solid var(--border);">
          <i class="fas ${typeIcon[b.type]||'fa-archive'}" style="color:var(--primary);width:16px;flex-shrink:0;"></i>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.875rem;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escapeHtml(b.name)}</div>
            <div style="font-size:0.75rem;color:var(--text-secondary);">${new Date(b.created_at).toLocaleString()} · ${size}</div>
          </div>
          <span style="flex-shrink:0;font-size:0.75rem;font-weight:600;color:${statusColor};">${b.status}</span>
          <div style="display:flex;gap:0.35rem;flex-shrink:0;">
            ${b.status==='completed'?`<button class="btn btn-sm" onclick="app.restoreBackup(${b.id})" title="Restore"><i class="fas fa-undo"></i></button>`:''}
            <button class="btn btn-sm" onclick="app.deleteBackup(${b.id})" title="Delete" style="color:var(--danger);"><i class="fas fa-trash"></i></button>
          </div>
        </div>`;
      }).join('');
    } catch (err) { this.showToast('Failed to load backup history', 'error'); }
  }

  async loadBackupSchedules() {
    try {
      const res = await fetch('/api/backups/schedules');
      const data = await res.json();
      const el = document.getElementById('backup-schedules');
      if (!el) return;
      if (!data.success || !data.data.length) {
        el.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--text-secondary);"><i class="fas fa-calendar" style="font-size:2.5rem;opacity:0.3;margin-bottom:0.75rem;display:block;"></i><p>No schedules set up.</p></div>`;
        return;
      }
      el.innerHTML = data.data.map(s => `
        <div style="display:flex;align-items:center;gap:1rem;padding:0.875rem 1.25rem;border-bottom:1px solid var(--border);">
          <div style="flex:1;">
            <div style="font-size:0.875rem;font-weight:500;color:var(--text-primary);">${s.type} · ${s.frequency}</div>
            <div style="font-size:0.75rem;color:var(--text-secondary);">Keep ${s.retention_days} days · Next: ${s.next_run ? new Date(s.next_run).toLocaleDateString() : '—'}</div>
          </div>
          <span style="font-size:0.75rem;font-weight:600;color:${s.is_active?'var(--success)':'var(--text-secondary)'};">${s.is_active?'Active':'Paused'}</span>
          <div style="display:flex;gap:0.35rem;">
            <button class="btn btn-sm" onclick="app.toggleSchedule(${s.id},${s.is_active})" title="${s.is_active?'Pause':'Resume'}"><i class="fas fa-${s.is_active?'pause':'play'}"></i></button>
            <button class="btn btn-sm" onclick="app.deleteBackupSchedule(${s.id})" title="Delete" style="color:var(--danger);"><i class="fas fa-trash"></i></button>
          </div>
        </div>`).join('');
    } catch (err) { this.showToast('Failed to load schedules', 'error'); }
  }

  async createBackup(type) {
    try {
      const res = await fetch('/api/backups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      const data = await res.json();
      if (res.ok) { this.showToast(`${type} backup started`, 'info'); setTimeout(() => this.loadBackupHistory(), 500); }
      else this.showToast(data.message || 'Failed to start backup', 'error');
    } catch (err) { this.showToast('Failed to start backup', 'error'); }
  }

  async restoreBackup(id) {
    if (!confirm('Restore from this backup? This will overwrite current data.')) return;
    try {
      const res = await fetch(`/api/backups/${id}/restore`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) this.showToast('Restore started', 'info');
      else this.showToast(data.message || 'Restore failed', 'error');
    } catch (err) { this.showToast('Failed to start restore', 'error'); }
  }

  async deleteBackup(id) {
    if (!confirm('Delete this backup?')) return;
    try {
      const res = await fetch(`/api/backups/${id}`, { method: 'DELETE' });
      if (res.ok) { this.showToast('Backup deleted', 'success'); this.loadBackupHistory(); }
      else this.showToast('Failed to delete backup', 'error');
    } catch (err) { this.showToast('Failed to delete backup', 'error'); }
  }

  showAddScheduleModal() { this.showModal('add-schedule-modal'); }

  async addBackupSchedule() {
    const type = document.getElementById('sched-type').value;
    const frequency = document.getElementById('sched-freq').value;
    const retention_days = parseInt(document.getElementById('sched-retention').value) || 7;
    try {
      const res = await fetch('/api/backups/schedules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, frequency, retention_days })
      });
      const data = await res.json();
      if (res.ok) { this.hideModal('add-schedule-modal'); this.showToast('Schedule created', 'success'); this.loadBackupSchedules(); }
      else this.showToast(data.message || 'Failed to create schedule', 'error');
    } catch (err) { this.showToast('Failed to create schedule', 'error'); }
  }

  async toggleSchedule(id, isActive) {
    try {
      const res = await fetch(`/api/backups/schedules/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive })
      });
      if (res.ok) { this.showToast(`Schedule ${isActive?'paused':'resumed'}`, 'success'); this.loadBackupSchedules(); }
      else this.showToast('Failed to update schedule', 'error');
    } catch (err) { this.showToast('Failed to update schedule', 'error'); }
  }

  async deleteBackupSchedule(id) {
    if (!confirm('Delete this schedule?')) return;
    try {
      const res = await fetch(`/api/backups/schedules/${id}`, { method: 'DELETE' });
      if (res.ok) { this.showToast('Schedule deleted', 'success'); this.loadBackupSchedules(); }
      else this.showToast('Failed to delete schedule', 'error');
    } catch (err) { this.showToast('Failed to delete schedule', 'error'); }
  }

  // =====================================================
  // Modal helpers + XSS-safe escaping
  // =====================================================

  showModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
  }

  hideModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ServerPanelApp();
});