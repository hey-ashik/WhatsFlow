-- WhatsFlow Supabase PostgreSQL Schema
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- 1. Users Table (Authentication)
CREATE TABLE IF NOT EXISTS wf_users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Settings Table
CREATE TABLE IF NOT EXISTS wf_settings (
    key_name TEXT PRIMARY KEY,
    value_text TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. WhatsApp Sessions Table
CREATE TABLE IF NOT EXISTS wf_sessions (
    session_id TEXT PRIMARY KEY,
    phone_number TEXT,
    display_name TEXT,
    status TEXT DEFAULT 'disconnected',
    qr_code TEXT,
    platform TEXT DEFAULT 'WhatsApp Multi-Device',
    last_active TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Projects Table (Dedicated API Gateways & Webhooks)
CREATE TABLE IF NOT EXISTS wf_projects (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    webhook_url TEXT,
    is_active SMALLINT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Keyword Automations Table (Tied to Projects)
CREATE TABLE IF NOT EXISTS wf_automations (
    id BIGSERIAL PRIMARY KEY,
    project_id TEXT,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL, -- exact, contains, starts_with, regex, flow
    trigger_value TEXT NOT NULL,
    response_type TEXT DEFAULT 'text',
    response_content TEXT NOT NULL,
    is_active SMALLINT DEFAULT 1,
    execution_count BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Contacts Table
CREATE TABLE IF NOT EXISTS wf_contacts (
    id BIGSERIAL PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    current_flow TEXT,
    current_step TEXT,
    flow_data JSONB DEFAULT '{}'::jsonb,
    total_messages INT DEFAULT 0,
    last_interaction TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Messages Table
CREATE TABLE IF NOT EXISTS wf_messages (
    id BIGSERIAL PRIMARY KEY,
    message_id TEXT,
    project_id TEXT,
    session_id TEXT DEFAULT 'default',
    from_phone TEXT NOT NULL,
    to_phone TEXT NOT NULL,
    direction TEXT NOT NULL, -- incoming, outgoing
    message_text TEXT NOT NULL,
    message_type TEXT DEFAULT 'text',
    automation_matched TEXT,
    status TEXT DEFAULT 'delivered',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Logs Table
CREATE TABLE IF NOT EXISTS wf_logs (
    id BIGSERIAL PRIMARY KEY,
    project_id TEXT,
    level TEXT DEFAULT 'info',
    event_name TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disable RLS for backend Node.js server access
ALTER TABLE wf_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE wf_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE wf_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE wf_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE wf_automations DISABLE ROW LEVEL SECURITY;
ALTER TABLE wf_contacts DISABLE ROW LEVEL SECURITY;
ALTER TABLE wf_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE wf_logs DISABLE ROW LEVEL SECURITY;

-- Insert Default Settings
INSERT INTO wf_settings (key_name, value_text) VALUES
('api_key', 'qb_live_9f83a82c74d6b01e289f81a7b'),
('webhook_url', ''),
('webhook_secret', ''),
('bot_enabled', '1'),
('ai_enabled', '0'),
('ai_api_key', ''),
('ai_model', 'llama-3.3-70b-versatile'),
('default_fallback_reply', 'Thank you for reaching out! We will get back to you shortly.')
ON CONFLICT (key_name) DO NOTHING;
