const express = require('express');
const router = express.Router();
const db = require('../db/db');
const whatsappManager = require('../whatsapp/manager');
const config = require('../config');
const { authLimiter, messageDispatchLimiter, apiGeneralLimiter } = require('../middleware/rateLimiter');

// Apply general API rate limiter to all routes
router.use(apiGeneralLimiter);

// ================= AUTHENTICATION & AUTHORIZATION MIDDLEWARES =================

/**
 * Require a valid User Session Token OR Master API Key for Administrative / Dashboard endpoints.
 */
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const xApiKey = req.headers['x-api-key'] || '';
    let token = '';

    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (authHeader) {
      token = authHeader.trim();
    } else if (xApiKey) {
      token = xApiKey.trim();
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please log in or provide a valid Authorization header.'
      });
    }

    // 1. Check if token is a Signed User Session Token
    if (token.startsWith('wf_tok_')) {
      const payload = db.verifyAuthToken(token);
      if (payload && payload.id) {
        const user = await db.getUserById(payload.id);
        if (user) {
          const { password_hash, ...safeUser } = user;
          req.user = safeUser;
          return next();
        }
      }
    }

    // 2. Check if token matches Master API Key
    const masterApiKey = await db.getSetting('api_key', config.apiKey);
    if (masterApiKey && db.timingSafeEqualString(token, masterApiKey)) {
      req.user = { id: 'usr_master_key', role: 'admin', isMasterApiKey: true };
      return next();
    }

    return res.status(401).json({
      success: false,
      error: 'Invalid or expired authentication credentials.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Authentication error occurred.' });
  }
};

/**
 * Auth middleware for API Gateway message dispatch endpoints.
 * Accepts either a Project-specific API Key OR the Master API Key.
 * Constant-time key comparison prevents timing side-channel attacks.
 */
const requireApiKey = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const xApiKey = req.headers['x-api-key'] || '';
    const headerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : (authHeader ? authHeader.trim() : null);
    const queryKey = req.query.api_key ? String(req.query.api_key).trim() : null;
    const bodyKey = req.body?.api_key ? String(req.body.api_key).trim() : null;
    const providedKey = headerKey || xApiKey || queryKey || bodyKey;

    if (!providedKey) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Missing API Key. Pass your project API Key in the Authorization: Bearer header.'
      });
    }

    // 1. Check Master API Key (Constant-time comparison)
    const masterApiKey = await db.getSetting('api_key', config.apiKey);
    const isMaster = masterApiKey && db.timingSafeEqualString(providedKey, masterApiKey);

    // 2. Check Project-specific API Key
    const matchingProject = await db.getProjectByApiKey(providedKey);

    if (!isMaster && !matchingProject) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized. Invalid API Key provided.'
      });
    }

    req.project = matchingProject || null;
    req.isMaster = isMaster;
    next();
  } catch (err) {
    return res.status(500).json({ success: false, error: 'API Gateway authentication error.' });
  }
};

// ================= AUTHENTICATION ROUTES =================
router.post('/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }

    const user = await db.createUser({ email: cleanEmail, password: String(password), name: String(name || '').trim() });
    const token = db.generateAuthToken(user);

    await db.addLog('info', 'User Registered', { email: user.email, name: user.name });

    res.json({
      success: true,
      message: 'Account created successfully.',
      data: {
        token,
        user
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || 'Registration failed.' });
  }
});

router.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const user = await db.verifyUserLogin(cleanEmail, String(password));
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email address or password.' });
    }

    const token = db.generateAuthToken(user);

    await db.addLog('info', 'User Logged In', { email: user.email });

    res.json({
      success: true,
      message: 'Login successful.',
      data: {
        token,
        user
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'An unexpected login error occurred.' });
  }
});

