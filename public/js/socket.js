// WebSocket Manager for Real-Time Event Streaming
class WSSocket {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.reconnectTimer = null;
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem('whatsflow_token');
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
    const wsUrl = `${protocol}//${window.location.host}${tokenParam}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] Connected to WhatsFlow live server.');
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.emit(payload.type, payload.data);
        } catch (e) {
          console.error('[WS] Message parse error:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[WS] Connection lost. Reconnecting in 3s...');
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = (err) => {
        console.warn('[WS] Socket error:', err);
      };
    } catch (e) {
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    }
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
    // Wildcard listener
    if (this.listeners['*']) {
      this.listeners['*'].forEach(cb => cb(event, data));
    }
  }
}

window.socketClient = new WSSocket();
window.socketClient.connect();
