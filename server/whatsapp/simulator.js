const db = require('../db/db');
const automationEngine = require('../engine/automations');

class WhatsAppSimulator {
  constructor() {
    this.wsBroadcaster = null;
    this.defaultBotNumber = '8801900000000';
  }

  setBroadcaster(broadcaster) {
    this.wsBroadcaster = broadcaster;
  }

  broadcast(type, data) {
    if (this.wsBroadcaster) {
      this.wsBroadcaster(type, data);
    }
  }

  /**
   * Simulate a customer (Number Y) sending a WhatsApp message to the connected bot (Number X)
   */
  async simulateMessage({ fromPhone = '8801712345678', senderName = 'Customer Y', text = 'hi' }) {
    const cleanFrom = String(fromPhone).replace(/[^0-9]/g, '');
    const cleanText = text.trim();
    const session = await db.getSession('default');
    const botNumber = session.phone_number || this.defaultBotNumber;

    // 1. Record incoming simulated message
    const incomingRecord = await db.saveMessage({
      message_id: `sim_in_${Date.now()}`,
      session_id: 'simulator',
      from_phone: cleanFrom,
      to_phone: botNumber,
      direction: 'incoming',
      message_text: cleanText,
      status: 'received'
    });

    this.broadcast('message_received', {
      from: cleanFrom,
      name: senderName,
      text: cleanText,
      isSimulated: true,
      time: incomingRecord.created_at
    });

    // 2. Process via Automation Engine
    let replyResult = null;
    try {
      replyResult = await automationEngine.processIncomingMessage({
        from: cleanFrom,
        text: cleanText,
        pushName: senderName,
        messageId: incomingRecord.message_id,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error('[Simulator] Automation processing error:', err.message);
    }

    let outgoingRecord = null;
    if (replyResult && replyResult.replyText) {
      // 3. Record outgoing simulated bot reply
      outgoingRecord = await db.saveMessage({
        message_id: `sim_out_${Date.now()}`,
        session_id: 'simulator',
        from_phone: botNumber,
        to_phone: cleanFrom,
        direction: 'outgoing',
        message_text: replyResult.replyText,
        automation_matched: replyResult.automationMatched,
        status: 'delivered'
      });

      this.broadcast('message_sent', {
        to: cleanFrom,
        text: replyResult.replyText,
        automation: replyResult.automationMatched,
        isSimulated: true,
        time: outgoingRecord.created_at
      });
    }

    return {
      incoming: incomingRecord,
      reply: outgoingRecord ? outgoingRecord.message_text : null,
      automation: replyResult?.automationMatched || null,
      flowCompleted: replyResult?.flowCompleted || false
    };
  }
}

const whatsappSimulator = new WhatsAppSimulator();
module.exports = whatsappSimulator;
