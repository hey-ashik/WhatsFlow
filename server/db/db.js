const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// Ensure data and session directories exist
if (!fs.existsSync(config.paths.data)) {
  fs.mkdirSync(config.paths.data, { recursive: true });
}
if (!fs.existsSync(config.paths.sessions)) {
  fs.mkdirSync(config.paths.sessions, { recursive: true });
}

const localStorePath = path.join(config.paths.data, 'whatsflow_store.json');

// Timing-safe string comparison to prevent timing attacks
function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// Helpers for password hashing
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  try {
    const [salt, originalHash] = storedHash.split(':');
    const hashToVerify = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(hashToVerify, 'hex'));
  } catch (e) {
    return false;
  }
}

// Helpers for Signed HMAC-SHA256 Tokens
function generateAuthToken(user, expiresInDays = 7) {
  const payload = JSON.stringify({
    id: user.id,
    email: user.email,
    role: user.role || 'user',
    exp: Date.now() + expiresInDays * 24 * 60 * 60 * 1000
  });

  const payloadB64 = Buffer.from(payload).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(payloadB64)
    .digest('base64url');

  return `wf_tok_${payloadB64}.${signature}`;
}

function verifyAuthToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;

  const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken.trim();
  if (!token.startsWith('wf_tok_')) return null;

  const tokenBody = token.slice(7); // Remove 'wf_tok_' prefix

  // 1. Signed token format: <payloadB64>.<signature>
  if (tokenBody.includes('.')) {
    const [payloadB64, providedSig] = tokenBody.split('.');
    if (!payloadB64 || !providedSig) return null;

    const expectedSig = crypto
      .createHmac('sha256', config.jwtSecret)
      .update(payloadB64)
      .digest('base64url');

    // Constant-time signature verification
    const sigMatches = timingSafeEqualString(providedSig, expectedSig);
    if (!sigMatches) return null;

    try {
      const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson);

      // Check expiration
      if (payload.exp && Date.now() > payload.exp) {
        return null; // Expired
      }

      return payload;
    } catch (e) {
      return null;
    }
  }

  return null;
}

// Default initial state
const defaultState = {
  users: [
    {
      id: 'usr_admin_default',
      email: 'ashikulislam2070@gmail.com',
      password_hash: hashPassword('admin123'),
      name: 'Ashikul Islam',
      role: 'admin',
      created_at: new Date().toISOString()
    }
  ],
  settings: {
    api_key: config.apiKey,
    webhook_url: '',
    webhook_secret: '',
    bot_enabled: '1',
    ai_enabled: '0',
    ai_api_key: '',
    ai_model: 'llama-3.3-70b-versatile',
    default_fallback_reply: 'Thank you for reaching out! We will get back to you shortly.',
    quickbite_url: config.quickbiteSiteUrl,
  },
  session: {
    session_id: 'default',
    phone_number: null,
    display_name: null,
    status: 'disconnected',
    qr_code: null,
    last_active: new Date().toISOString()
  },
  projects: [],
  automations: [],
  workflows: [
    {
      id: 'wf_starter_ai_agent',
      project_id: null,
      name: 'Customer Support AI Agent',
      description: 'Intelligent AI-driven auto-responder with knowledge context and WhatsApp output.',
      is_active: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'whatsapp_trigger',
          label: 'When Chat Message Received',
          x: 100,
          y: 180,
          data: {
            title: 'When Chat Message Received',
            description: 'Triggers on incoming customer WhatsApp text',
            event: 'message_received'
          }
        },
        {
          id: 'node_context',
          type: 'document_context',
          label: 'Knowledge Context',
          x: 420,
          y: 60,
          data: {
            title: 'Knowledge Base',
            contextText: 'Business Name: WhatsFlow Support\nService: 24/7 WhatsApp API & Bot Automation\nWebsite: https://quickbite.ashiik.com\nSupport Hours: Always Online'
          }
        },
        {
          id: 'node_ai',
          type: 'ai_agent',
          label: 'AI Agent (LLM)',
          x: 420,
          y: 260,
          data: {
            title: 'AI Agent',
            model: 'gpt-4o-mini',
            promptTemplate: 'Answer the customer message: {{text}}',
            systemPrompt: 'You are an intelligent, friendly customer service agent. Answer clearly, concisely, and use emojis.',
            temperature: 0.7
          }
        },
        {
          id: 'node_output',
          type: 'send_message',
          label: 'Send WhatsApp Message',
          x: 780,
          y: 200,
          data: {
            title: 'Send WhatsApp Reply',
            messageTemplate: '{{ai_reply}}'
          }
        }
      ],
      edges: [
        { id: 'e_trigger_ai', source: 'node_trigger', target: 'node_ai', sourceHandle: 'out', targetHandle: 'in' },
        { id: 'e_context_ai', source: 'node_context', target: 'node_ai', sourceHandle: 'out', targetHandle: 'context' },
        { id: 'e_ai_output', source: 'node_ai', target: 'node_output', sourceHandle: 'out', targetHandle: 'in' }
      ],
      settings: {
        ai_provider: 'openai',
        ai_model: 'gpt-4o-mini',
        temperature: 0.7
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ],
  contacts: {},
  messages: [],
  logs: []
};

