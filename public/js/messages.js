/**
 * WhatsFlow Message Dispatcher & Live Stream Feed (with Skeleton Shimmer)
 */

function renderFeedSkeleton() {
  const container = document.getElementById('liveMessagesContainer');
  if (!container) return;

  container.innerHTML = Array(4).fill(0).map(() => `
    <div class="feed-skeleton-item">
      <div class="feed-header" style="margin-bottom: 6px;">
        <div class="skeleton skeleton-title" style="width: 110px; height: 12px;"></div>
        <div class="skeleton skeleton-subtitle" style="width: 50px; height: 10px;"></div>
      </div>
      <div class="skeleton skeleton-text" style="width: 90%; height: 12px; margin-bottom: 5px;"></div>
      <div class="skeleton skeleton-text" style="width: 65%; height: 12px;"></div>
    </div>
  `).join('');
}

async function loadLiveMessages() {
  const container = document.getElementById('liveMessagesContainer');
  const countEl = document.getElementById('statTotalMessages');
  if (!container) return;

  if (container.children.length === 0 || container.querySelector('.empty-state')) {
    renderFeedSkeleton();
  }

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch('/api/v1/messages?limit=50');
    const data = await res.json();

    if (data.success) {
      const messages = data.data;
      if (countEl) countEl.textContent = messages.length;

      if (messages.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No messages recorded yet.</p></div>`;
        return;
      }

      container.innerHTML = messages.map(msg => {
        const isIncoming = msg.direction === 'incoming';
        const timeStr = new Date(msg.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        const cleanFrom = String(msg.from_phone || '').replace(/[^0-9]/g, '');
        const cleanTo = String(msg.to_phone || '').replace(/[^0-9]/g, '');
        const party = isIncoming ? `+${cleanFrom}` : `To: +${cleanTo}`;

        return `
          <div class="feed-item ${isIncoming ? 'incoming' : 'outgoing'}">
            <div class="feed-header">
              <span class="feed-phone"><i class="fa-solid ${isIncoming ? 'fa-arrow-down-left' : 'fa-arrow-up-right'}"></i> ${escapeHtml(party)}</span>
              <span>${timeStr}</span>
            </div>
            <div class="feed-body">${escapeHtml(msg.message_text)}</div>
            ${msg.automation_matched ? `<div style="font-size: 10px; color: var(--success); margin-top: 4px;"><i class="fa-solid fa-bolt"></i> ${escapeHtml(msg.automation_matched)}</div>` : ''}
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Error loading live messages:', err);
  }
}

async function clearLiveMessages() {
  if (!confirm('Are you sure you want to clear all recorded live messages?')) return;
  const container = document.getElementById('liveMessagesContainer');
  const countEl = document.getElementById('statTotalMessages');

  // Optimistic UI clear
  if (container) {
    container.innerHTML = `<div class="empty-state"><p>No messages recorded yet.</p></div>`;
  }
  if (countEl) countEl.textContent = '0';

  try {
    const safeFetch = window.authFetch || fetch;
    const res = await safeFetch('/api/v1/messages', { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Live messages feed cleared successfully.', 'success');
    } else {
      showToast(data.error || 'Failed to clear messages.', 'error');
      loadLiveMessages();
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    loadLiveMessages();
  }
}

// Attach Form Handlers
document.addEventListener('DOMContentLoaded', () => {
  // Main dispatch form
  const sendForm = document.getElementById('sendMessageForm');
  if (sendForm) {
    sendForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const apiKey = document.getElementById('testApiKeyInput').value.trim();
      const to = document.getElementById('testToPhoneInput').value.trim();
      const message = document.getElementById('testMessageTextInput').value.trim();
      const btn = document.getElementById('btnSubmitMessage');

      if (!to || !message) {
        showToast('Please fill in recipient number and message text.', 'error');
        return;
      }

      try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Dispatching...';

        const res = await fetch('/api/v1/send-message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({ to, message })
        });

        const result = await res.json();
        if (result.success) {
          showToast('Message sent to WhatsApp recipient!', 'success');
          document.getElementById('testMessageTextInput').value = '';
          loadLiveMessages();
        } else {
          showToast(result.error || 'Failed to send message.', 'error');
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Message';
      }
    });
  }
});