router.post('/auth/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email, newPassword, master_key } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email address is required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const user = await db.getUserByEmail(cleanEmail);

    // If caller provided Master API key via header or body, allow admin reset
    const authHeader = req.headers.authorization || '';
    const headerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    const masterApiKey = await db.getSetting('api_key', config.apiKey);
    const isMasterAuthorized = (headerKey && masterApiKey && db.timingSafeEqualString(headerKey, masterApiKey)) ||
                               (master_key && masterApiKey && db.timingSafeEqualString(String(master_key).trim(), masterApiKey));

    if (isMasterAuthorized && user && newPassword && String(newPassword).length >= 6) {
      await db.resetUserPassword(cleanEmail, String(newPassword));
      await db.addLog('info', 'Password Reset by Administrator', { email: cleanEmail });
      return res.json({
        success: true,
        message: 'Password reset successfully with administrator authorization.'
      });
    }

    // Always return safe ambiguous message to prevent account enumeration / unauthenticated ATO
    res.json({
      success: true,
      message: 'If an account exists with this email, password update instructions have been processed.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'An error occurred while processing password reset.' });
  }
});

router.post('/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required.' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });
    }

    if (!req.user || !req.user.email) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const verifiedUser = await db.verifyUserLogin(req.user.email, String(currentPassword));
    if (!verifiedUser) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
    }

    await db.resetUserPassword(req.user.email, String(newPassword));
    await db.addLog('info', 'User Password Changed', { email: req.user.email });

    res.json({
      success: true,
      message: 'Password updated successfully.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update password.' });
  }
});

router.get('/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer wf_tok_')) {
      const token = authHeader.slice(7).trim();
      const payload = db.verifyAuthToken(token);
      if (payload && payload.id) {
        const user = await db.getUserById(payload.id);
        if (user) {
          const { password_hash, ...safeUser } = user;
          return res.json({ success: true, data: safeUser });
        }
      }
    }

    // Unauthenticated request
    return res.status(401).json({ success: false, data: null, error: 'Not authenticated.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to verify session.' });
  }
});