class Database {
  constructor() {
    this.useSupabase = false;
    this.supabase = null;
    this.useMySQL = false;
    this.pool = null;
    this.localState = this.loadLocalStore();
  }

  loadLocalStore() {
    try {
      if (fs.existsSync(localStorePath)) {
        const raw = fs.readFileSync(localStorePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          ...defaultState,
          ...parsed,
          users: (parsed.users && parsed.users.length > 0) ? parsed.users : defaultState.users,
          projects: (parsed.projects && parsed.projects.length > 0) ? parsed.projects : defaultState.projects,
          automations: (parsed.automations && parsed.automations.length > 0) ? parsed.automations : defaultState.automations,
          workflows: (parsed.workflows && parsed.workflows.length > 0) ? parsed.workflows : defaultState.workflows
        };
      }
    } catch (err) {
      console.warn('[DB] Could not load local store, initializing default state.', err.message);
    }
    this.saveLocalStore(defaultState);
    return defaultState;
  }

  saveLocalStore(state = this.localState) {
    try {
      fs.writeFileSync(localStorePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.error('[DB] Failed to save local store:', err.message);
    }
  }

  async init() {
    // 1. Try Supabase First (Recommended for Hostinger Node.js deployment)
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_API_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseKey) {
      try {
        console.log(`[DB] Connecting to Supabase at ${supabaseUrl.slice(0, 25)}...`);
        this.supabase = createClient(supabaseUrl, supabaseKey);
        
        // Test connection
        const { error } = await this.supabase.from('wf_settings').select('key_name').limit(1);
        if (!error || error.code === 'PGRST116') {
          this.useSupabase = true;
          console.log('[DB] ✓ Connected to Supabase PostgreSQL database successfully.');
          return;
        } else {
          console.warn('[DB] Supabase connected but notice on table check:', error.message);
          this.useSupabase = true;
          return;
        }
      } catch (sbErr) {
        console.warn(`[DB] Supabase initialization notice: ${sbErr.message}. Checking fallbacks...`);
      }
    }

    // 2. Try MySQL Second
    if (config.db.host && config.db.database && config.db.user) {
      try {
        console.log(`[DB] Attempting MySQL connection to ${config.db.host}:${config.db.port}/${config.db.database}...`);
        this.pool = mysql.createPool({
          host: config.db.host,
          port: config.db.port,
          user: config.db.user,
          password: config.db.password,
          database: config.db.database,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0
        });

        const conn = await this.pool.getConnection();
        conn.release();
        this.useMySQL = true;
        console.log('[DB] ✓ Connected to MySQL successfully.');
        return;
      } catch (err) {
        console.warn(`[DB] MySQL connection not established (${err.message}). Using persistent local storage engine.`);
      }
    }

    // 3. Fallback to Persistent Local Storage
    this.useSupabase = false;
    this.useMySQL = false;
    console.log('[DB] ✓ Persistent Local Data Engine active.');
  }

