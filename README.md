# WhatsFlow — Minimal WhatsApp Automation, Bot Workflow & REST API Gateway

<div align="center">

![WhatsFlow Dashboard](ReadmeIMG.png)

[![Node.js Version](https://img.shields.io/badge/node.js-18%2B%20%7C%2020%2B%20%7C%2022%2B-black?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-black?style=for-the-badge)](LICENSE)
[![Tests Status](https://img.shields.io/badge/tests-passing%20(17%2F17)-success?style=for-the-badge&logo=githubactions)](https://github.com/hey-ashik/WhatsFlow)
[![Security Hardened](https://img.shields.io/badge/security-hardened-black?style=for-the-badge&logo=shield)](https://github.com/hey-ashik/WhatsFlow)
[![Multi-Device](https://img.shields.io/badge/whatsapp-multi--device%20ready-25D366?style=for-the-badge&logo=whatsapp)](https://github.com/hey-ashik/WhatsFlow)

<p align="center">
  <strong>A self-hosted, lightweight, and modern WhatsApp automation platform and REST API Gateway.</strong><br>
  Connect any phone number via QR Code, build keyword auto-reply bots, manage multi-project API keys, and send WhatsApp messages directly from PHP, Node.js, Python, or external webhooks with <strong>zero Meta Business API fees</strong>.
</p>

</div>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Quick Start (Local Setup)](#-quick-start-local-setup)
- [Server Deployment Guide](#-server-deployment-guide)
  - [Deploying on Hostinger Node.js Hosting](#1-deploying-on-hostinger-nodejs-hosting)
  - [Deploying on VPS (Ubuntu / Debian with PM2 & Nginx)](#2-deploying-on-vps-ubuntu--debian-with-pm2--nginx)
- [Environment Configuration](#-environment-configuration)
- [API Integration Examples](#-api-integration-examples)
  - [PHP (cURL / QuickBite)](#1-php-curl--quickbite)
  - [Node.js (Fetch)](#2-nodejs-fetch)
  - [Python (Requests)](#3-python-requests)
  - [cURL (Terminal)](#4-curl-terminal)
- [Project Directory Structure](#-project-directory-structure)
- [Automated Testing & Security Verification](#-automated-testing--security-verification)
- [License](#-license)

---

## 💡 Overview

**WhatsFlow** is built for developers and businesses who want a fast, reliable, and self-hosted WhatsApp integration without recurring per-message fees or complicated Meta Business account approvals.

Whether you are sending automated order receipts from an e-commerce store (like **QuickBite**), delivering OTP verification codes, building customer support auto-responders, or relaying incoming WhatsApp messages to custom webhooks, WhatsFlow handles the entire multi-device socket lifecycle out of the box.

---

## ✨ Key Features

- **📱 One-Click QR Code Device Connection**: Link any standard or business WhatsApp number in seconds using the WhatsApp Multi-Device protocol.
- **⚡ 24/7 Online Presence Heartbeat**: Built-in background presence heartbeats prevent WhatsApp servers from putting companion sessions to sleep or disconnecting after idle periods.
- **🤖 Smart Keyword Automations**: Create powerful auto-reply rules with multiple trigger modes:
  - `Exact Match`: Triggered only when the message matches the keyword exactly.
  - `Contains Keyword`: Triggered when the message contains a specific word or phrase.
  - `Starts With`: Triggered when a message begins with a command prefix (e.g., `/help`, `!order`).
  - `Default Fallback`: Catch-all responder for any unmatched incoming inquiries.
- **🏢 Multi-Project Workspace & Dedicated API Keys**: Separate your stores, clients, or applications into distinct projects with dedicated API keys (`qb_live_...`) and separate webhook configurations.
- **🚀 Universal REST API Gateway**: Send WhatsApp messages programmatically via standard HTTP `POST` requests from any programming language.
- **🪝 Inbound Webhook Forwarding**: Automatically forward incoming WhatsApp customer replies to your external server endpoints in real time.
- **🛡️ Enterprise Security Hardened**:
  - HMAC-SHA256 cryptographically signed session tokens.
  - Constant-time API key verification preventing timing attacks.
  - SSRF (Server-Side Request Forgery) protection against private IP probing.
  - Sliding-window rate limiters for auth, API, and message dispatching.
  - Strict Content-Security-Policy (CSP) and HTTP security headers.
- **🎨 Sleek Monochrome UI & Collapsible Sidebar**:
  - Pure black-and-white minimalist design with dark and light themes.
  - Sticky desktop sidebar with a collapsible icon-rail mode (press <kbd>Ctrl</kbd>+<kbd>B</kbd>).
  - Fully responsive on mobile, tablet, and desktop screens.
- **💾 Zero-Setup Persistent Storage Engine**: Works out-of-the-box with built-in JSON file storage or connects seamlessly to **MySQL** or **Supabase** databases.

---

## 🏗️ System Architecture

```mermaid
flowchart LR
    A[Your Web App\nPHP / Node / Python] -->|HTTP POST + API Key| B(WhatsFlow REST API Gateway)
    B --> C{Automation Engine}
    C -->|Auto-Reply / Inbound| D[WhatsApp Multi-Device Manager\nBaileys Socket]
    D <-->|24/7 Web Socket Heartbeat| E((WhatsApp Servers))
    E <--> F[Customer Phone]
    C -->|Webhook Relay| G[External Webhook URL]
    B <--> H[(Database\nMySQL / Local Store)]
```

---

## 🚀 Quick Start (Local Setup)

### Prerequisites
- **Node.js** 18.0.0 or higher
- **npm** (comes with Node.js)

### 1. Clone & Install
```bash
# Clone the repository
git clone https://github.com/hey-ashik/WhatsFlow.git

# Navigate into project directory
cd WhatsFlow

# Install dependencies
npm install
```

### 2. Run Automated Verification Tests
```bash
npm test
```

### 3. Start the Server
```bash
npm start
```

Open your browser and navigate to **`http://localhost:3005`**.

1. Create your administrator account on the welcome screen.
2. Go to **Connect Device** and click **Generate QR Code**.
3. Open WhatsApp on your phone > **Linked Devices** > **Link a Device**, and scan the QR code.
4. Your device is now connected and ready to send & receive messages!

---

## 🌐 Server Deployment Guide

### 1. Deploying on Hostinger Node.js Hosting

Hostinger Cloud & Business hosting plans support running Node.js applications directly via **hPanel**:

1. **Push your code to GitHub** (or upload files via FTP / File Manager).
2. Open **Hostinger hPanel** > Go to **Websites** > Click **Manage** on your domain or subdomain (e.g., `whatsflow.yourdomain.com`).
3. Under the **Advanced** or **Software** section, click **Node.js**.
4. Configure the application settings:
   - **Node.js Version**: `20.x` or `22.x`
   - **Application Mode**: `Production`
   - **Application Root**: `public_html` (or your subdomain folder)
   - **Application Startup File**: `server/index.js`
5. Click **Create Application**.
6. In the **Environment Variables** section of hPanel, add:
   ```env
   NODE_ENV=production
   PORT=3005
   API_KEY=qb_live_your_master_secret_key
   ```
7. *(Optional MySQL setup)*: Create a database in Hostinger MySQL, import [schema.sql](schema.sql), and add `DB_HOST=127.0.0.1`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`. If omitted, WhatsFlow uses its fast built-in persistent storage.
8. Click **NPM Install** in hPanel, then click **Restart Application**.
9. Visit your domain, scan your QR code once, and your WhatsApp Gateway will run online 24/7!

---

### 2. Deploying on VPS (Ubuntu / Debian with PM2 & Nginx)

```bash
# 1. Install Node.js & PM2 on your VPS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# 2. Clone the repository
git clone https://github.com/hey-ashik/WhatsFlow.git /var/www/whatsflow
cd /var/www/whatsflow

# 3. Install production dependencies
npm install --omit=dev

# 4. Copy environment file and configure
cp .env.example .env
nano .env

# 5. Start with PM2 process manager
pm2 start server/index.js --name whatsflow
pm2 save
pm2 startup
```

#### Nginx Reverse Proxy Configuration (`/etc/nginx/sites-available/whatsflow`)
```nginx
server {
    server_name whatsflow.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory (refer to `.env.example`):

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3005` | HTTP server port |
| `API_KEY` | `qb_live_master_key` | Master administrative API key |
| `DB_HOST` | `127.0.0.1` | MySQL Database Host (Optional) |
| `DB_PORT` | `3306` | MySQL Port (Optional) |
| `DB_USER` | `root` | MySQL Username (Optional) |
| `DB_PASSWORD` | `""` | MySQL Password (Optional) |
| `DB_NAME` | `whatsflow_db` | MySQL Database Name (Optional) |
| `SUPABASE_URL` | `""` | Supabase Project URL (Optional) |
| `SUPABASE_KEY` | `""` | Supabase Anon / Service Role Key (Optional) |

> **Note**: If MySQL or Supabase credentials are not provided, WhatsFlow automatically activates its built-in local persistent storage in `server/data/whatsflow_store.json`.

---

## 💻 API Integration Examples

### 1. PHP (cURL / QuickBite)
```php
<?php
function sendWhatsAppNotification($toPhoneNumber, $messageText) {
    $endpoint = "https://whatsflow.yourdomain.com/api/v1/send-message";
    $apiKey   = "qb_live_YOUR_PROJECT_API_KEY";

    $payload = json_encode([
        'to'      => $toPhoneNumber,
        'message' => $messageText
    ]);

    $ch = curl_init($endpoint);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey
    ]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ['status' => $httpCode, 'data' => json_decode($response, true)];
}

// Example: Send Order Confirmation
sendWhatsAppNotification("+8801700000000", "🍔 QuickBite Order #104 has been confirmed!");
?>
```

### 2. Node.js (Fetch)
```javascript
async function sendWhatsApp(to, message) {
  const res = await fetch('https://whatsflow.yourdomain.com/api/v1/send-message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer qb_live_YOUR_PROJECT_API_KEY'
    },
    body: JSON.stringify({ to, message })
  });

  return await res.json();
}

// Example usage:
sendWhatsApp('+8801700000000', 'Your verification code is: 489201');
```

### 3. Python (Requests)
```python
import requests

def send_whatsapp(to_phone, message):
    url = "https://whatsflow.yourdomain.com/api/v1/send-message"
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer qb_live_YOUR_PROJECT_API_KEY"
    }
    payload = {
        "to": to_phone,
        "message": message
    }
    
    response = requests.post(url, json=payload, headers=headers, timeout=10)
    return response.json()

# Example usage:
send_whatsapp("+8801700000000", "Hello from WhatsFlow Python Client!")
```

### 4. cURL (Terminal)
```bash
curl -X POST https://whatsflow.yourdomain.com/api/v1/send-message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer qb_live_YOUR_PROJECT_API_KEY" \
  -d '{
    "to": "+8801700000000",
    "message": "Hello from WhatsFlow API Gateway!"
  }'
```

---

## 📁 Project Directory Structure

```
WhatsFlow/
├── server/
│   ├── index.js                  # Express HTTP & WebSocket server entry point
│   ├── config.js                 # Environment configuration loader
│   ├── db/
│   │   └── db.js                 # Unified database manager (MySQL + Supabase + Local)
│   ├── middleware/
│   │   └── rateLimiter.js        # Sliding-window security rate limiter
│   ├── utils/
│   │   └── ssrfFilter.js         # Anti-SSRF URL validator & IP filter
│   ├── engine/
│   │   ├── automations.js        # Keyword trigger matcher & webhook relay engine
│   │   └── flowRunner.js         # Multi-step conversational state engine
│   ├── routes/
│   │   └── api.js                # Secure REST API endpoints (/auth, /projects, /automations, /send-message)
│   └── whatsapp/
│       ├── manager.js            # Baileys Multi-Device socket manager & 24/7 presence heartbeat
│       └── simulator.js          # In-browser test phone simulator
├── public/
│   ├── index.html                # Single Page Application (SPA) dashboard
│   ├── css/
│   │   └── style.css             # Monochrome design system with collapsible sidebar & mobile layout
│   └── js/
│       ├── app.js                # SPA router, theme manager & keyboard shortcuts
│       ├── auth.js               # Client authentication state & profile manager
│       ├── projects.js           # Multi-project workspaces & API key manager
│       ├── automations.js        # Keyword rules editor & project-grouped views
│       ├── messages.js           # Test dispatcher & live message feed manager
│       └── socket.js             # Real-time WebSocket event listener
├── test/
│   ├── test_flow.js              # Unit tests for auth, HMAC tokens, SSRF, & engine
│   └── verify_endpoints.js       # Live HTTP security & endpoint verification suite
├── schema.sql                    # MySQL database schema definition
├── quickbite_webhook_example.php # Example webhook receiver script
├── package.json                  # Dependencies & test scripts
└── README.md                     # Documentation
```

---

## 🧪 Automated Testing & Security Verification

WhatsFlow includes an automated end-to-end security and functional test suite covering cryptographic signatures, timing attack protections, SSRF filtering, route authorization guards, and API gateways.

To run the complete test suite:
```bash
npm test
```

**Test Output:**
```
⚡ WhatsFlow Security & Backward Compatibility Test Suite
✓ Database initialized with clean settings and storage engine.
✓ Cryptographic HMAC token signing, verification, and tamper rejection verified.
✓ Timing-safe string comparisons verified.
✓ SSRF protections successfully block internal IPs, metadata endpoints, and non-http protocols.
✓ Rate limiting sliding window successfully throttles excessive traffic.
✓ Dedicated Project created with API Key.
✓ Project-Linked Automation matched and executed successfully.
🎉 ALL WHATSFLOW SECURITY & FUNCTIONAL TESTS PASSED! (7/7)

--- Running Live HTTP Endpoints Verification ---
✓ Protected route /settings correctly returns 401 Unauthorized for unauthenticated requests
✓ /auth/me returns 401 for unauthenticated callers
✓ /auth/register successfully creates user and returns signed HMAC token
✓ /auth/me with signed token verifies successfully
✓ Authenticated access to /settings succeeds
✓ Public API Gateway /send-message requires valid API Key
✓ Master API Key allows full administrative access
✓ Unauthenticated DELETE /messages returns 401
✓ Authenticated DELETE /messages clears feed successfully
✓ PUT /automations/:id updates automation state properly
🎉 ALL LIVE ENDPOINT SECURITY VERIFICATIONS PASSED! (10/10)
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE). Built for developers and businesses requiring flexible, self-hosted WhatsApp automation without official API barriers.
