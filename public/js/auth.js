/**
 * WhatsFlow Authentication & Session Manager
 */

const Auth = {
  token: localStorage.getItem('whatsflow_token') || null,
  user: null,

  init() {
    try {
      const storedUser = localStorage.getItem('whatsflow_user');
      if (storedUser) {
        this.user = JSON.parse(storedUser);
      }
    } catch (e) {}

    this.renderUserWidget();
    this.verifySession();

    // Auto-route on initial page load: preserve current pathname if valid
    const currentPath = window.location.pathname;
    if (this.token && this.user) {
      if (currentPath && currentPath !== '/' && currentPath !== '/home') {
        Router.navigate(currentPath, false);
      } else {
        Router.navigate('/dashboard', false);
      }
    } else {
      if (currentPath && currentPath !== '/' && currentPath !== '/home') {
        Router.navigate(currentPath, false);
      } else {
        showLandingView(false);
      }
    }
  },

  async verifySession() {
    if (!this.token) {
      this.renderUserWidget();
      return;
    }

    try {
      const res = await fetch('/api/v1/auth/me', {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      const data = await res.json();
      if (data.success && data.data) {
        this.user = data.data;
        localStorage.setItem('whatsflow_user', JSON.stringify(this.user));
        this.renderUserWidget();
      } else {
        // Invalid or expired token
        this.logout(false);
      }
    } catch (e) {
      console.warn('[Auth] Session check notice:', e.message);
    }
  },

  renderUserWidget() {
    const sidebarCard = document.getElementById('sidebarUserCard');
    const headerProfile = document.getElementById('headerProfileAvatar');
    const headerAuthBtn = document.getElementById('headerAuthBtn');
    const landingMounted = document.getElementById('landingAuthMounted');

    const firstLetter = (this.user?.name || this.user?.email || 'U').charAt(0).toUpperCase();

    if (this.user) {
      // 1. Sidebar User Profile with Logout Button
      if (sidebarCard) {
        sidebarCard.style.display = 'flex';
        const nameEl = document.getElementById('sidebarUserName');
        const emailEl = document.getElementById('sidebarUserEmail');
        const avatarEl = document.getElementById('sidebarUserAvatar');
        if (nameEl) nameEl.textContent = this.user.name || 'User';
        if (emailEl) emailEl.textContent = this.user.email || '';
        if (avatarEl) avatarEl.textContent = firstLetter;
      }

      // 2. Top Header Round Profile Avatar Icon
      if (headerProfile) {
        headerProfile.style.display = 'flex';
        headerProfile.title = `${this.user.name || 'Account'} (${this.user.email || ''})`;
        const headerAvatar = document.getElementById('headerUserAvatar');
        if (headerAvatar) headerAvatar.textContent = firstLetter;
      }

      if (headerAuthBtn) headerAuthBtn.style.display = 'none';

      // 3. Landing Header CTA (Go to Dashboard)
      if (landingMounted) {
        landingMounted.innerHTML = `
          <button class="btn btn-primary btn-sm" onclick="showAppView('dashboard')">
            <i class="fa-solid fa-gauge-high"></i> Dashboard
          </button>
        `;
      }

      const mobileAction = document.getElementById('mobileMenuAuthAction');
      if (mobileAction) {
        mobileAction.innerHTML = `
          <button class="btn btn-primary btn-sm" style="width: 100%;" onclick="showAppView('dashboard'); toggleLandingMobileMenu(false);">
            <i class="fa-solid fa-gauge-high"></i> Open Dashboard
          </button>
        `;
      }
    } else {
      if (sidebarCard) sidebarCard.style.display = 'none';
      if (headerProfile) headerProfile.style.display = 'none';
      if (headerAuthBtn) headerAuthBtn.style.display = 'inline-flex';

      if (landingMounted) {
        landingMounted.innerHTML = `
          <button class="btn btn-primary btn-sm" onclick="openAuthModal('register')">Get Started</button>
        `;
      }

      const mobileAction = document.getElementById('mobileMenuAuthAction');
      if (mobileAction) {
        mobileAction.innerHTML = `
          <button class="btn btn-primary btn-sm" style="width: 100%;" onclick="openAuthModal('register'); toggleLandingMobileMenu(false);">
            <i class="fa-solid fa-arrow-right"></i> Get Started Free
          </button>
        `;
      }
    }
  },

  async login(email, password) {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Login failed.');

    this.token = result.data.token;
    this.user = result.data.user;
    localStorage.setItem('whatsflow_token', this.token);
    localStorage.setItem('whatsflow_user', JSON.stringify(this.user));
    this.renderUserWidget();
    return result;
  },

  async register(name, email, password) {
    const res = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Registration failed.');

    this.token = result.data.token;
    this.user = result.data.user;
    localStorage.setItem('whatsflow_token', this.token);
    localStorage.setItem('whatsflow_user', JSON.stringify(this.user));
    this.renderUserWidget();
    return result;
  },

  async forgotPassword(email, newPassword) {
    const res = await fetch('/api/v1/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, newPassword })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Reset failed.');
    return result;
  },

  logout(showNotify = true) {
    this.token = null;
    this.user = null;
    localStorage.removeItem('whatsflow_token');
    localStorage.removeItem('whatsflow_user');
    this.renderUserWidget();
    if (showNotify) showToast('Logged out. Redirecting to home...', 'info');
    if (typeof Router !== 'undefined' && Router.navigate) {
      Router.navigate('/', true);
    } else {
      showLandingView();
    }
  }
};

/**
 * Universal authenticated fetch helper that automatically attaches
 * the Authorization header and handles 401 unauthenticated session expiry.
 */
async function authFetch(url, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (Auth && Auth.token) {
    headers['Authorization'] = `Bearer ${Auth.token}`;
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    if (Auth && Auth.token) {
      console.warn('[Auth] Token expired or unauthorized.');
      Auth.logout(false);
      if (typeof openAuthModal === 'function') openAuthModal('login');
      if (typeof showToast === 'function') showToast('Session expired. Please sign in again.', 'info');
    }
  }
  return response;
}

window.authFetch = authFetch;

// Modal & Form Handlers
function openAuthModal(mode = 'login') {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.add('active');
  switchAuthTab(mode);
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('active');
}

function switchAuthTab(mode) {
  const loginForm = document.getElementById('authLoginForm');
  const registerForm = document.getElementById('authRegisterForm');
  const forgotForm = document.getElementById('authForgotForm');
  const tabLogin = document.getElementById('tabAuthLogin');
  const tabRegister = document.getElementById('tabAuthRegister');

  if (loginForm) loginForm.style.display = mode === 'login' ? 'block' : 'none';
  if (registerForm) registerForm.style.display = mode === 'register' ? 'block' : 'none';
  if (forgotForm) forgotForm.style.display = mode === 'forgot' ? 'block' : 'none';

  if (tabLogin) tabLogin.classList.toggle('active', mode === 'login');
  if (tabRegister) tabRegister.classList.toggle('active', mode === 'register');
}

// Attach Form Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Login form submit
  const loginForm = document.getElementById('authLoginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmailInput').value;
      const pass = document.getElementById('loginPassInput').value;
      const btn = loginForm.querySelector('button[type="submit"]');

      try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Signing in...';
        await Auth.login(email, pass);
        showToast('Welcome back! Redirecting to Dashboard...', 'success');
        loginForm.reset();
        closeAuthModal();

        // Clear any lingering search inputs
        const searchInput = document.getElementById('automationSearchInput');
        if (searchInput) searchInput.value = '';
        if (typeof clearAutomationSearch === 'function') clearAutomationSearch();

        if (typeof Router !== 'undefined' && Router.navigate) {
          Router.navigate('/dashboard', true);
        } else {
          showAppView('dashboard');
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Sign In';
      }
    });
  }

  // Register form submit
  const registerForm = document.getElementById('authRegisterForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('registerNameInput').value;
      const email = document.getElementById('registerEmailInput').value;
      const pass = document.getElementById('registerPassInput').value;
      const btn = registerForm.querySelector('button[type="submit"]');

      try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Creating account...';
        await Auth.register(name, email, pass);
        showToast('Account created! Redirecting to Dashboard...', 'success');
        registerForm.reset();
        closeAuthModal();

        // Clear any lingering search inputs
        const searchInput = document.getElementById('automationSearchInput');
        if (searchInput) searchInput.value = '';
        if (typeof clearAutomationSearch === 'function') clearAutomationSearch();

        if (typeof Router !== 'undefined' && Router.navigate) {
          Router.navigate('/dashboard', true);
        } else {
          showAppView('dashboard');
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Create Account';
      }
    });
  }

  // Forgot password form submit
  const forgotForm = document.getElementById('authForgotForm');
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgotEmailInput').value;
      const newPass = document.getElementById('forgotNewPassInput').value;
      const btn = forgotForm.querySelector('button[type="submit"]');

      try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Updating password...';
        await Auth.forgotPassword(email, newPass);
        showToast('Password updated! You can now log in.', 'success');
        switchAuthTab('login');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Set New Password';
      }
    });
  }
});