  // ================= USERS & AUTH =================
  async createUser({ email, password, name }) {
    const cleanEmail = String(email).toLowerCase().trim();
    const existing = await this.getUserByEmail(cleanEmail);
    if (existing) {
      throw new Error('An account with this email address already exists.');
    }

    const newUser = {
      id: `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      email: cleanEmail,
      password_hash: hashPassword(password),
      name: (name || 'User').trim(),
      role: 'user',
      created_at: new Date().toISOString()
    };

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_users').insert(newUser);
      } catch (err) {
        console.error('[DB] createUser Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        await this.pool.query(
          `INSERT INTO wf_users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)`,
          [newUser.id, newUser.email, newUser.password_hash, newUser.name, newUser.role]
        );
      } catch (err) {}
    }

    if (!this.localState.users) this.localState.users = [];
    this.localState.users.push(newUser);
    this.saveLocalStore();

    const { password_hash, ...safeUser } = newUser;
    return safeUser;
  }

  async getUserByEmail(email) {
    const cleanEmail = String(email || '').toLowerCase().trim();
    if (!cleanEmail) return null;

    if (this.useSupabase) {
      try {
        const { data, error } = await this.supabase.from('wf_users').select('*').eq('email', cleanEmail).maybeSingle();
        if (!error && data) return data;
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        const [rows] = await this.pool.query('SELECT * FROM wf_users WHERE email = ? LIMIT 1', [cleanEmail]);
        if (rows.length > 0) return rows[0];
      } catch (err) {}
    }

    return (this.localState.users || []).find(u => u.email.toLowerCase() === cleanEmail) || null;
  }

  async getUserById(id) {
    if (!id) return null;

    if (this.useSupabase) {
      try {
        const { data, error } = await this.supabase.from('wf_users').select('*').eq('id', id).maybeSingle();
        if (!error && data) return data;
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        const [rows] = await this.pool.query('SELECT * FROM wf_users WHERE id = ? LIMIT 1', [id]);
        if (rows.length > 0) return rows[0];
      } catch (err) {}
    }

    return (this.localState.users || []).find(u => u.id === id) || null;
  }

  async verifyUserLogin(email, password) {
    const user = await this.getUserByEmail(email);
    if (!user) return null;

    const isValid = verifyPassword(password, user.password_hash);
    if (!isValid) return null;

    const { password_hash, ...safeUser } = user;
    return safeUser;
  }

  async resetUserPassword(email, newPassword) {
    const user = await this.getUserByEmail(email);
    if (!user) return false;

    const newHash = hashPassword(newPassword);

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_users').update({ password_hash: newHash }).eq('email', user.email);
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        await this.pool.query('UPDATE wf_users SET password_hash = ? WHERE email = ?', [newHash, user.email]);
      } catch (err) {}
    }

    const idx = (this.localState.users || []).findIndex(u => u.email.toLowerCase() === user.email.toLowerCase());
    if (idx !== -1) {
      this.localState.users[idx].password_hash = newHash;
      this.saveLocalStore();
    }
    return true;
  }

  // ================= SETTINGS =================
  async getSettings() {
    if (this.useSupabase) {
      try {
        const { data, error } = await this.supabase.from('wf_settings').select('*');
        if (!error && data) {
          const settings = {};
          data.forEach(r => { settings[r.key_name] = r.value_text; });
          return { ...this.localState.settings, ...settings };
        }
      } catch (err) {
        console.error('[DB] getSettings Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        const [rows] = await this.pool.query('SELECT key_name, value_text FROM wf_settings');
        const settings = {};
        rows.forEach(r => { settings[r.key_name] = r.value_text; });
        return { ...this.localState.settings, ...settings };
      } catch (err) {
        console.error('[DB] getSettings MySQL error:', err.message);
      }
    }

    return { ...this.localState.settings };
  }

  async getSetting(key, defaultValue = null) {
    const settings = await this.getSettings();
    return settings[key] !== undefined ? settings[key] : defaultValue;
  }

  async setSetting(key, value) {
    if (!key) return null;
    return await this.updateSettings({ [key]: value });
  }

  async updateSettings(settingsObj) {
    if (this.useSupabase) {
      try {
        const rows = Object.entries(settingsObj).map(([key_name, value_text]) => ({
          key_name,
          value_text: String(value_text)
        }));
        await this.supabase.from('wf_settings').upsert(rows, { onConflict: 'key_name' });
      } catch (err) {
        console.error('[DB] updateSettings Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        for (const [key, value] of Object.entries(settingsObj)) {
          await this.pool.query(
            'INSERT INTO wf_settings (key_name, value_text) VALUES (?, ?) ON DUPLICATE KEY UPDATE value_text = ?',
            [key, String(value), String(value)]
          );
        }
      } catch (err) {
        console.error('[DB] updateSettings MySQL error:', err.message);
      }
    }

    this.localState.settings = { ...this.localState.settings, ...settingsObj };
    this.saveLocalStore();
    return this.localState.settings;
  }

  // ================= SESSIONS =================
  async getSession(sessionId = 'default') {
    if (this.useSupabase) {
      try {
        const { data, error } = await this.supabase.from('wf_sessions').select('*').eq('session_id', sessionId).maybeSingle();
        if (!error && data) return data;
      } catch (err) {
        console.error('[DB] getSession Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        const [rows] = await this.pool.query('SELECT * FROM wf_sessions WHERE session_id = ? LIMIT 1', [sessionId]);
        if (rows.length > 0) return rows[0];
      } catch (err) {
        console.error('[DB] getSession MySQL error:', err.message);
      }
    }

    return this.localState.session;
  }

  async updateSession(sessionId = 'default', data = {}) {
    const updated = {
      ...this.localState.session,
      ...data,
      session_id: sessionId,
      last_active: new Date().toISOString()
    };

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_sessions').upsert({
          session_id: sessionId,
          phone_number: updated.phone_number,
          display_name: updated.display_name,
          status: updated.status,
          qr_code: updated.qr_code,
          last_active: new Date().toISOString()
        }, { onConflict: 'session_id' });
      } catch (err) {
        console.error('[DB] updateSession Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        await this.pool.query(
          `INSERT INTO wf_sessions (session_id, phone_number, display_name, status, qr_code, last_active)
           VALUES (?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE phone_number = VALUES(phone_number), display_name = VALUES(display_name),
           status = VALUES(status), qr_code = VALUES(qr_code), last_active = NOW()`,
          [sessionId, updated.phone_number, updated.display_name, updated.status, updated.qr_code]
        );
      } catch (err) {
        console.error('[DB] updateSession MySQL error:', err.message);
      }
    }

    this.localState.session = updated;
    this.saveLocalStore();
    return updated;
  }

  // ================= PROJECTS =================
  async getProjects() {
    if (this.useSupabase) {
      try {
        const { data, error } = await this.supabase.from('wf_projects').select('*').order('created_at', { ascending: false });
        if (!error && data) return data;
      } catch (err) {
        console.error('[DB] getProjects Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        const [rows] = await this.pool.query('SELECT * FROM wf_projects ORDER BY created_at DESC');
        if (rows && rows.length > 0) return rows;
      } catch (err) {
        console.error('[DB] getProjects MySQL error:', err.message);
      }
    }

    return this.localState.projects || [];
  }

  async getProject(id) {
    if (!id) return null;
    const all = await this.getProjects();
    return all.find(p => p.id === id) || null;
  }

  async getProjectByApiKey(apiKey) {
    if (!apiKey) return null;
    const all = await this.getProjects();
    return all.find(p => p.api_key && timingSafeEqualString(p.api_key, apiKey)) || null;
  }

  async createProject({ name, webhook_url }) {
    const randomHex = crypto.randomBytes(12).toString('hex');
    const newProject = {
      id: `proj_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      name: String(name || 'Untitled Project').trim(),
      api_key: `qb_live_${randomHex}`,
      webhook_url: (webhook_url || '').trim(),
      is_active: 1,
      created_at: new Date().toISOString()
    };

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_projects').insert(newProject);
      } catch (err) {
        console.error('[DB] createProject Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        await this.pool.query(
          `INSERT INTO wf_projects (id, name, api_key, webhook_url, is_active) VALUES (?, ?, ?, ?, ?)`,
          [newProject.id, newProject.name, newProject.api_key, newProject.webhook_url, newProject.is_active]
        );
      } catch (err) {
        console.error('[DB] createProject MySQL error:', err.message);
      }
    }

    if (!this.localState.projects) this.localState.projects = [];
    this.localState.projects.unshift(newProject);
    this.saveLocalStore();
    return newProject;
  }

  async updateProject(id, data = {}) {
    if (!id) return null;

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_projects').update(data).eq('id', id);
      } catch (err) {
        console.error('[DB] updateProject Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        await this.pool.query(
          `UPDATE wf_projects SET name = COALESCE(?, name), webhook_url = COALESCE(?, webhook_url), is_active = COALESCE(?, is_active) WHERE id = ?`,
          [data.name, data.webhook_url, data.is_active, id]
        );
      } catch (err) {
        console.error('[DB] updateProject MySQL error:', err.message);
      }
    }

    const idx = (this.localState.projects || []).findIndex(p => p.id === id);
    if (idx !== -1) {
      this.localState.projects[idx] = { ...this.localState.projects[idx], ...data };
      this.saveLocalStore();
      return this.localState.projects[idx];
    }
    return null;
  }

  async deleteProject(id) {
    if (!id) return false;

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_automations').delete().eq('project_id', id);
        await this.supabase.from('wf_projects').delete().eq('id', id);
      } catch (err) {
        console.error('[DB] deleteProject Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        await this.pool.query('DELETE FROM wf_automations WHERE project_id = ?', [id]);
        await this.pool.query('DELETE FROM wf_projects WHERE id = ?', [id]);
      } catch (err) {
        console.error('[DB] deleteProject MySQL error:', err.message);
      }
    }

    this.localState.projects = (this.localState.projects || []).filter(p => p.id !== id);
    this.localState.automations = (this.localState.automations || []).filter(a => String(a.project_id) !== String(id));
    this.saveLocalStore();
    return true;
  }

  // ================= AUTOMATIONS (TIED TO PROJECTS) =================
  async getAutomations(projectId = null) {
    if (this.useSupabase) {
      try {
        let query = this.supabase.from('wf_automations').select('*').order('id', { ascending: true });
        if (projectId) {
          query = query.eq('project_id', projectId);
        }
        const { data, error } = await query;
        if (!error && data) return data;
      } catch (err) {
        console.error('[DB] getAutomations Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        let query = 'SELECT * FROM wf_automations ORDER BY id ASC';
        let params = [];
        if (projectId) {
          query = 'SELECT * FROM wf_automations WHERE project_id = ? ORDER BY id ASC';
          params = [projectId];
        }
        const [rows] = await this.pool.query(query, params);
        return rows;
      } catch (err) {
        console.error('[DB] getAutomations MySQL error:', err.message);
      }
    }

    if (projectId) {
      return (this.localState.automations || []).filter(a => String(a.project_id) === String(projectId));
    }
    return this.localState.automations || [];
  }

  async getAutomation(id) {
    if (!id) return null;
    const all = await this.getAutomations();
    return all.find(a => String(a.id) === String(id)) || null;
  }

  async createAutomation(data) {
    // Determine project_id
    let projectId = data.project_id;
    if (!projectId) {
      const projects = await this.getProjects();
      projectId = projects[0]?.id || 'proj_default_main';
    }

    const newItem = {
      project_id: projectId,
      name: data.name || 'Untitled Automation',
      trigger_type: data.trigger_type || 'exact',
      trigger_value: (data.trigger_value || '').toLowerCase().trim(),
      response_type: data.response_type || 'text',
      response_content: data.response_content || '',
      is_active: data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
      execution_count: 0,
      created_at: new Date().toISOString()
    };

    if (this.useSupabase) {
      try {
        const { data: resData, error } = await this.supabase.from('wf_automations').insert(newItem).select().single();
        if (!error && resData) {
          newItem.id = resData.id;
        } else {
          newItem.id = Date.now();
        }
      } catch (err) {
        newItem.id = Date.now();
      }
    } else if (this.useMySQL) {
      try {
        const [res] = await this.pool.query(
          `INSERT INTO wf_automations (project_id, name, trigger_type, trigger_value, response_type, response_content, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [newItem.project_id, newItem.name, newItem.trigger_type, newItem.trigger_value, newItem.response_type, newItem.response_content, newItem.is_active]
        );
        newItem.id = res.insertId;
      } catch (err) {
        newItem.id = Date.now();
      }
    } else {
      newItem.id = Date.now();
    }

    if (!this.localState.automations) this.localState.automations = [];
    this.localState.automations.push(newItem);
    this.saveLocalStore();
    return newItem;
  }

  async updateAutomation(id, data = {}) {
    if (!id) return null;

    let updatedRecord = null;

    if (this.useSupabase) {
      try {
        const updateData = { ...data };
        if (updateData.is_active !== undefined) {
          updateData.is_active = updateData.is_active ? 1 : 0;
        }
        const { data: resData, error } = await this.supabase
          .from('wf_automations')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();
        if (!error && resData) {
          updatedRecord = resData;
        }
      } catch (err) {
        console.error('[DB] updateAutomation Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        const fields = [];
        const params = [];
        if (data.project_id !== undefined) { fields.push('project_id = ?'); params.push(data.project_id); }
        if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name); }
        if (data.trigger_type !== undefined) { fields.push('trigger_type = ?'); params.push(data.trigger_type); }
        if (data.trigger_value !== undefined) { fields.push('trigger_value = ?'); params.push(data.trigger_value); }
        if (data.response_type !== undefined) { fields.push('response_type = ?'); params.push(data.response_type); }
        if (data.response_content !== undefined) { fields.push('response_content = ?'); params.push(data.response_content); }
        if (data.is_active !== undefined) { fields.push('is_active = ?'); params.push(data.is_active ? 1 : 0); }

        if (fields.length > 0) {
          params.push(id);
          await this.pool.query(`UPDATE wf_automations SET ${fields.join(', ')} WHERE id = ?`, params);
          const [rows] = await this.pool.query('SELECT * FROM wf_automations WHERE id = ? LIMIT 1', [id]);
          if (rows.length > 0) updatedRecord = rows[0];
        }
      } catch (err) {
        console.error('[DB] updateAutomation MySQL error:', err.message);
      }
    }

    if (!this.localState.automations) this.localState.automations = [];
    const idx = this.localState.automations.findIndex(a => String(a.id) === String(id));
    if (idx !== -1) {
      this.localState.automations[idx] = {
        ...this.localState.automations[idx],
        ...data,
        is_active: data.is_active !== undefined ? (data.is_active ? 1 : 0) : this.localState.automations[idx].is_active
      };
      this.saveLocalStore();
      return this.localState.automations[idx];
    } else if (updatedRecord) {
      this.localState.automations.push(updatedRecord);
      this.saveLocalStore();
      return updatedRecord;
    }

    return updatedRecord || null;
  }

  async deleteAutomation(id) {
    if (!id) return false;

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_automations').delete().eq('id', id);
      } catch (err) {
        console.error('[DB] deleteAutomation Supabase error:', err.message);
      }
    }

    if (this.useMySQL) {
      try {
        await this.pool.query('DELETE FROM wf_automations WHERE id = ?', [id]);
      } catch (err) {
        console.error('[DB] deleteAutomation MySQL error:', err.message);
      }
    }

    this.localState.automations = (this.localState.automations || []).filter(a => String(a.id) !== String(id));
    this.saveLocalStore();
    return true;
  }

  async incrementAutomationCount(id) {
    if (!id) return;

    if (this.useSupabase) {
      try {
        const rule = await this.getAutomation(id);
        if (rule) {
          await this.supabase.from('wf_automations').update({ execution_count: (rule.execution_count || 0) + 1 }).eq('id', id);
        }
      } catch (e) {}
    }

    if (this.useMySQL) {
      try {
        await this.pool.query('UPDATE wf_automations SET execution_count = execution_count + 1 WHERE id = ?', [id]);
      } catch (err) {}
    }

    const item = (this.localState.automations || []).find(a => String(a.id) === String(id));
    if (item) {
      item.execution_count = (item.execution_count || 0) + 1;
      this.saveLocalStore();
    }
  }

  // ================= WORKFLOWS (VISUAL NODE BUILDER) =================
  async getWorkflows(projectId = null) {
    if (this.useSupabase) {
      try {
        let query = this.supabase.from('wf_workflows').select('*').order('created_at', { ascending: false });
        if (projectId) query = query.eq('project_id', projectId);
        const { data, error } = await query;
        if (!error && data) {
          return data.map(w => ({
            ...w,
            nodes: typeof w.nodes === 'string' ? JSON.parse(w.nodes) : w.nodes,
            edges: typeof w.edges === 'string' ? JSON.parse(w.edges) : w.edges,
            settings: typeof w.settings === 'string' ? JSON.parse(w.settings) : (w.settings || {})
          }));
        }
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        let sql = 'SELECT * FROM wf_workflows ORDER BY created_at DESC';
        let params = [];
        if (projectId) {
          sql = 'SELECT * FROM wf_workflows WHERE project_id = ? ORDER BY created_at DESC';
          params = [projectId];
        }
        const [rows] = await this.pool.query(sql, params);
        return rows.map(w => ({
          ...w,
          nodes: typeof w.nodes === 'string' ? JSON.parse(w.nodes) : w.nodes,
          edges: typeof w.edges === 'string' ? JSON.parse(w.edges) : w.edges,
          settings: typeof w.settings === 'string' ? JSON.parse(w.settings) : (w.settings || {})
        }));
      } catch (err) {}
    }

    if (!this.localState.workflows) this.localState.workflows = [];
    if (projectId) {
      return this.localState.workflows.filter(w => String(w.project_id) === String(projectId));
    }
    return this.localState.workflows;
  }

  async getWorkflow(id) {
    if (!id) return null;
    const all = await this.getWorkflows();
    return all.find(w => String(w.id) === String(id)) || null;
  }

  async getActiveWorkflow(projectId = null) {
    const workflows = await this.getWorkflows(projectId);
    const active = workflows.filter(w => Number(w.is_active) === 1);
    if (active.length > 0) return active[0];
    if (projectId) {
      // Fallback to global active workflow
      const globalWorkflows = await this.getWorkflows(null);
      return globalWorkflows.find(w => Number(w.is_active) === 1 && !w.project_id) || null;
    }
    return null;
  }

  async createWorkflow(data) {
    const newWorkflow = {
      id: data.id || `wf_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      project_id: data.project_id || null,
      name: (data.name || 'Untitled Workflow').trim().slice(0, 150),
      description: (data.description || '').trim().slice(0, 1000),
      is_active: data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
      nodes: Array.isArray(data.nodes) ? data.nodes : (typeof data.nodes === 'string' ? JSON.parse(data.nodes) : []),
      edges: Array.isArray(data.edges) ? data.edges : (typeof data.edges === 'string' ? JSON.parse(data.edges) : []),
      settings: typeof data.settings === 'object' ? data.settings : (typeof data.settings === 'string' ? JSON.parse(data.settings) : {}),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_workflows').insert({
          ...newWorkflow,
          nodes: JSON.stringify(newWorkflow.nodes),
          edges: JSON.stringify(newWorkflow.edges),
          settings: JSON.stringify(newWorkflow.settings)
        });
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        await this.pool.query(
          `INSERT INTO wf_workflows (id, project_id, name, description, is_active, nodes, edges, settings)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newWorkflow.id,
            newWorkflow.project_id,
            newWorkflow.name,
            newWorkflow.description,
            newWorkflow.is_active,
            JSON.stringify(newWorkflow.nodes),
            JSON.stringify(newWorkflow.edges),
            JSON.stringify(newWorkflow.settings)
          ]
        );
      } catch (err) {}
    }

    if (!this.localState.workflows) this.localState.workflows = [];
    this.localState.workflows.unshift(newWorkflow);
    this.saveLocalStore();
    return newWorkflow;
  }

  async updateWorkflow(id, data = {}) {
    if (!id) return null;

    let existing = await this.getWorkflow(id);
    if (!existing) {
      // Auto-upsert if workflow record does not yet exist
      return await this.createWorkflow({ id, ...data });
    }

    let nodes = existing.nodes || [];
    if (data.nodes !== undefined) {
      if (Array.isArray(data.nodes)) nodes = data.nodes;
      else if (typeof data.nodes === 'string') {
        try { nodes = JSON.parse(data.nodes); } catch (e) { nodes = existing.nodes || []; }
      }
    }

    let edges = existing.edges || [];
    if (data.edges !== undefined) {
      if (Array.isArray(data.edges)) edges = data.edges;
      else if (typeof data.edges === 'string') {
        try { edges = JSON.parse(data.edges); } catch (e) { edges = existing.edges || []; }
      }
    }

    let settings = existing.settings || {};
    if (data.settings !== undefined) {
      if (typeof data.settings === 'object' && data.settings !== null) settings = data.settings;
      else if (typeof data.settings === 'string') {
        try { settings = JSON.parse(data.settings); } catch (e) { settings = existing.settings || {}; }
      }
    }

    const updated = {
      ...existing,
      id,
      name: data.name !== undefined ? String(data.name).trim().slice(0, 150) : (existing.name || 'Untitled Workflow'),
      description: data.description !== undefined ? String(data.description).trim().slice(0, 1000) : (existing.description || ''),
      project_id: data.project_id !== undefined ? (data.project_id || null) : (existing.project_id || null),
      is_active: data.is_active !== undefined ? (data.is_active ? 1 : 0) : (existing.is_active !== undefined ? (existing.is_active ? 1 : 0) : 1),
      nodes,
      edges,
      settings,
      updated_at: new Date().toISOString()
    };

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_workflows').upsert({
          id,
          name: updated.name,
          description: updated.description,
          project_id: updated.project_id,
          is_active: updated.is_active,
          nodes: JSON.stringify(updated.nodes),
          edges: JSON.stringify(updated.edges),
          settings: JSON.stringify(updated.settings),
          updated_at: updated.updated_at
        });
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        await this.pool.query(
          `INSERT INTO wf_workflows (id, project_id, name, description, is_active, nodes, edges, settings, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE 
           project_id = VALUES(project_id),
           name = VALUES(name),
           description = VALUES(description),
           is_active = VALUES(is_active),
           nodes = VALUES(nodes),
           edges = VALUES(edges),
           settings = VALUES(settings),
           updated_at = NOW()`,
          [
            id,
            updated.project_id,
            updated.name,
            updated.description,
            updated.is_active,
            JSON.stringify(updated.nodes),
            JSON.stringify(updated.edges),
            JSON.stringify(updated.settings)
          ]
        );
      } catch (err) {}
    }

    if (!this.localState.workflows) this.localState.workflows = [];
    const idx = this.localState.workflows.findIndex(w => String(w.id) === String(id));
    if (idx !== -1) {
      this.localState.workflows[idx] = updated;
    } else {
      this.localState.workflows.unshift(updated);
    }
    this.saveLocalStore();
    return updated;
  }

  async deleteWorkflow(id) {
    if (!id) return false;

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_workflows').delete().eq('id', id);
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        await this.pool.query('DELETE FROM wf_workflows WHERE id = ?', [id]);
      } catch (err) {}
    }

    this.localState.workflows = (this.localState.workflows || []).filter(w => String(w.id) !== String(id));
    this.saveLocalStore();
    return true;
  }

  // ================= CONTACTS =================
  async getContact(phone) {
    const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone) return null;

    if (this.useSupabase) {
      try {
        const { data, error } = await this.supabase.from('wf_contacts').select('*').eq('phone', cleanPhone).maybeSingle();
        if (!error && data) return data;
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        const [rows] = await this.pool.query('SELECT * FROM wf_contacts WHERE phone = ? LIMIT 1', [cleanPhone]);
        if (rows.length > 0) return rows[0];
      } catch (err) {}
    }

    return this.localState.contacts[cleanPhone] || null;
  }

  async saveContact(phone, data = {}) {
    const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone) return null;

    const current = (await this.getContact(cleanPhone)) || {
      phone: cleanPhone,
      name: 'User',
      current_flow: null,
      current_step: null,
      flow_data: {},
      total_messages: 0,
      created_at: new Date().toISOString()
    };

    const updated = {
      ...current,
      ...data,
      phone: cleanPhone,
      last_interaction: new Date().toISOString()
    };

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_contacts').upsert(updated, { onConflict: 'phone' });
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        const flowDataStr = JSON.stringify(updated.flow_data || {});
        await this.pool.query(
          `INSERT INTO wf_contacts (phone, name, current_flow, current_step, flow_data, total_messages, last_interaction)
           VALUES (?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE name = VALUES(name), current_flow = VALUES(current_flow),
           current_step = VALUES(current_step), flow_data = VALUES(flow_data),
           total_messages = total_messages + 1, last_interaction = NOW()`,
          [cleanPhone, updated.name || 'User', updated.current_flow, updated.current_step, flowDataStr, updated.total_messages || 1]
        );
      } catch (err) {}
    }

    this.localState.contacts[cleanPhone] = updated;
    this.saveLocalStore();
    return updated;
  }

  async updateContactFlow(phone, flowName, stepName, flowData = {}) {
    const contact = await this.getContact(phone);
    const updatedData = { ...(contact ? contact.flow_data : {}), ...flowData };
    return this.saveContact(phone, {
      current_flow: flowName,
      current_step: stepName,
      flow_data: updatedData
    });
  }

  async clearContactFlow(phone) {
    return this.saveContact(phone, {
      current_flow: null,
      current_step: null,
      flow_data: {}
    });
  }

  // ================= MESSAGES =================
  async saveMessage(msg) {
    const record = {
      message_id: msg.message_id || `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      project_id: msg.project_id || null,
      session_id: msg.session_id || 'default',
      from_phone: String(msg.from_phone || '').replace(/[^0-9]/g, ''),
      to_phone: String(msg.to_phone || '').replace(/[^0-9]/g, ''),
      direction: msg.direction || 'incoming',
      message_text: msg.message_text || '',
      message_type: msg.message_type || 'text',
      automation_matched: msg.automation_matched || null,
      status: msg.status || 'delivered',
      created_at: new Date().toISOString()
    };

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_messages').insert(record);
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        await this.pool.query(
          `INSERT INTO wf_messages (message_id, project_id, session_id, from_phone, to_phone, direction, message_text, message_type, automation_matched, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [record.message_id, record.project_id, record.session_id, record.from_phone, record.to_phone, record.direction, record.message_text, record.message_type, record.automation_matched, record.status]
        );
      } catch (err) {}
    }

    this.localState.messages.push(record);
    if (this.localState.messages.length > 1000) {
      this.localState.messages = this.localState.messages.slice(-1000);
    }
    this.saveLocalStore();
    return record;
  }

  async getMessages(phone = null, limit = 100) {
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));

    if (this.useSupabase) {
      try {
        let query = this.supabase.from('wf_messages').select('*').order('created_at', { ascending: false }).limit(safeLimit);
        if (phone) {
          const cleanPhone = String(phone).replace(/[^0-9]/g, '');
          query = query.or(`from_phone.eq.${cleanPhone},to_phone.eq.${cleanPhone}`);
        }
        const { data, error } = await query;
        if (!error && data) return data.reverse();
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        if (phone) {
          const cleanPhone = String(phone).replace(/[^0-9]/g, '');
          const [rows] = await this.pool.query(
            `SELECT * FROM wf_messages WHERE from_phone = ? OR to_phone = ? ORDER BY id ASC LIMIT ?`,
            [cleanPhone, cleanPhone, safeLimit]
          );
          return rows;
        }
        const [rows] = await this.pool.query(`SELECT * FROM wf_messages ORDER BY id DESC LIMIT ?`, [safeLimit]);
        return rows.reverse();
      } catch (err) {}
    }

    if (phone) {
      const cleanPhone = String(phone).replace(/[^0-9]/g, '');
      return this.localState.messages
        .filter(m => m.from_phone === cleanPhone || m.to_phone === cleanPhone)
        .slice(-safeLimit);
    }
    return this.localState.messages.slice(-safeLimit);
  }

  async clearMessages() {
    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_messages').delete().neq('id', 0);
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        await this.pool.query('TRUNCATE TABLE wf_messages');
      } catch (err) {}
    }

    this.localState.messages = [];
    this.saveLocalStore();
    return true;
  }

  async getChatThreads() {
    const allMessages = await this.getMessages(null, 500);
    const threads = {};

    allMessages.forEach(msg => {
      const otherParty = msg.direction === 'incoming' ? msg.from_phone : msg.to_phone;
      if (!otherParty) return;

      if (!threads[otherParty]) {
        threads[otherParty] = {
          phone: otherParty,
          lastMessage: msg.message_text,
          lastTime: msg.created_at,
          direction: msg.direction,
          messageCount: 1
        };
      } else {
        threads[otherParty].lastMessage = msg.message_text;
        threads[otherParty].lastTime = msg.created_at;
        threads[otherParty].direction = msg.direction;
        threads[otherParty].messageCount++;
      }
    });

    return Object.values(threads).sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
  }

  // ================= LOGS =================
  async addLog(level = 'info', eventName = 'Event', details = null, projectId = null) {
    const record = {
      project_id: projectId,
      level: String(level).slice(0, 20),
      event_name: String(eventName).slice(0, 100),
      details: typeof details === 'object' ? JSON.stringify(details) : String(details || ''),
      created_at: new Date().toISOString()
    };

    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_logs').insert(record);
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        await this.pool.query(
          'INSERT INTO wf_logs (project_id, level, event_name, details) VALUES (?, ?, ?, ?)',
          [record.project_id, record.level, record.event_name, record.details]
        );
      } catch (err) {}
    }

    this.localState.logs.push(record);
    if (this.localState.logs.length > 500) {
      this.localState.logs = this.localState.logs.slice(-500);
    }
    this.saveLocalStore();
    return record;
  }

  async getLogs(limit = 100) {
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));

    if (this.useSupabase) {
      try {
        const { data, error } = await this.supabase.from('wf_logs').select('*').order('created_at', { ascending: false }).limit(safeLimit);
        if (!error && data) return data;
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        const [rows] = await this.pool.query('SELECT * FROM wf_logs ORDER BY id DESC LIMIT ?', [safeLimit]);
        return rows;
      } catch (err) {}
    }

    return [...this.localState.logs].reverse().slice(0, safeLimit);
  }

  async clearLogs() {
    if (this.useSupabase) {
      try {
        await this.supabase.from('wf_logs').delete().neq('id', 0);
      } catch (err) {}
    }

    if (this.useMySQL) {
      try {
        await this.pool.query('TRUNCATE TABLE wf_logs');
      } catch (err) {}
    }

    this.localState.logs = [];
    this.saveLocalStore();
    return true;
  }
}

const db = new Database();
module.exports = db;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.generateAuthToken = generateAuthToken;
module.exports.verifyAuthToken = verifyAuthToken;
module.exports.timingSafeEqualString = timingSafeEqualString;
