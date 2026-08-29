// WhatsFlow Application Controller & HTML5 SPA Router

let globalPollInterval = null;
let qrPollTimer = null;

// ==========================================================================
// SPA ROUTER & URL MANAGER
// ==========================================================================
const Router = {
  routes: {
    '/': { view: 'landing' },
    '/home': { view: 'landing' },
    '/dashboard': { view: 'app', tab: 'dashboard', auth: true },
    '/device': { view: 'app', tab: 'device', auth: true },
    '/projects': { view: 'app', tab: 'projects', auth: true },
    '/automations': { view: 'app', tab: 'automations', subView: 'hub', auth: true },
    '/automations/hub': { view: 'app', tab: 'automations', subView: 'hub', auth: true },
    '/automations/manual': { view: 'app', tab: 'automations', subView: 'manual', auth: true },
    '/automations/workflow': { view: 'app', tab: 'automations', subView: 'workflow', auth: true },
    '/automations/workflows': { view: 'app', tab: 'automations', subView: 'workflow', auth: true },
    '/automations/visual': { view: 'app', tab: 'automations', subView: 'workflow', auth: true },
    '/workflows': { view: 'app', tab: 'automations', subView: 'workflow', auth: true },
    '/messages': { view: 'app', tab: 'messages', auth: true },
  },

  navigate(path, pushState = true) {
    const cleanPath = path.split('?')[0].replace(/\/$/, '') || '/';
    
    // Match /projects/:id
    const projectMatch = cleanPath.match(/^\/projects\/([a-zA-Z0-9_-]+)$/);
    if (projectMatch) {
      const projectId = projectMatch[1];
      if (Auth && !Auth.token) {
        this.navigate('/', true);
        openAuthModal('login');
        showToast('Please sign in to access project workspaces.', 'error');
        return;
      }

      if (pushState) history.pushState({ path: cleanPath, projectId }, '', cleanPath);
      showAppView('projects', false);
      if (typeof openProjectWorkspace === 'function') {
        openProjectWorkspace(projectId, false);
      }
      return;
    }

    const route = this.routes[cleanPath] || this.routes['/'];

    // Auth Guard
    if (route.auth && (!Auth || !Auth.token)) {
      if (pushState) history.replaceState({ path: '/' }, '', '/');
      showLandingView(false);
      openAuthModal('login');
      showToast('Please sign in to access your dashboard.', 'info');
      return;
    }

    if (pushState && window.location.pathname !== cleanPath) {
      history.pushState({ path: cleanPath, tab: route.tab, subView: route.subView }, '', cleanPath);
    }

    if (route.view === 'landing') {
      showLandingView(false);
    } else if (route.view === 'app') {
      showAppView(route.tab || 'dashboard', false);
      if (route.tab === 'automations' && typeof openAutomationsSubView === 'function') {
        openAutomationsSubView(route.subView || 'hub', false);
      }
    }
  },

  init() {
    window.addEventListener('popstate', (e) => {
      const path = window.location.pathname;
      Router.navigate(path, false);
    });

    // Initial Route on load
    const currentPath = window.location.pathname;
    if (currentPath && currentPath !== '/' && currentPath !== '/home') {
      this.navigate(currentPath, false);
    } else {
      if (Auth && Auth.token) {
        this.navigate('/dashboard', false);
      } else {
        this.navigate('/', false);
      }
    }
  }
};

// View Navigation Helpers
function showLandingView(updateUrl = true) {
  const landing = document.getElementById('landingView');
  const app = document.getElementById('appView');
  if (landing) landing.style.display = 'flex';
  if (app) app.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (updateUrl && window.location.pathname !== '/') {
    history.pushState({ path: '/' }, '', '/');
  }
}

function showAppView(targetTab = 'dashboard', updateUrl = true) {
  const landing = document.getElementById('landingView');
  const app = document.getElementById('appView');
  if (landing) landing.style.display = 'none';
  if (app) app.style.display = 'flex';
  switchTab(targetTab, updateUrl);
}

function handleDashboardEntry() {
  if (Auth && Auth.user) {
    Router.navigate('/dashboard', true);
  } else {
    openAuthModal('login');
  }
}

function scrollToLandingSection(id, event) {
  if (event && event.preventDefault) {
    event.preventDefault();
  }
  toggleLandingMobileMenu(false);

  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) {
      const headerOffset = 70;
      const elementPosition = el.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  }, 30);
}

function scrollToSection(id) {
  scrollToLandingSection(id);
}

