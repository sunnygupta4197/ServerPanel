// Chart utilities for system monitoring
const Charts = {
  charts: {},

  init() {
    console.log('Charts initializing...');
    this.initializeSystemPerformanceChart();
    console.log('Charts initialized successfully');
  },

  // Initialize the main system performance chart
  initializeSystemPerformanceChart() {
    const canvas = document.getElementById('performance-chart');
    if (!canvas) return;

    if (this.charts.performance) {
      this.charts.performance.destroy();
      this.charts.performance = null;
    }

    const ctx = canvas.getContext('2d');

    this.charts.performance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: this.generateTimeLabels(30), // Last 30 data points
        datasets: [
          {
            label: 'CPU Usage %',
            data: Array(30).fill(0),
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
          {
            label: 'Memory Usage %',
            data: Array(30).fill(0),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
          {
            label: 'Disk I/O %',
            data: Array(30).fill(0),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        aspectRatio: 2.5,
        layout: {
          padding: {
            top: 5,
            bottom: 5
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#94a3b8',
              font: {
                family: 'Inter',
                size: 12
              },
              usePointStyle: true,
              padding: 20
            }
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: '#1a1b3a',
            titleColor: '#ffffff',
            bodyColor: '#94a3b8',
            borderColor: '#374151',
            borderWidth: 1,
          }
        },
        scales: {
          x: {
            display: true,
            grid: {
              color: 'rgba(148, 163, 184, 0.1)',
            },
            ticks: {
              color: '#94a3b8',
              font: {
                family: 'Inter',
                size: 11
              }
            }
          },
          y: {
            display: true,
            min: 0,
            max: 100,
            grid: {
              color: 'rgba(148, 163, 184, 0.1)',
            },
            ticks: {
              color: '#94a3b8',
              font: {
                family: 'Inter',
                size: 11
              },
              callback: function(value) {
                return value + '%';
              }
            }
          }
        },
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false
        },
        animation: {
          duration: 750,
          easing: 'easeInOutQuart'
        }
      }
    });

    console.log('System performance chart initialized');
  },

  // Generate time labels for chart x-axis
  generateTimeLabels(count) {
    const labels = [];
    const now = new Date();
    
    for (let i = count - 1; i >= 0; i--) {
      const time = new Date(now.getTime() - (i * 5000)); // 5-second intervals
      labels.push(time.toLocaleTimeString('en-US', { 
        hour12: false, 
        minute: '2-digit', 
        second: '2-digit' 
      }));
    }
    
    return labels;
  },

  // Update chart with new system data
  updateSystemPerformanceChart(systemData) {
    const chart = this.charts.performance;
    if (!chart || !systemData) return;

    try {
      const now = new Date().toLocaleTimeString('en-US', { 
        hour12: false, 
        minute: '2-digit', 
        second: '2-digit' 
      });

      // Update labels - remove first, add new
      chart.data.labels.shift();
      chart.data.labels.push(now);

      // Update CPU data
      chart.data.datasets[0].data.shift();
      chart.data.datasets[0].data.push(parseFloat(systemData.cpu?.usage || 0));

      // Update Memory data
      chart.data.datasets[1].data.shift();
      chart.data.datasets[1].data.push(parseFloat(systemData.memory?.usage || 0));

      // Update Disk I/O data (using disk usage as placeholder)
      chart.data.datasets[2].data.shift();
      chart.data.datasets[2].data.push(parseFloat(systemData.disk?.usage || 0));

      chart.update('none'); // Update without animation for real-time feel
    } catch (error) {
      console.error('Error updating performance chart:', error);
    }
  },

  // Create monitoring page charts
  initializeMonitoringCharts() {
    this.createAdvancedPerformanceChart();
    console.log('Monitoring charts initialized');
  },

  // Advanced chart for monitoring page
  createAdvancedPerformanceChart() {
    const canvas = document.getElementById('advanced-performance-chart');
    if (!canvas) return;

    // Destroy existing chart instance before re-creating to prevent stacking
    if (this.charts.advanced) {
      this.charts.advanced.destroy();
      this.charts.advanced = null;
    }

    const ctx = canvas.getContext('2d');

    this.charts.advanced = new Chart(ctx, {
      type: 'line',
      data: {
        labels: this.generateTimeLabels(60), // More data points for monitoring
        datasets: [
          {
            label: 'CPU %',
            data: Array(60).fill(0),
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
          },
          {
            label: 'Memory %',
            data: Array(60).fill(0),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
          },
          {
            label: 'Disk %',
            data: Array(60).fill(0),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#94a3b8',
              font: { family: 'Inter', size: 12 },
              usePointStyle: true,
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(148, 163, 184, 0.1)' },
            ticks: { color: '#94a3b8' }
          },
          y: {
            grid: { color: 'rgba(148, 163, 184, 0.1)' },
            ticks: { color: '#94a3b8' }
          }
        }
      }
    });
  },

  updateAdvancedChart(data) {
    const chart = this.charts.advanced;
    if (!chart || !data) return;
    const now = new Date().toLocaleTimeString('en-US', { hour12:false, minute:'2-digit', second:'2-digit' });
    chart.data.labels.shift();
    chart.data.labels.push(now);
    chart.data.datasets[0].data.shift(); chart.data.datasets[0].data.push(parseFloat(data.cpu?.usage    || 0));
    chart.data.datasets[1].data.shift(); chart.data.datasets[1].data.push(parseFloat(data.memory?.usage || 0));
    chart.data.datasets[2].data.shift(); chart.data.datasets[2].data.push(parseFloat(data.disk?.usage   || 0));
    chart.update('none');
  },

  // Generate random data for demo purposes
  generateRandomData(count, min, max) {
    const data = [];
    let current = (min + max) / 2;
    
    for (let i = 0; i < count; i++) {
      current += (Math.random() - 0.5) * 5;
      current = Math.max(min, Math.min(max, current));
      data.push(Math.round(current * 10) / 10);
    }
    
    return data;
  },

  // Destroy all charts (for cleanup)
  destroyAll() {
    Object.values(this.charts).forEach(chart => {
      if (chart) chart.destroy();
    });
    this.charts = {};
  }
};