// ================= PROJECTS MANAGEMENT (PROTECTED) =================
router.get('/projects', requireAuth, async (req, res) => {
  try {
    const projects = await db.getProjects();
    const host = `${req.protocol}://${req.get('host')}`;
    const formatted = await Promise.all(projects.map(async p => {
      const automations = await db.getAutomations(p.id);
      return {
        ...p,
        automationsCount: automations.length,
        endpoint: `${host}/api/v1/projects/${p.id}/send-message`,
        universalEndpoint: `${host}/api/v1/send-message`
      };
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch projects.' });
  }
});

router.get('/projects/:id', requireAuth, async (req, res) => {
  try {
    const project = await db.getProject(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });

    const host = `${req.protocol}://${req.get('host')}`;
    const automations = await db.getAutomations(project.id);

    res.json({
      success: true,
      data: {
        ...project,
        automations,
        endpoint: `${host}/api/v1/projects/${project.id}/send-message`,
        universalEndpoint: `${host}/api/v1/send-message`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch project.' });
  }
});

router.post('/projects', requireAuth, async (req, res) => {
  try {
    const { name, webhook_url } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Project name is required.' });
    }
    const created = await db.createProject({
      name: String(name).trim().slice(0, 100),
      webhook_url: webhook_url ? String(webhook_url).trim().slice(0, 500) : ''
    });
    const host = `${req.protocol}://${req.get('host')}`;
    await db.addLog('info', 'New Project Created', { name: created.name, id: created.id }, created.id);
    res.json({
      success: true,
      data: {
        ...created,
        automationsCount: 0,
        endpoint: `${host}/api/v1/projects/${created.id}/send-message`,
        universalEndpoint: `${host}/api/v1/send-message`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to create project.' });
  }
});

router.put('/projects/:id', requireAuth, async (req, res) => {
  try {
    const { name, webhook_url, is_active } = req.body || {};
    const updated = await db.updateProject(req.params.id, {
      ...(name ? { name: String(name).trim().slice(0, 100) } : {}),
      ...(webhook_url !== undefined ? { webhook_url: String(webhook_url).trim().slice(0, 500) } : {}),
      ...(is_active !== undefined ? { is_active: is_active ? 1 : 0 } : {})
    });
    if (!updated) return res.status(404).json({ success: false, error: 'Project not found.' });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update project.' });
  }
});

router.delete('/projects/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteProject(req.params.id);
    await db.addLog('info', 'Project Deleted', { id: req.params.id });
    res.json({ success: true, message: 'Project deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete project.' });
  }
});

// Dedicated Project Send Message Endpoint (Public API Gateway with Project API Key)
router.post('/projects/:id/send-message', messageDispatchLimiter, requireApiKey, async (req, res) => {
  try {
    const { to, message, text } = req.body || {};
    const destination = to;
    const content = message || text;

    if (!destination || !content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters. Required: { "to": "+8801XXXXXXXXX", "message": "Your text here" }'
      });
    }

    // Cross-Tenant Authorization Guard: Project API Key must match target Project ID (unless Master API Key is used)
    if (!req.isMaster && req.project && String(req.project.id) !== String(req.params.id)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden. The provided API Key does not have permission to dispatch messages for this project.'
      });
    }

    const cleanTo = String(destination).replace(/[^0-9]/g, '');
    if (cleanTo.length < 8 || cleanTo.length > 20) {
      return res.status(400).json({ success: false, error: 'Invalid destination phone number format.' });
    }

    const safeContent = String(content).slice(0, 4096);
    const projectName = req.project ? req.project.name : req.params.id;
    const result = await whatsappManager.sendMessage(cleanTo, safeContent, `Project API (${projectName})`);

    await db.addLog('trigger', 'Project Message Dispatched', {
      projectId: req.params.id,
      to: cleanTo,
      preview: safeContent.slice(0, 50)
    }, req.params.id);

    res.json({
      success: true,
      message: 'WhatsApp message queued and dispatched successfully.',
      data: {
        to: cleanTo,
        messageId: result?.key?.id || `msg_${Date.now()}`,
        status: 'sent',
        project: req.project ? req.project.name : req.params.id,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to dispatch message.' });
  }
});

// Project-Specific Automations (Protected)
router.get('/projects/:id/automations', requireAuth, async (req, res) => {
  try {
    const automations = await db.getAutomations(req.params.id);
    res.json({ success: true, data: automations });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch project automations.' });
  }
});

router.post('/projects/:id/automations', requireAuth, async (req, res) => {
  try {
    const { name, trigger_type, trigger_value, response_type, response_content, is_active } = req.body || {};
    if (!trigger_value || !response_content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: trigger_value and response_content are required.'
      });
    }

    const newRule = await db.createAutomation({
      project_id: req.params.id,
      name: String(name || `Rule: ${trigger_value}`).slice(0, 100),
      trigger_type: trigger_type || 'exact',
      trigger_value: String(trigger_value).slice(0, 255),
      response_type: response_type || 'text',
      response_content: String(response_content).slice(0, 4096),
      is_active: is_active !== undefined ? (is_active ? 1 : 0) : 1
    });

    await db.addLog('info', 'Project Automation Created', { ruleId: newRule.id, name: newRule.name }, req.params.id);
    res.json({ success: true, data: newRule });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to create automation.' });
  }
});

// ================= GLOBAL AUTOMATIONS ROUTE (PROTECTED) =================
router.get('/automations', requireAuth, async (req, res) => {
  try {
    const projectId = req.query.project_id ? String(req.query.project_id) : null;
    const automations = await db.getAutomations(projectId);
    res.json({ success: true, data: automations });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch automations.' });
  }
});

router.post('/automations', requireAuth, async (req, res) => {
  try {
    const { project_id, name, trigger_type, trigger_value, response_type, response_content, is_active } = req.body || {};
    if (!trigger_value || !response_content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: trigger_value and response_content are required.'
      });
    }

    const newRule = await db.createAutomation({
      project_id: project_id || null,
      name: String(name || `Rule: ${trigger_value}`).slice(0, 100),
      trigger_type: trigger_type || 'exact',
      trigger_value: String(trigger_value).slice(0, 255),
      response_type: response_type || 'text',
      response_content: String(response_content).slice(0, 4096),
      is_active: is_active !== undefined ? (is_active ? 1 : 0) : 1
    });

    await db.addLog('info', 'Automation Rule Created', { ruleId: newRule.id, name: newRule.name });
    res.json({ success: true, data: newRule });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to create automation rule.' });
  }
});

router.put('/automations/:id', requireAuth, async (req, res) => {
  try {
    const updated = await db.updateAutomation(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ success: false, error: 'Rule not found.' });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update automation.' });
  }
});

router.delete('/automations/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteAutomation(req.params.id);
    await db.addLog('info', 'Automation Rule Deleted', { ruleId: req.params.id });
    res.json({ success: true, message: 'Automation deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete automation.' });
  }
});

