const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');
const config = require('./config');
const db = require('./db/db');
const whatsappManager = require('./whatsapp/manager');
const whatsappSimulator = require('./whatsapp/simulator');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Disable X-Powered-By header
app.disable('x-powered-by');

// 1. Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
    "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com data:; " +
    "img-src 'self' data: https: blob:; " +
    "connect-src 'self' ws: wss:; " +
    "frame-ancestors 'self';"
  );

  next();
});

// 2. CORS Configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser tools (cURL, Postman, server-to-server) with no origin
    if (!origin) return callback(null, true);

    if (config.allowedOrigins && config.allowedOrigins.length > 0) {
      if (config.allowedOrigins.includes(origin) || config.allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      return callback(null, false);
    }

    // Default: allow localhost, current domain, and same origin
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-WhatsFlow-Event', 'X-WhatsFlow-Signature-256']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// 3. Serve frontend static files with caching and proper MIME types
app.use(express.static(config.paths.public, {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
  }
}));

// 4. API Routes
app.use('/api/v1', apiRoutes);

// 5. SPA Fallback to index.html for client-side routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/css/') || req.path.startsWith('/js/')) return next();
  res.sendFile(path.join(config.paths.public, 'index.html'));
});

// 6. Centralized Error Handler
app.use((err, req, res, next) => {
  const isDev = config.nodeEnv === 'development';
  console.error('[Server Error]', err.message);

  if (res.headersSent) {
    return next(err);
  }

  res.status(err.status || 500).json({
    success: false,
    error: isDev ? err.message : 'An internal server error occurred.'
  });
});

// Real-time WebSocket Broadcaster
const broadcast = (type, data) => {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  const isSensitiveType = (type === 'message_received' || type === 'message_sent');

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      // Sensitive live customer message streams are only broadcasted to authenticated dashboard sessions
      if (isSensitiveType && !client.isAuthenticated) {
        return;
      }
      try {
        client.send(message);
      } catch (e) {}
    }
  });
};

// Bind WebSocket broadcaster to WhatsApp Manager & Simulator
whatsappManager.setBroadcaster(broadcast);
whatsappSimulator.setBroadcaster(broadcast);

wss.on('connection', (ws, req) => {
  // Check optional auth token from query string (?token=wf_tok_...)
  let isAuthenticated = false;
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');
    if (token) {
      const payload = db.verifyAuthToken(token);
      if (payload && payload.id) {
        isAuthenticated = true;
      } else if (config.apiKey && db.timingSafeEqualString(token, config.apiKey)) {
        isAuthenticated = true;
      }
    }
  } catch (e) {}

  ws.isAuthenticated = isAuthenticated;

  // Send initial status
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      status: whatsappManager.getStatus()
    }
  }));

  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (parsed.type === 'auth' && parsed.token) {
        const payload = db.verifyAuthToken(parsed.token);
        if (payload && payload.id) {
          ws.isAuthenticated = true;
          ws.send(JSON.stringify({ type: 'auth_success', data: { authenticated: true } }));
        } else if (config.apiKey && db.timingSafeEqualString(parsed.token, config.apiKey)) {
          ws.isAuthenticated = true;
          ws.send(JSON.stringify({ type: 'auth_success', data: { authenticated: true } }));
        }
      }
    } catch (e) {}
  });
});

// Initialize & Boot Server
async function startServer() {
  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚡ WhatsFlow - WhatsApp Automation & API Gateway Platform');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. Initialize Database
    await db.init();

    // 2. Initialize WhatsApp Engine
    await whatsappManager.init();

    // 3. Start HTTP + WS Server
    server.listen(config.port, config.host, () => {
      console.log(`[Server] ✓ WhatsFlow Web Dashboard is LIVE at: http://localhost:${config.port}`);
      console.log(`[Server] ✓ API Gateway Endpoint: http://localhost:${config.port}/api/v1/send-message`);
      console.log(`[Server] ✓ WebSocket Live Stream active.`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    });
  } catch (err) {
    console.error('[Server] Fatal boot error:', err);
    process.exit(1);
  }
}

startServer();

// Process signal handling
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down gracefully...');
  try {
    await whatsappManager.gracefulStop();
  } catch (e) {}
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Server] Terminating gracefully...');
  try {
    await whatsappManager.gracefulStop();
  } catch (e) {}
  process.exit(0);
});

module.exports = { app, server };
