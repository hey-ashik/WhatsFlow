const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const config = require('../config');
const db = require('../db/db');
const automationEngine = require('../engine/automations');

class WhatsAppManager {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // disconnected, generating_qr, scanning, pairing, connecting, connected
    this.qrCode = null;
    this.phone = null;
    this.displayName = null;
    this.wsBroadcaster = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20;
    this.authFolder = path.join(config.paths.sessions, 'auth_info_baileys');
    this.isStarting = false;
    this.reconnectTimer = null;
    this.presenceTimer = null;
    this.lidPhoneMap = new Map(); // Maps WhatsApp LIDs to real phone numbers
  }

  setBroadcaster(broadcaster) {
    this.wsBroadcaster = broadcaster;
  }

  broadcast(type, data) {
    if (this.wsBroadcaster) {
      try {
        this.wsBroadcaster(type, data);
      } catch (e) {}
    }
  }

  getStatus() {
    return {
      status: this.status,
      phone: this.phone,
      displayName: this.displayName,
      qrCode: this.qrCode,
      hasAuth: this.hasSavedAuth(),
      platform: 'WhatsApp Multi-Device'
    };
  }

  hasSavedAuth() {
    try {
      const credsFile = path.join(this.authFolder, 'creds.json');
      if (fs.existsSync(credsFile)) {
        const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
        return Boolean(creds && (creds.registered || creds.me || creds.account));
      }
    } catch (e) {}
    return false;
  }

  async init() {
    if (!fs.existsSync(this.authFolder)) {
      fs.mkdirSync(this.authFolder, { recursive: true });
    }

    const sessionData = await db.getSession('default');
    if (sessionData) {
      if (sessionData.phone_number) this.phone = sessionData.phone_number;
      if (sessionData.display_name) this.displayName = sessionData.display_name;
    }

    if (this.hasSavedAuth()) {
      console.log('[WhatsApp] Saved credentials found in auth folder. Resuming active WhatsApp session in background...');
      this.status = 'connected'; // Keep stable status in DB and memory across web app logins/logouts
      await db.updateSession('default', {
        status: 'connected',
        phone_number: this.phone,
        display_name: this.displayName,
        qr_code: null
      });
      this.startSession(false).catch(err => {
        console.warn('[WhatsApp] Background auto-connect notice:', err.message);
      });
      return;
    }

    console.log('[WhatsApp] Ready for QR pairing.');
    this.status = 'disconnected';
    await db.updateSession('default', { status: 'disconnected', qr_code: null });
  }

  // Start continuous presence heartbeat to keep WhatsApp multi-device companion session alive 24/7
  startPresenceHeartbeat() {
    if (this.presenceTimer) clearInterval(this.presenceTimer);

    this.presenceTimer = setInterval(async () => {
      if (this.sock && this.status === 'connected') {
        try {
          await this.sock.sendPresenceUpdate('available');
        } catch (e) {
          // Socket might be temporarily reconnecting in background
        }
      }
    }, 25000); // 25s heartbeat prevents WhatsApp servers from putting session to sleep
  }

  stopPresenceHeartbeat() {
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
  }

  // Extract Real Phone Number from WhatsApp Message (decodes LIDs and extracts phone JID)
  extractRealPhoneNumber(msg, remoteJid) {
    const rawRemote = String(remoteJid || '').trim();
    let phoneCandidate = '';

    // 1. Direct participant phone JID
    const part = msg?.key?.participant || msg?.participant || '';
    if (part && part.includes('@s.whatsapp.net')) {
      phoneCandidate = part.split('@')[0].split(':')[0];
    } else if (msg?.key?.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
      phoneCandidate = msg.key.remoteJidAlt.split('@')[0].split(':')[0];
    } else if (msg?.key?.participantPn && msg.key.participantPn.includes('@s.whatsapp.net')) {
      phoneCandidate = msg.key.participantPn.split('@')[0].split(':')[0];
    } else if (rawRemote.includes('@s.whatsapp.net')) {
      phoneCandidate = rawRemote.split('@')[0].split(':')[0];
    }

    if (phoneCandidate) {
      const cleanDigits = phoneCandidate.replace(/[^0-9]/g, '');
      if (cleanDigits && cleanDigits.length >= 7) {
        if (rawRemote.includes('@lid')) {
          this.lidPhoneMap.set(rawRemote, cleanDigits);
          this.lidPhoneMap.set(rawRemote.split('@')[0], cleanDigits);
        }
        return cleanDigits;
      }
    }

    // 2. Check cached LID mapping
    const lidKey = rawRemote.split('@')[0];
    if (this.lidPhoneMap.has(rawRemote)) {
      return this.lidPhoneMap.get(rawRemote);
    }
    if (this.lidPhoneMap.has(lidKey)) {
      return this.lidPhoneMap.get(lidKey);
    }

    // 3. Fallback: clean digits from remoteJid
    return rawRemote.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  }

  async startSession(fresh = false) {
    if (this.isStarting) {
      console.log('[WhatsApp] startSession already in progress...');
      return this.getStatus();
    }

    this.isStarting = true;

    try {
      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners();
          this.sock.end(undefined);
        } catch (e) {}
        this.sock = null;
      }

      // Wipe auth folder only if explicitly requested
      if (fresh) {
        console.log('[WhatsApp] Wiping auth folder for fresh QR generation...');
        this.cleanAuthFolder();
        this.phone = null;
        this.displayName = null;
        this.status = 'generating_qr';
        this.qrCode = null;
        this.broadcast('status', this.getStatus());
        await db.updateSession('default', {
          status: 'generating_qr',
          qr_code: null,
          phone_number: null,
          display_name: null
        });
      } else if (!this.hasSavedAuth()) {
        this.status = 'generating_qr';
        this.qrCode = null;
        this.broadcast('status', this.getStatus());
        await db.updateSession('default', {
          status: 'generating_qr',
          qr_code: null
        });
      } else {
        // Keep status as connected so UI remains connected across web app logouts
        this.status = 'connected';
      }

      // Load Multi-file auth state
      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

      console.log(`[WhatsApp] Booting Baileys multi-device socket (v${version.join('.')})...`);

      this.sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.windows('Desktop'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        markOnlineOnConnect: true,
        getMessage: async () => undefined
      });

      // Save credentials when updated
      this.sock.ev.on('creds.update', async () => {
        try {
          await saveCreds();
        } catch (saveErr) {
          console.error('[WhatsApp] Error saving creds:', saveErr.message);
        }
      });

      // Cache Contact LID mappings
      this.sock.ev.on('contacts.upsert', (contacts) => {
        for (const c of contacts) {
          if (c.id && c.lid) {
            const phone = c.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            const lid = c.lid.split('@')[0];
            if (phone && lid) {
              this.lidPhoneMap.set(c.lid, phone);
              this.lidPhoneMap.set(lid, phone);
            }
          }
        }
      });

      this.sock.ev.on('contacts.update', (updates) => {
        for (const c of updates) {
          if (c.id && c.lid) {
            const phone = c.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            const lid = c.lid.split('@')[0];
            if (phone && lid) {
              this.lidPhoneMap.set(c.lid, phone);
              this.lidPhoneMap.set(lid, phone);
            }
          }
        }
      });

      // Connection updates handler
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // QR Code Received
        if (qr) {
          try {
            this.status = 'scanning';
            this.qrCode = await qrcode.toDataURL(qr, {
              margin: 2,
              scale: 8,
              color: { dark: '#000000', light: '#ffffff' }
            });
            console.log('[WhatsApp] ✓ QR Code ready for scanning with phone.');
            await db.updateSession('default', { status: 'scanning', qr_code: this.qrCode });
            this.broadcast('qr', { qrCode: this.qrCode });
            this.broadcast('status', this.getStatus());
          } catch (qrErr) {
            console.error('[WhatsApp] QR encoding error:', qrErr.message);
          }
        }

        // Connection Open (Paired & Active 24/7)
        if (connection === 'open') {
          console.log('[WhatsApp] 🟢 CONNECTED & ACTIVE — WhatsApp Multi-Device Session Online!');
          this.reconnectAttempts = 0;
          this.status = 'connected';
          this.qrCode = null;

          const user = this.sock.user;
          this.phone = user?.id ? user.id.split(':')[0].split('@')[0] : (this.phone || 'Linked Device');
          this.displayName = user?.name || user?.verifiedName || user?.notify || `WhatsApp (${this.phone})`;

          await db.updateSession('default', {
            status: 'connected',
            phone_number: this.phone,
            display_name: this.displayName,
            qr_code: null
          });

          // Start proactive presence heartbeat
          this.startPresenceHeartbeat();

          this.broadcast('status', this.getStatus());
        }

        // Connection Closed
        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403;
          const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;

          console.log(`[WhatsApp] Connection closed (code: ${statusCode}, isRestartRequired: ${isRestartRequired}, isLoggedOut: ${isLoggedOut})`);

          this.stopPresenceHeartbeat();

          if (isLoggedOut) {
            console.log('[WhatsApp] Explicitly logged out from WhatsApp on phone. Resetting auth...');
            this.status = 'disconnected';
            this.qrCode = null;
            this.phone = null;
            this.displayName = null;
            this.cleanAuthFolder();
            await db.updateSession('default', { status: 'disconnected', qr_code: null, phone_number: null, display_name: null });
            this.broadcast('status', this.getStatus());
            await db.addLog('info', 'WhatsApp Device Logged Out', 'Session terminated by phone.');
            return;
          }

          // If session is saved on disk, execute a seamless silent reconnect without flapping the UI
          if (this.hasSavedAuth()) {
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            const delay = isRestartRequired ? 1000 : Math.min(1500 * Math.max(1, this.reconnectAttempts), 8000);
            this.reconnectAttempts++;

            console.log(`[WhatsApp] ⚡ Seamless background auto-reconnect in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            this.reconnectTimer = setTimeout(() => {
              this.isStarting = false;
              this.startSession(false).catch(err => {
                console.error('[WhatsApp] Silent auto-reconnect error:', err.message);
              });
            }, delay);
          } else {
            this.status = 'disconnected';
            this.broadcast('status', this.getStatus());
            await db.updateSession('default', { status: 'disconnected' });
          }
        }
      });

      // Incoming messages upsert (Real phone extraction & LID resolution)
      this.sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
          if (msg.key.fromMe) continue;

          const remoteJid = msg.key.remoteJid || '';
          if (remoteJid.endsWith('@g.us')) continue; // Skip groups
          if (remoteJid === 'status@broadcast') continue; // Skip status broadcasts

          // Extract the real phone number (cleanly resolved from participant / LID map)
          const realPhone = this.extractRealPhoneNumber(msg, remoteJid);
          const senderName = msg.pushName || 'User';

          let messageText = '';
          if (msg.message?.conversation) {
            messageText = msg.message.conversation;
          } else if (msg.message?.extendedTextMessage?.text) {
            messageText = msg.message.extendedTextMessage.text;
          } else if (msg.message?.imageMessage?.caption) {
            messageText = msg.message.imageMessage.caption;
          } else if (msg.message?.buttonsResponseMessage?.selectedButtonId) {
            messageText = msg.message.buttonsResponseMessage.selectedButtonId;
          } else if (msg.message?.templateButtonReplyMessage?.selectedId) {
            messageText = msg.message.templateButtonReplyMessage.selectedId;
          } else if (msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
            messageText = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
          }

          if (!messageText) continue;

          console.log(`[WhatsApp Inbound] From ${realPhone} (JID: ${remoteJid}, Name: ${senderName}): "${messageText}"`);

          await db.saveMessage({
            message_id: msg.key.id,
            from_phone: realPhone,
            to_phone: this.phone || 'self',
            direction: 'incoming',
            message_text: messageText,
            status: 'received'
          });

          this.broadcast('message_received', {
            from: realPhone,
            name: senderName,
            text: messageText,
            time: new Date().toISOString()
          });

          try {
            const autoResult = await automationEngine.processIncomingMessage({
              from: realPhone,
              remoteJid: remoteJid,
              text: messageText,
              pushName: senderName,
              messageId: msg.key.id,
              timestamp: msg.messageTimestamp
            });

            if (autoResult && autoResult.replyText) {
              // Crucial: Reply to remoteJid for protocol delivery, but pass realPhone for display logs
              await this.sendMessage(remoteJid, autoResult.replyText, autoResult.automationMatched, realPhone);
            }
          } catch (procErr) {
            console.error('[WhatsApp] Automation execution error:', procErr.message);
          }
        }
      });

      this.isStarting = false;
      return this.getStatus();
    } catch (err) {
      this.isStarting = false;
      console.error('[WhatsApp] startSession error:', err.message);
      this.status = this.hasSavedAuth() ? 'connected' : 'disconnected';
      throw err;
    }
  }

  cleanAuthFolder() {
    if (fs.existsSync(this.authFolder)) {
      try {
        const files = fs.readdirSync(this.authFolder);
        for (const file of files) {
          try {
            fs.rmSync(path.join(this.authFolder, file), { recursive: true, force: true });
          } catch (e) {}
        }
        console.log('[WhatsApp] Cleaned auth files in:', this.authFolder);
      } catch (err) {
        console.warn('[WhatsApp] Clean auth notice:', err.message);
      }
    }
  }

  async requestPairingCode(phoneNumber) {
    if (!this.sock) {
      await this.startSession(false);
    }
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const code = await this.sock.requestPairingCode(cleanPhone);
    return code;
  }

  async sendMessage(destination, text, automationName = null, realPhone = null) {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('WhatsApp device is not connected.');
    }

    const destStr = String(destination).trim();
    let jid;

    if (destStr.includes('@')) {
      jid = destStr;
    } else {
      const cleanPhone = destStr.replace(/[^0-9]/g, '');
      jid = `${cleanPhone}@s.whatsapp.net`;
    }

    // Determine clean real phone number to display in logs and UI
    let displayPhone = realPhone ? String(realPhone).replace(/[^0-9]/g, '') : null;
    if (!displayPhone) {
      const candidate = destStr.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
      displayPhone = this.lidPhoneMap.get(destStr) || this.lidPhoneMap.get(candidate) || candidate;
    }

    console.log(`[WhatsApp Outbound] Sending to ${jid} (Display: +${displayPhone}): ${text.slice(0, 60)}...`);

    const result = await this.sock.sendMessage(jid, { text });

    await db.saveMessage({
      message_id: result?.key?.id || `out_${Date.now()}`,
      from_phone: this.phone || 'self',
      to_phone: displayPhone,
      direction: 'outgoing',
      message_text: text,
      automation_matched: automationName,
      status: 'sent'
    });

    this.broadcast('message_sent', {
      to: displayPhone,
      text,
      automation: automationName,
      time: new Date().toISOString()
    });

    return result;
  }

  // Graceful stop: closes socket without deleting saved credentials
  async gracefulStop() {
    this.stopPresenceHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners();
        this.sock.end(undefined);
      } catch (e) {}
      this.sock = null;
    }
    console.log('[WhatsApp] Socket stopped gracefully. Credentials preserved on disk.');
  }

  // Explicit Disconnect: Triggered ONLY when the user clicks "Disconnect Device" button
  async disconnect() {
    this.stopPresenceHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (e) {}
      try {
        this.sock.end(undefined);
      } catch (e) {}
    }

    this.sock = null;
    this.status = 'disconnected';
    this.qrCode = null;
    this.phone = null;
    this.displayName = null;
    this.cleanAuthFolder();

    await db.updateSession('default', {
      status: 'disconnected',
      qr_code: null,
      phone_number: null,
      display_name: null
    });

    this.broadcast('status', this.getStatus());
    await db.addLog('info', 'WhatsApp Session Reset', 'Session explicitly disconnected and credentials deleted by user.');
    return true;
  }

  async resetSession() {
    return this.disconnect();
  }
}

const manager = new WhatsAppManager();
module.exports = manager;