function toggleLandingMobileMenu(forceState) {
  const menu = document.getElementById('landingMobileMenu');
  const icon = document.getElementById('landingMobileIcon');
  if (!menu) return;

  const shouldOpen = typeof forceState === 'boolean' ? forceState : (menu.style.display === 'none' || menu.style.display === '');
  if (shouldOpen) {
    menu.style.display = 'flex';
    if (icon) icon.className = 'fa-solid fa-xmark';
  } else {
    menu.style.display = 'none';
    if (icon) icon.className = 'fa-solid fa-bars';
  }
}

// Code Snippets Data
const codeSnippets = {
  curl: `curl -X POST https://whatsflow.ashiik.com/api/v1/send-message \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer qb_live_YOUR_PROJECT_KEY" \\
  -d '{
    "to": "+88017XXXXXXXX",
    "message": "🍔 Your QuickBite order #104 has been confirmed!"
  }'`,

  php: `<?php
// Send WhatsApp notification from QuickBite PHP Backend
$apiUrl = "https://whatsflow.ashiik.com/api/v1/send-message";
$apiKey = "qb_live_YOUR_PROJECT_KEY";

$payload = json_encode([
    'to' => '+88017XXXXXXXX',
    'message' => "🍔 Your QuickBite order #104 is confirmed!"
]);

$ch = curl_init($apiUrl);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Authorization: Bearer ' . $apiKey
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);
echo $response;`,

  node: `// Send WhatsApp message with Node.js / Express
const res = await fetch('https://whatsflow.ashiik.com/api/v1/send-message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer qb_live_YOUR_PROJECT_KEY'
  },
  body: JSON.stringify({
    to: '+88017XXXXXXXX',
    message: '🍔 Your QuickBite order #104 is confirmed!'
  })
});
const data = await res.json();
console.log(data);`,

  python: `# Send WhatsApp message with Python requests
import requests

url = "https://whatsflow.ashiik.com/api/v1/send-message"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer qb_live_YOUR_PROJECT_KEY"
}
payload = {
    "to": "+88017XXXXXXXX",
    "message": "🍔 Your QuickBite order #104 is confirmed!"
}

response = requests.post(url, json=payload, headers=headers)
print(response.json())`
};

let activeSnippetKey = 'curl';

function switchCodeTab(lang) {
  activeSnippetKey = lang;
  document.querySelectorAll('.code-tab').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.toLowerCase().includes(lang)) btn.classList.add('active');
  });

  const contentEl = document.getElementById('codeSnippetContent');
  if (contentEl && codeSnippets[lang]) {
    contentEl.innerHTML = `<code>${escapeHtml(codeSnippets[lang])}</code>`;
  }
}

function copyActiveCodeSnippet() {
  const code = codeSnippets[activeSnippetKey] || '';
  navigator.clipboard.writeText(code);
  showToast('Code snippet copied to clipboard!', 'success');
}