// ================= VISUAL WORKFLOW ROUTES (PROTECTED) =================
router.get('/workflows', requireAuth, async (req, res) => {
  try {
    const projectId = req.query.project_id ? String(req.query.project_id) : null;
    const workflows = await db.getWorkflows(projectId);
    res.json({ success: true, data: workflows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch workflows.' });
  }
});

router.get('/workflows/:id', requireAuth, async (req, res) => {
  try {
    const workflow = await db.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, error: 'Workflow not found.' });
    res.json({ success: true, data: workflow });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch workflow.' });
  }
});

router.post('/workflows', requireAuth, async (req, res) => {
  try {
    const { name, description, project_id, is_active, nodes, edges, settings, id } = req.body || {};
    if (!name) return res.status(400).json({ success: false, error: 'Workflow name is required.' });

    if (settings?.ai_api_key && typeof settings.ai_api_key === 'string' && settings.ai_api_key.trim()) {
      const keyVal = settings.ai_api_key.trim();
      await db.setSetting('ai_api_key', keyVal);
      if (keyVal.startsWith('gsk_')) {
        await db.setSetting('groq_api_key', keyVal);
      }
    }

    const newWorkflow = await db.createWorkflow({
      id,
      name,
      description,
      project_id,
      is_active,
      nodes,
      edges,
      settings
    });

    await db.addLog('info', 'Visual Workflow Created', { id: newWorkflow.id, name: newWorkflow.name });
    res.json({ success: true, data: newWorkflow });
  } catch (err) {
    console.error('[API] Workflow create error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to create workflow.' });
  }
});

router.put('/workflows/:id', requireAuth, async (req, res) => {
  try {
    const { settings } = req.body || {};
    if (settings?.ai_api_key && typeof settings.ai_api_key === 'string' && settings.ai_api_key.trim()) {
      const keyVal = settings.ai_api_key.trim();
      await db.setSetting('ai_api_key', keyVal);
      if (keyVal.startsWith('gsk_')) {
        await db.setSetting('groq_api_key', keyVal);
      }
    }

    let updated = await db.updateWorkflow(req.params.id, req.body || {});
    if (!updated) {
      updated = await db.createWorkflow({ id: req.params.id, ...(req.body || {}) });
    }
    await db.addLog('info', 'Visual Workflow Updated', { id: req.params.id, name: updated.name });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[API] Workflow update error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to update workflow.' });
  }
});

router.delete('/workflows/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteWorkflow(req.params.id);
    await db.addLog('info', 'Visual Workflow Deleted', { id: req.params.id });
    res.json({ success: true, message: 'Workflow deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete workflow.' });
  }
});

// Test / Simulate Workflow Execution
router.post('/workflows/:id/test', requireAuth, async (req, res) => {
  try {
    let workflow = await db.getWorkflow(req.params.id);
    // If testing unsaved draft directly from canvas
    if (req.body?.nodes) {
      workflow = {
        id: req.params.id || 'draft',
        name: req.body.name || 'Draft Workflow',
        nodes: req.body.nodes,
        edges: req.body.edges,
        settings: req.body.settings || {}
      };
    }

    if (!workflow) return res.status(404).json({ success: false, error: 'Workflow not found.' });

    const mockMessage = {
      from: req.body?.from || '+8801700000000',
      pushName: req.body?.pushName || 'Tester',
      text: req.body?.text || 'Hello'
    };

    const workflowRunner = require('../engine/workflowRunner');
    const result = await workflowRunner.execute(workflow, mockMessage);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Workflow test simulation failed.' });
  }
});

