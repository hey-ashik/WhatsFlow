# WhatsFlow

**Enterprise-Grade WhatsApp Automation, Multi-Tenant API Gateway & Visual Workflow Platform**

<div align="center">

![WhatsFlow Application Dashboard](ReadmeIMG.png)

[![Node.js Version](https://img.shields.io/badge/Node.js-18%2B%20%7C%2020%2B%20%7C%2022%2B-111111?style=flat-square&logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-111111?style=flat-square)](LICENSE)
[![Tests Status](https://img.shields.io/badge/Tests-Passing%20(23%2F23)-success?style=flat-square)](https://github.com/hey-ashik/WhatsFlow)
[![Security Hardened](https://img.shields.io/badge/Security-Hardened%20(OWASP%20Top%2010)-111111?style=flat-square)](https://github.com/hey-ashik/WhatsFlow)
[![WhatsApp Multi-Device](https://img.shields.io/badge/WhatsApp-Multi--Device%20Ready-25D366?style=flat-square&logo=whatsapp)](https://github.com/hey-ashik/WhatsFlow)

<p align="center">
  A self-hosted, high-performance WhatsApp automation engine and REST API gateway. Connect any WhatsApp number via QR code, build multi-step conversational bots, manage multi-tenant projects with dedicated API keys, and dispatch messages with automated anti-ban presence simulation.
</p>

</div>

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Local Development Setup](#local-development-setup)
- [Server Deployment Guide](#server-deployment-guide)
  - [Hostinger Node.js Application Setup](#1-hostinger-nodejs-cloud--vps-deployment)
  - [Ubuntu / Debian VPS with PM2 and Nginx](#2-linux-vps-deployment-with-pm2--nginx)
  - [Supabase Database Configuration](#3-supabase-postgresql-setup)
- [Environment Configuration](#environment-configuration)
- [API Gateway Reference & Code Examples](#api-gateway-reference--code-examples)
  - [PHP / cURL](#1-php-curl)
  - [Node.js / Express](#2-nodejs-fetch--axios)
  - [Python / Requests](#3-python-requests)
  - [cURL Terminal](#4-curl-terminal)
- [Project Directory Structure](#project-directory-structure)
- [Security & Quality Standards](#security--quality-standards)
- [Automated Verification & Test Suites](#automated-verification--test-suites)
- [License](#license)

---

## Overview

**WhatsFlow** provides a robust, self-hosted alternative to the Meta Cloud API. It allows developers, SaaS platforms, and businesses to deploy custom WhatsApp bots and notification dispatchers with **zero per-message fees** and full data ownership.

Whether sending transaction confirmations, OTP codes, order updates (e.g., QuickBite food ordering), building interactive keyword auto-responders, or visually chaining complex AI workflows with knowledge bases, WhatsFlow handles the complete multi-device socket lifecycle, token signing, and database persistence.

---

## Key Features

### 1. Multi-Device WhatsApp Connectivity
- **One-Click QR Code Pairing**: Link standard and WhatsApp Business accounts in seconds using the Baileys multi-device protocol.
- **24/7 Presence Heartbeat**: Proactive background presence pings keep socket connections active without premature timeouts.
- **Anti-Ban Human Simulation**:
  - Automatically dispatches read receipts (blue checkmarks) on incoming messages before replying.
  - Simulates the `"composing"` (typing...) presence state before message transmission.
  - Adds dynamic, length-proportional jitter delays to avoid robotic signature detection.

### 2. Multi-Tenant Project Workspaces
- **Project Isolation**: Group automations, message feeds, and webhooks into distinct client or store projects.
- **Dedicated Project API Keys**: Generate scoped project keys (`qb_live_...`) with BOLA/IDOR cross-tenant access enforcement.
- **Dedicated Dispatch Endpoints**: Custom endpoints per project (`/api/v1/projects/:id/send-message`) with automatic fallback to universal gateway routes.

### 3. Keyword Automations & Visual Workflow Builder
- **Flexible Match Modes**: Supports `Exact Match`, `Contains Keyword`, `Starts With` (command prefixes), and `Default Fallback`.
- **Visual Drag-and-Drop Canvas**: Build multi-step decision trees, context filters, dynamic variables, and custom HTTP request nodes.
- **Live Graph Simulator**: Test workflow graph execution and node traversal directly within the UI without sending live messages.

### 4. Database Resilience (3-Tier Adaptive Storage)
- **Supabase PostgreSQL**: Native cloud database support with real-time indexing and relational consistency.
- **MySQL / MariaDB**: Full compatibility with traditional cPanel, phpMyAdmin, and cloud MySQL instances.
- **Persistent Local Engine**: Automatic fallback to zero-dependency JSON storage (`whatsflow_store.json`) for local development or lightweight setups.

### 5. Enterprise Security & Hardening
- **HMAC-SHA256 Signed Tokens**: Session tokens (`wf_tok_...`) verified with constant-time cryptographic signatures.
- **Timing-Safe Key Comparisons**: `crypto.timingSafeEqual` prevents side-channel timing attacks.
- **SSRF Protection**: Strict IP, CIDR, loopback, IPv6 bracket, and cloud metadata domain blocking on all outgoing webhooks.
- **Sliding-Window Rate Limiting**: Dedicated rate-limiting tiers for authentication, API gateways, and message dispatching.
- **Secure Reverse Proxy Handling**: Native trust proxy support ensuring canonical `https://` endpoint generation behind Hostinger, Nginx, and Cloudflare.

---

## System Architecture

```mermaid
flowchart TD
    ClientApp[Client Application / Webhook\nPHP, Node.js, Python, cURL] -->|HTTPS POST + Bearer API Key| Gateway[WhatsFlow API Gateway\nExpress + Rate Limiter]
    
    Gateway --> AuthGuard{Authorization Guard\nHMAC Token / Timing-Safe API Key}
    AuthGuard -->|Tenant Verified| Engine[Automation & Workflow Engine]
    
    Engine --> Matcher{Trigger Matcher\nKeyword / Visual Graph}
    Matcher -->|Inbound Automation| WAManager[WhatsApp Session Manager\nBaileys Multi-Device Socket]
    
    WAManager --> AntiBan[Anti-Ban Layer\nRead Receipts + Typing Presence + Jitter]
    AntiBan <-->|24/7 Encrypted Socket| WAServers((WhatsApp Infrastructure))
    WAServers <--> Phone[End User WhatsApp Device]
    
    Engine -->|Webhook Relay| ExtWebhook[External Webhook URL]
    Gateway <--> DB[(Database Layer\nSupabase / MySQL / Local Store)]
```

---

## Local Development Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **Git**: Installed and configured

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/hey-ashik/WhatsFlow.git
cd WhatsFlow
npm install
```

### 2. Configure Environment Variables
Copy the example environment configuration:
```bash
cp .env.example .env
```

Open `.env` and configure your settings:
```env
PORT=3000
API_KEY=qb_live_your_master_key_here
JWT_SECRET=your_super_secret_hmac_jwt_key_here

# Database Selection (Optional: defaults to local storage if omitted)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_anon_or_service_role_key

# Or MySQL Configuration
# DB_HOST=localhost
# DB_USER=root
# DB_PASS=your_password
# DB_NAME=whatsflow_db
```

### 3. Launch Application
```bash
# Start in production mode
npm start

# Or start with automatic file watching
npm run dev
```

Visit the dashboard in your browser: **http://localhost:3000**

---

## Server Deployment Guide

### 1. Hostinger Node.js Cloud / VPS Deployment

1. **Upload Code**: Push your repository to GitHub or upload the project folder directly via Hostinger File Manager / Git Deploy.
2. **Configure Node.js Application**:
   - **Application Root**: `/public_html` (or your subdomain directory, e.g. `whatsflow.ashiik.com`)
   - **Application Startup File**: `server/index.js`
   - **Node.js Version**: Select `18.x`, `20.x`, or `22.x`
3. **Environment Variables**: Add `PORT`, `API_KEY`, `JWT_SECRET`, and database credentials in the Hostinger cPanel Node.js configuration section.
4. **Install Packages**: Click **Run npm install** or run `npm install --omit=dev` via SSH terminal.
5. **Start Application**: Click **Restart Application**. Reverse proxy headers are automatically detected to serve `https://` endpoints.

---

### 2. Linux VPS Deployment with PM2 & Nginx

#### Step A: Install PM2 Process Manager
```bash
sudo npm install -g pm2
pm2 start server/index.js --name "whatsflow"
pm2 startup
pm2 save
```

#### Step B: Nginx Reverse Proxy Configuration
Create `/etc/nginx/sites-available/whatsflow`:
```nginx
server {
    server_name whatsflow.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the configuration and attach free SSL certificates via Certbot:
```bash
sudo ln -s /etc/nginx/sites-available/whatsflow /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d whatsflow.yourdomain.com
```

---

### 3. Supabase PostgreSQL Setup

1. Open your Supabase Dashboard and navigate to the **SQL Editor**.
2. Run the provided schema script: [`supabase_schema.sql`](supabase_schema.sql).
3. Copy your **Project URL** and **Service Role / Anon Key** from **Settings > API**.
4. Paste them into your server environment variables (`SUPABASE_URL` and `SUPABASE_KEY`).

---

## Environment Configuration

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | Number | `3000` | HTTP and WebSocket server listening port. |
| `API_KEY` | String | Auto-generated | Master administrative API key for system-wide access. |
| `JWT_SECRET` | String | Auto-generated | Cryptographic secret for signing HMAC-SHA256 session tokens. |
| `SUPABASE_URL` | String | Optional | Supabase PostgreSQL project URL. |
| `SUPABASE_KEY` | String | Optional | Supabase API key (anon or service_role). |
| `DB_HOST` | String | Optional | MySQL / MariaDB server host. |
| `DB_USER` | String | Optional | MySQL database username. |
| `DB_PASS` | String | Optional | MySQL database password. |
| `DB_NAME` | String | Optional | MySQL database schema name. |
| `BOT_ENABLED` | Number | `1` | Enable (`1`) or pause (`0`) automated inbound bot replies. |
| `WEBHOOK_URL` | String | Optional | Global webhook URL for forwarding incoming message payloads. |

---

## API Gateway Reference & Code Examples

### 1. PHP (cURL)
```php
<?php
$apiUrl = "https://whatsflow.yourdomain.com/api/v1/projects/proj_YOUR_ID/send-message";
$apiKey = "qb_live_YOUR_PROJECT_API_KEY";

$payload = json_encode([
    'to'      => '+8801700000000',
    'message' => "Your order #104 has been confirmed!"
]);

$ch = curl_init($apiUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Authorization: Bearer ' . $apiKey
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo "HTTP {$httpCode}: {$response}";
```

---

### 2. Node.js (Fetch / Axios)
```javascript
const res = await fetch('https://whatsflow.yourdomain.com/api/v1/projects/proj_YOUR_ID/send-message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer qb_live_YOUR_PROJECT_API_KEY'
  },
  body: JSON.stringify({
    to: '+8801700000000',
    message: 'Your verification code is: 482910'
  })
});

const data = await res.json();
console.log(data);
```

---

### 3. Python (Requests)
```python
import requests

url = "https://whatsflow.yourdomain.com/api/v1/projects/proj_YOUR_ID/send-message"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer qb_live_YOUR_PROJECT_API_KEY"
}
payload = {
    "to": "+8801700000000",
    "message": "Hello from Python WhatsApp integration!"
}

response = requests.post(url, json=payload, headers=headers)
print(response.status_code, response.json())
```

---

### 4. cURL (Terminal)
```bash
curl -X POST https://whatsflow.yourdomain.com/api/v1/projects/proj_YOUR_ID/send-message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer qb_live_YOUR_PROJECT_API_KEY" \
  -d '{
    "to": "+8801700000000",
    "message": "Instant notification via WhatsFlow API Gateway."
  }'
```

---

## Project Directory Structure

```
WhatsFlow/
├── .env.example                     # Environment variables template
├── .gitignore                       # Clean repository ignore configuration
├── package.json                     # Node.js manifest and scripts
├── package-lock.json                # Pinned dependency tree
├── README.md                        # Documentation and system manual
├── ReadmeIMG.png                    # Application visual dashboard preview
├── schema.sql                       # MySQL / MariaDB database schema
├── supabase_schema.sql              # Supabase PostgreSQL database schema
│
├── public/                          # Frontend SPA Dashboard
│   ├── index.html                   # Core dashboard & visual canvas markup
│   ├── css/
│   │   └── style.css                # Dark/light theme styles & glassmorphic UI
│   └── js/
│       ├── app.js                   # Application router & lifecycle controller
│       ├── auth.js                  # User authentication & token state
│       ├── automations.js           # Multi-project keyword rules manager
│       ├── messages.js              # Real-time live messaging stream feed
│       ├── projects.js              # Multi-tenant project workspace controller
│       ├── socket.js                # Authenticated real-time WebSocket client
│       └── workflows.js             # Visual node graph builder & test runner
│
├── server/                          # Backend Core Engine
│   ├── config.js                    # Environment settings loader
│   ├── index.js                     # Express HTTP + WebSocket server gateway
│   ├── db/
│   │   └── db.js                    # Unified Supabase, MySQL & Local Data engine
│   ├── engine/
│   │   ├── automations.js           # Inbound message parsing & trigger matcher
│   │   ├── flowRunner.js            # Multi-step state machine (e.g. QuickBite)
│   │   └── workflowRunner.js        # Graph traversal node execution engine
│   ├── middleware/
│   │   └── rateLimiter.js           # Sliding-window rate limiter & IP protection
│   ├── routes/
│   │   └── api.js                   # REST API routes & project endpoints
│   ├── utils/
│   │   └── ssrfFilter.js            # DNS & IP Server-Side Request Forgery filter
│   ├── whatsapp/
│   │   ├── manager.js               # Baileys Multi-Device socket manager
│   │   └── simulator.js             # Local testing chatbot simulator
│   ├── data/                        # Local storage data directory (.gitkeep)
│   └── sessions/                    # WhatsApp Multi-Device session storage (.gitkeep)
│
└── test/                            # Automated Verification Test Suites
    ├── test_flow.js                 # Core engine, auth HMAC, SSRF & rate limit tests
    └── verify_endpoints.js          # Live HTTP API, BOLA & security endpoint tests
```

---

## Security & Quality Standards

- **OWASP Top 10 API Security Compliant**: Mitigates BOLA/IDOR, Broken Authentication, SSRF, Rate Limiting Bypass, and Unrestricted Resource Consumption.
- **Strict Content Security Policy**: CSP, COOP, CORP, and nosniff headers enforce browser-level isolation.
- **Zero Test Leftovers**: Automated test runners automatically clean up test data immediately upon completion, keeping production databases pristine.

---

## Automated Verification & Test Suites

Run the complete automated test suite locally or in CI/CD pipelines:

```bash
npm test
```

### Verified Test Assertions:
```
[1] Database Initialization & Storage Fallback Engine  --> PASSED (✓)
[2] HMAC Token Signing, Expiration & Verification       --> PASSED (✓)
[3] Timing-Safe API Key Verification                    --> PASSED (✓)
[4] SSRF DNS Resolution & Private IP Blockers           --> PASSED (✓)
[5] Sliding Window Rate Limiting & Auth Protection       --> PASSED (✓)
[6] Multi-Tenant Project Creation & Dedicated Keys       --> PASSED (✓)
[7] Project-Linked Automations & Inbound Parsing        --> PASSED (✓)
[8] Visual Workflow Graph Execution & Node Traversal    --> PASSED (✓)
[9] Protected Route Unauthorized Rejection (401)        --> PASSED (✓)
[10] BOLA / Cross-Tenant Project Key Guard (403)        --> PASSED (✓)
[11] Unauthenticated Forgot-Password Protection         --> PASSED (✓)
[12] Authenticated Password Change Verification         --> PASSED (✓)
```

---

## License

This project is licensed under the **MIT License**. You are free to use, modify, and distribute it for personal and commercial applications.