// Tab Navigation inside App Dashboard
function switchTab(tabId, updateUrl = true) {
  const actualPaneId = (tabId === 'workflows') ? 'pane-automations' : `pane-${tabId}`;

  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.getAttribute('data-tab') === tabId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  document.querySelectorAll('.tab-pane').forEach(el => {
    if (el.id === actualPaneId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  const titleMap = {
    dashboard: 'Dashboard Overview',
    device: 'WhatsApp Device Connection',
    projects: 'Projects & Custom API Gateways',
    automations: 'WhatsApp Automations Hub',
    workflows: 'Visual Workflow Builder',
    messages: 'Send & Receive Messages'
  };

  const titleEl = document.getElementById('pageHeaderTitle');
  if (titleEl && titleMap[tabId]) {
    titleEl.textContent = titleMap[tabId];
  }

  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('open');

  // Update browser URL
  if (updateUrl && tabId) {
    let targetUrl = `/${tabId}`;
    if (tabId === 'automations') {
      if (typeof activeAutomationsSubView !== 'undefined') {
        if (activeAutomationsSubView === 'manual') targetUrl = '/automations/manual';
        else if (activeAutomationsSubView === 'workflow') targetUrl = '/automations/workflow';
        else targetUrl = '/automations';
      }
    } else if (tabId === 'workflows') {
      targetUrl = '/automations/workflow';
    }

    if (window.location.pathname !== targetUrl) {
      history.pushState({ path: targetUrl, tab: tabId }, '', targetUrl);
    }
  }

  // Trigger tab-specific loaders
  if (tabId === 'dashboard') {
    fetchStatus();
    fetchDashboardLogs();
  }
  if (tabId === 'device') {
    if (typeof refreshDeviceStatus === 'function') refreshDeviceStatus();
  }
  if (tabId === 'projects') {
    loadProjects();
  }
  if (tabId === 'automations') {
    const currentPath = window.location.pathname;
    let targetSub = 'hub';
    if (currentPath === '/automations/manual') targetSub = 'manual';
    else if (currentPath === '/automations/workflow' || currentPath === '/automations/workflows' || currentPath === '/automations/visual' || currentPath === '/workflows') targetSub = 'workflow';
    else if (typeof activeAutomationsSubView !== 'undefined' && activeAutomationsSubView) targetSub = activeAutomationsSubView;

    if (typeof openAutomationsSubView === 'function') {
      openAutomationsSubView(targetSub, false);
    }
  }
  if (tabId === 'workflows') {
    if (typeof openAutomationsSubView === 'function') {
      openAutomationsSubView('workflow', false);
    }
  }
  if (tabId === 'messages') {
    loadProjects();
    loadLiveMessages();
  }
}

// Fetch Global Status
async function fetchStatus() {
  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch('/api/v1/status');
    const data = await res.json();
    if (data.success && data.data) {
      const { session, gateway, stats, recentLogs } = data.data;
      updateUIStatus(session, gateway, stats);
      if (recentLogs) renderDashboardLogs(recentLogs);
    }
  } catch (err) {
    console.error('Status fetch error:', err);
  }
}

function updateUIStatus(session, gateway, stats) {
  if (!session) return;

  const isConnected = session.status === 'connected';
  const isConnecting = session.status === 'connecting' || session.status === 'pairing';
  const isScanning = session.status === 'scanning';
  const isGenerating = session.status === 'generating_qr';

  // Global Header Status
  const dot = document.getElementById('globalStatusDot');
  const text = document.getElementById('globalStatusText');
  const navStatus = document.getElementById('deviceNavStatus');
  const dashPhone = document.getElementById('dashDevicePhone');

  if (dot && text) {
    dot.className = `status-dot ${session.status}`;
    if (isConnected) {
      const phoneDisplay = session.phone ? `+${session.phone}` : 'Connected';
      text.textContent = 'Connected';
      if (navStatus) { navStatus.textContent = 'ONLINE'; navStatus.classList.add('active'); }
      if (dashPhone) { dashPhone.innerHTML = `<span style="color: var(--success);"><i class="fa-solid fa-circle-check" style="margin-right: 6px;"></i>${phoneDisplay}</span>`; }
    } else if (isConnecting) {
      text.textContent = 'Connecting...';
      if (navStatus) { navStatus.textContent = 'CONNECTING'; navStatus.classList.remove('active'); }
      if (dashPhone) { dashPhone.innerHTML = `<span style="color: var(--warning);"><i class="fa-solid fa-spinner fa-spin" style="margin-right: 6px;"></i>Connecting...</span>`; }
    } else if (isScanning || isGenerating) {
      text.textContent = 'Scan QR Code';
      if (navStatus) { navStatus.textContent = 'READY'; navStatus.classList.remove('active'); }
      if (dashPhone) { dashPhone.innerHTML = `<span style="color: var(--warning);"><i class="fa-solid fa-qrcode" style="margin-right: 6px;"></i>Scan QR</span>`; }
    } else {
      text.textContent = 'Disconnected';
      if (navStatus) { navStatus.textContent = 'OFF'; navStatus.classList.remove('active'); }
      if (dashPhone) { dashPhone.textContent = 'Scanning Required'; }
    }
  }

  // Stats
  if (stats) {
    const rulesCount = document.getElementById('statActiveRules');
    const rulesBadge = document.getElementById('ruleCountBadge');
    if (rulesCount && stats.activeRules !== undefined) rulesCount.textContent = stats.activeRules;
    if (rulesBadge && stats.activeRules !== undefined) rulesBadge.textContent = stats.activeRules;

    const projCount = document.getElementById('statActiveProjects');
    const projBadge = document.getElementById('projectsNavCount');
    if (projCount && stats.totalProjects !== undefined) projCount.textContent = stats.totalProjects;
    if (projBadge && stats.totalProjects !== undefined) projBadge.textContent = stats.totalProjects;
  }

  // Device Page Elements
  const deviceDot = document.getElementById('deviceDot');
  const deviceTitle = document.getElementById('deviceStatusTitle');
  const devicePhone = document.getElementById('devicePhoneValue');
  const deviceName = document.getElementById('deviceNameValue');
  const btnGenQr = document.getElementById('btnGenQr');
  const btnDisconnect = document.getElementById('btnDisconnect');

  const qrImg = document.getElementById('qrImage');
  const qrPlaceholder = document.getElementById('qrPlaceholder');
  const qrLoader = document.getElementById('qrLoader');

  if (deviceDot && deviceTitle) {
    deviceDot.className = `status-dot ${session.status}`;
    if (isConnected) {
      deviceTitle.textContent = 'Connected & Active';
      if (devicePhone) devicePhone.textContent = session.phone ? `+${session.phone}` : 'Connected';
      if (deviceName) deviceName.textContent = session.displayName || 'WhatsApp Account';
      if (btnGenQr) btnGenQr.style.display = 'none';
      if (btnDisconnect) btnDisconnect.style.display = 'inline-flex';

      if (qrImg) qrImg.style.display = 'none';
      if (qrLoader) qrLoader.style.display = 'none';
      if (qrPlaceholder) {
        qrPlaceholder.style.display = 'block';
        qrPlaceholder.innerHTML = `
          <i class="fa-solid fa-circle-check" style="font-size: 48px; color: var(--success); margin-bottom: 12px;"></i>
          <h3 style="font-size: 16px; font-weight: 700; color: var(--text-primary);">WhatsApp Device Connected</h3>
          <p style="color: var(--text-secondary); font-size: 13px; margin-top: 4px;">+${session.phone || 'Device'}</p>
          <p style="color: var(--text-muted); font-size: 11px; margin-top: 6px;">Online & ready to process automations</p>
        `;
      }
    } else if (isConnecting) {
      deviceTitle.textContent = session.phone ? `Connecting (+${session.phone})...` : 'Connecting to WhatsApp...';
      if (devicePhone) devicePhone.textContent = session.phone ? `+${session.phone}` : 'Connecting...';
      if (deviceName) deviceName.textContent = session.displayName || 'WhatsApp Account';
      if (btnGenQr) btnGenQr.style.display = 'none';
      if (btnDisconnect) btnDisconnect.style.display = 'inline-flex';

      if (qrImg) qrImg.style.display = 'none';
      if (qrPlaceholder) qrPlaceholder.style.display = 'none';
      if (qrLoader) {
        qrLoader.style.display = 'flex';
        document.getElementById('qrLoaderText').textContent = 'Connecting with WhatsApp socket...';
      }
    } else if (session.qrCode) {
      deviceTitle.textContent = 'Ready for QR Scan';
      if (devicePhone) devicePhone.textContent = 'Waiting for scan...';
      if (deviceName) deviceName.textContent = 'None';
      if (btnGenQr) btnGenQr.style.display = 'inline-flex';
      if (btnDisconnect) btnDisconnect.style.display = 'none';

      if (qrPlaceholder) qrPlaceholder.style.display = 'none';
      if (qrLoader) qrLoader.style.display = 'none';
      if (qrImg) {
        qrImg.src = session.qrCode;
        qrImg.style.display = 'block';
      }
    } else if (isGenerating) {
      deviceTitle.textContent = 'Generating QR Code...';
      if (btnGenQr) btnGenQr.style.display = 'inline-flex';
      if (btnDisconnect) btnDisconnect.style.display = 'none';

      if (qrImg) qrImg.style.display = 'none';
      if (qrPlaceholder) qrPlaceholder.style.display = 'none';
      if (qrLoader) {
        qrLoader.style.display = 'flex';
        document.getElementById('qrLoaderText').textContent = 'Booting WhatsApp Multi-Device session...';
      }
    } else {
      deviceTitle.textContent = 'Disconnected';
      if (devicePhone) devicePhone.textContent = 'None';
      if (deviceName) deviceName.textContent = 'None';
      if (btnGenQr) btnGenQr.style.display = 'inline-flex';
      if (btnDisconnect) btnDisconnect.style.display = 'none';

      if (qrImg) qrImg.style.display = 'none';
      if (qrLoader) qrLoader.style.display = 'none';
      if (qrPlaceholder) {
        qrPlaceholder.style.display = 'block';
        qrPlaceholder.innerHTML = `
          <i class="fa-solid fa-qrcode fa-3x" style="color: var(--text-muted); margin-bottom: 12px;"></i>
          <p>Click "Generate QR Code" to link your WhatsApp account.</p>
        `;
      }
    }
  }
}

// Generate QR Code Action
async function generateQrCode(fresh = true) {
  showToast('Generating WhatsApp QR Code...');
  
  const qrImg = document.getElementById('qrImage');
  const qrPlaceholder = document.getElementById('qrPlaceholder');
  const qrLoader = document.getElementById('qrLoader');

  if (qrImg) qrImg.style.display = 'none';
  if (qrPlaceholder) qrPlaceholder.style.display = 'none';
  if (qrLoader) {
    qrLoader.style.display = 'flex';
    document.getElementById('qrLoaderText').textContent = 'Starting multi-device socket...';
  }

  try {
    const safeFetch = window.authFetch || fetch;
    await safeFetch('/api/v1/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fresh })
    });

    startContinuousPolling();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// Disconnect Device Action
async function disconnectDevice() {
  if (!confirm('Disconnect WhatsApp device and remove linked session?')) return;
  if (qrPollTimer) clearInterval(qrPollTimer);

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch('/api/v1/session/disconnect', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      showToast('Device disconnected.');
      fetchStatus();
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// Polling for QR / Pairing
function startContinuousPolling() {
  if (qrPollTimer) clearInterval(qrPollTimer);
  let attempts = 0;

  qrPollTimer = setInterval(async () => {
    attempts++;
    try {
      const safeFetch = window.authFetch || fetch;
      const res = await safeFetch('/api/v1/session/qr');
      const data = await res.json();
      if (data.success && data.data) {
        updateUIStatus(data.data, {}, {});
        if (data.data.status === 'connected') {
          clearInterval(qrPollTimer);
          qrPollTimer = null;
          fetchStatus();
          showToast(`🎉 Device Linked: +${data.data.phone || 'WhatsApp'}`);
        }
      }
    } catch (e) {}

    if (attempts > 120) {
      clearInterval(qrPollTimer);
      qrPollTimer = null;
    }
  }, 1500);
}

function renderDashboardLogsSkeleton() {
  const tbody = document.getElementById('dashLogsTable');
  if (!tbody) return;

  tbody.innerHTML = Array(4).fill(0).map(() => `
    <tr class="skeleton-table-row">
      <td style="width: 25%;"><div class="skeleton skeleton-row-line" style="width: 50px;"></div></td>
      <td style="width: 50%;"><div class="skeleton skeleton-row-line" style="width: 140px;"></div></td>
      <td style="width: 25%;"><div class="skeleton skeleton-pill" style="width: 55px; height: 16px;"></div></td>
    </tr>
  `).join('');
}

// Fetch & Render Dashboard Logs
async function fetchDashboardLogs() {
  const tbody = document.getElementById('dashLogsTable');
  if (tbody && (tbody.children.length === 0 || tbody.innerText.includes('No recent'))) {
    renderDashboardLogsSkeleton();
  }

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch('/api/v1/logs?limit=8');
    const data = await res.json();
    if (data.success && data.data) {
      renderDashboardLogs(data.data);
    }
  } catch (err) {
    console.error('Failed to fetch dashboard logs:', err);
  }
}

function renderDashboardLogs(logs) {
  const tbody = document.getElementById('dashLogsTable');
  if (!tbody) return;

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center" style="color: var(--text-muted); padding: 16px;">No recent activity logs.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    let badgeClass = 'badge badge-exact';
    if (log.level === 'trigger') badgeClass = 'badge badge-contains';
    if (log.level === 'error') badgeClass = 'badge badge-disabled';

    const timeStr = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return `
      <tr>
        <td style="color: var(--text-muted); font-family: var(--font-mono); font-size: 11px;">${timeStr}</td>
        <td style="font-weight: 600; color: var(--text-primary);">${escapeHtml(log.event_name)}</td>
        <td style="text-align: right; padding-right: 20px;"><span class="${badgeClass}">${(log.level || 'info').toUpperCase()}</span></td>
      </tr>
    `;
  }).join('');
}

async function clearDashboardLogs() {
  if (!confirm('Are you sure you want to clear all activity logs?')) return;

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch('/api/v1/logs', { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Activity logs cleared successfully.', 'success');
      fetchDashboardLogs();
    } else {
      showToast(data.error || 'Failed to clear logs.', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// Toast Notifications
function showToast(message, type = 'info') {
  let container = null;
  const isWfFs = document.fullscreenElement || document.querySelector('.wf-canvas-container.wf-is-fullscreen');
  if (isWfFs) {
    container = document.getElementById('wfToastContainer') || (document.fullscreenElement ? document.fullscreenElement.querySelector('.toast-container') : null);
  }
  if (!container) {
    container = document.getElementById('toastContainer');
  }
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'error' ? '<i class="fa-solid fa-triangle-exclamation"></i>' : (type === 'success' ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-circle-info"></i>');
  toast.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// Theme Management
function initTheme() {
  const saved = localStorage.getItem('whatsflow_theme') || 'dark';
  applyTheme(saved);

  const toggleBtn = document.getElementById('themeToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleCurrentTheme);
  }

  const landingToggle = document.getElementById('landingThemeToggle');
  if (landingToggle) {
    landingToggle.addEventListener('click', toggleCurrentTheme);
  }
}

function toggleCurrentTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('whatsflow_theme', next);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const label = document.getElementById('themeLabel');
  const icon = document.getElementById('themeIcon');
  const landingIcon = document.getElementById('landingThemeIcon');

  if (label) label.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  if (icon) {
    icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
  if (landingIcon) {
    landingIcon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
}

// Sidebar Collapse Management (Desktop Rail Mode)
function initSidebarCollapse() {
  const isCollapsed = localStorage.getItem('whatsflow_sidebar_collapsed') === 'true';
  applySidebarCollapse(isCollapsed);

  // Keyboard shortcut: Ctrl+B or Cmd+B to toggle sidebar collapse
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      const appView = document.getElementById('appView');
      if (appView && appView.style.display !== 'none') {
        e.preventDefault();
        toggleSidebarCollapse();
      }
    }
  });
}

function toggleSidebarCollapse(forceState) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const willCollapse = typeof forceState === 'boolean' ? forceState : !sidebar.classList.contains('collapsed');
  applySidebarCollapse(willCollapse);
  localStorage.setItem('whatsflow_sidebar_collapsed', willCollapse ? 'true' : 'false');
}

function applySidebarCollapse(collapsed) {
  const sidebar = document.getElementById('sidebar');
  const icon = document.getElementById('sidebarCollapseIcon');
  const btn = document.getElementById('sidebarCollapseBtn');
  if (!sidebar) return;

  if (collapsed) {
    sidebar.classList.add('collapsed');
    if (icon) icon.className = 'fa-solid fa-chevron-right';
    if (btn) btn.title = 'Expand sidebar (Ctrl+B)';
  } else {
    sidebar.classList.remove('collapsed');
    if (icon) icon.className = 'fa-solid fa-chevron-left';
    if (btn) btn.title = 'Collapse sidebar (Ctrl+B)';
  }
}

function handleSidebarUserClick(e) {
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('collapsed')) {
    if (confirm('Do you want to log out of your account?')) {
      Auth.logout();
    }
  }
}

// Helper: Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSidebarCollapse();
  Auth.init();
  Router.init();
  fetchStatus();
  fetchDashboardLogs();
  loadProjects();
  loadAutomations();

  // Tab click listeners
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = el.getAttribute('data-tab');
      if (tabId) {
        Router.navigate(`/${tabId}`, true);
      }
    });
  });

  // Mobile drawer toggle
  const mobileBtn = document.getElementById('mobileMenuToggle');
  if (mobileBtn) {
    mobileBtn.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });
  }

  // Socket Events
  if (window.socketClient) {
    window.socketClient.on('status', (data) => {
      if (data) updateUIStatus(data, {}, {});
      fetchStatus();
    });
    window.socketClient.on('qr', (data) => {
      if (data && data.qrCode) {
        const qrImg = document.getElementById('qrImage');
        const qrPlaceholder = document.getElementById('qrPlaceholder');
        const qrLoader = document.getElementById('qrLoader');
        if (qrImg) { qrImg.src = data.qrCode; qrImg.style.display = 'block'; }
        if (qrPlaceholder) qrPlaceholder.style.display = 'none';
        if (qrLoader) qrLoader.style.display = 'none';
      }
    });
    window.socketClient.on('message_sent', () => {
      fetchDashboardLogs();
      if (typeof loadLiveMessages === 'function') loadLiveMessages();
    });
    window.socketClient.on('message_received', () => {
      fetchDashboardLogs();
      if (typeof loadLiveMessages === 'function') loadLiveMessages();
    });
  }

  // Dynamic Landing Header Scrolled Effect
  const landingHeader = document.getElementById('landingHeader');
  if (landingHeader) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 20) {
        landingHeader.classList.add('scrolled');
      } else {
        landingHeader.classList.remove('scrolled');
      }
    }, { passive: true });
  }

  // Polling fallback
  setInterval(fetchStatus, 5000);
});