// ================= WHATSAPP SESSION CONTROLS (PROTECTED) =================
router.post('/session/start', requireAuth, async (req, res) => {
  try {
    const fresh = Boolean(req.body?.fresh);
    const session = await whatsappManager.startSession(fresh);
    res.json({ success: true, data: session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to start session.' });
  }
});

router.get('/session/qr', requireAuth, async (req, res) => {
  try {
    const session = whatsappManager.getStatus();
    res.json({ success: true, data: session });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get session status.' });
  }
});

router.post('/session/pair-code', requireAuth, async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required.' });
    const code = await whatsappManager.requestPairingCode(String(phone));
    res.json({ success: true, data: { pairingCode: code } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to request pairing code.' });
  }
});

router.post('/session/disconnect', requireAuth, async (req, res) => {
  try {
    await whatsappManager.disconnect();
    res.json({ success: true, message: 'Session disconnected and reset.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to disconnect session.' });
  }
});

// ================= SYSTEM STATUS & SETTINGS (PROTECTED) =================
router.get('/status', requireAuth, async (req, res) => {
  try {
    const session = whatsappManager.getStatus();
    const settings = await db.getSettings();
    const automations = await db.getAutomations();
    const projects = await db.getProjects();
    const logs = await db.getLogs(10);
    const host = `${req.protocol}://${req.get('host')}`;

    res.json({
      success: true,
      data: {
        session,
        gateway: {
          endpoint: `${host}/api/v1/send-message`,
          apiKey: settings.api_key || config.apiKey,
          webhookUrl: settings.webhook_url || '',
          quickbiteUrl: settings.quickbite_url || config.quickbiteSiteUrl
        },
        stats: {
          activeRules: automations.filter(a => Number(a.is_active) === 1).length,
          totalRules: automations.length,
          totalProjects: projects.length,
          botEnabled: settings.bot_enabled !== '0'
        },
        recentLogs: logs
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch system status.' });
  }
});

router.get('/settings', requireAuth, async (req, res) => {
  try {
    const settings = await db.getSettings();
    // Mask sensitive API keys partially in response if desired, or return clean settings
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch settings.' });
  }
});

router.put('/settings', requireAuth, async (req, res) => {
  try {
    const safeSettings = {};
    const allowedKeys = [
      'api_key', 'webhook_url', 'webhook_secret', 'bot_enabled',
      'ai_enabled', 'ai_api_key', 'ai_model', 'default_fallback_reply', 'quickbite_url'
    ];

    for (const key of allowedKeys) {
      if (req.body && req.body[key] !== undefined) {
        safeSettings[key] = String(req.body[key]).slice(0, 1000);
      }
    }

    const updated = await db.updateSettings(safeSettings);
    await db.addLog('info', 'Settings Updated', { updatedKeys: Object.keys(safeSettings) });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update settings.' });
  }
});

// ================= MESSAGES & API GATEWAY DISPATCH =================
// Public API Gateway Endpoint (Protected via API Key)
router.post('/send-message', messageDispatchLimiter, requireApiKey, async (req, res) => {
  try {
    const { to, message, text } = req.body || {};
    const destination = to;
    const content = message || text;

    if (!destination || !content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters. Required: { "to": "+8801XXXXXXXXX", "message": "Your text here" }'
      });
    }

    const cleanTo = String(destination).replace(/[^0-9]/g, '');
    if (cleanTo.length < 8 || cleanTo.length > 20) {
      return res.status(400).json({ success: false, error: 'Invalid destination phone number format.' });
    }

    const safeContent = String(content).slice(0, 4096);
    const source = req.project ? `Project: ${req.project.name}` : 'API Gateway';
    const result = await whatsappManager.sendMessage(cleanTo, safeContent, source);

    await db.addLog('trigger', 'Message Dispatched', {
      to: cleanTo,
      preview: safeContent.slice(0, 50),
      source
    });

    res.json({
      success: true,
      message: 'WhatsApp message queued and dispatched successfully.',
      data: {
        to: cleanTo,
        messageId: result?.key?.id || `msg_${Date.now()}`,
        status: 'sent',
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to dispatch message.' });
  }
});

router.get('/messages', requireAuth, async (req, res) => {
  try {
    const phone = req.query.phone ? String(req.query.phone).replace(/[^0-9]/g, '') : null;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 200));
    const messages = await db.getMessages(phone, limit);
    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch messages.' });
  }
});

router.delete('/messages', requireAuth, async (req, res) => {
  try {
    await db.clearMessages();
    await db.addLog('info', 'Live Messages Feed Cleared');
    res.json({ success: true, message: 'Messages feed cleared successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to clear messages.' });
  }
});

router.get('/logs', requireAuth, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 200));
    const logs = await db.getLogs(limit);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch logs.' });
  }
});

router.delete('/logs', requireAuth, async (req, res) => {
  try {
    await db.clearLogs();
    res.json({ success: true, message: 'Activity logs cleared successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to clear logs.' });
  }
});

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireApiKey = requireApiKey;
