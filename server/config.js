require('dotenv').config();
const path = require('path');
const crypto = require('crypto');

// Ensure a strong, stable server secret for token signing
const serverSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'wf_secret_key_8f92b7c41e0a6d5382b94f1c';

const config = {
  port: parseInt(process.env.PORT, 10) || 3005,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  apiKey: process.env.API_KEY || 'qb_live_9f83a82c74d6b01e289f81a7b',
  jwtSecret: serverSecret,
  webhookUrl: process.env.WEBHOOK_URL || '',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  quickbiteSiteUrl: process.env.QUICKBITE_SITE_URL || 'https://quickbite.ashiik.com',
  allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : null,
  
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'whatsflow_db',
  },

  ai: {
    enabled: process.env.AI_ENABLED === 'true',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'llama-3.3-70b-versatile',
    systemPrompt: process.env.AI_SYSTEM_PROMPT || 'You are an AI assistant. Keep responses concise and formatted for WhatsApp.',
  },

  paths: {
    root: path.resolve(__dirname, '..'),
    sessions: path.resolve(__dirname, '..', 'server', 'sessions'),
    data: path.resolve(__dirname, '..', 'server', 'data'),
    public: path.resolve(__dirname, '..', 'public'),
  }
};

module.exports = config;
