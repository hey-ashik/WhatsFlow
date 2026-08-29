const db = require('../db/db');
const flowRunner = require('./flowRunner');
const workflowRunner = require('./workflowRunner');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { validateSSRFUrl } = require('../utils/ssrfFilter');

class AutomationEngine {
  /**
   * Process an incoming message and determine the appropriate response
   * @param {Object} incomingMsg - { from, text, pushName, messageId, timestamp }
   * @returns {Object} { replyText, automationMatched, flowCompleted, replyType }
   */
  async processIncomingMessage(incomingMsg) {
    const rawText = (incomingMsg.text || '').trim();
    const lowerText = rawText.toLowerCase();
    const phone = String(incomingMsg.from || '').replace(/[^0-9]/g, '');
    const senderName = String(incomingMsg.pushName || 'User').slice(0, 100);

    // 1. Check if Bot is Enabled
    const botEnabled = await db.getSetting('bot_enabled', '1');
    if (botEnabled === '0' || botEnabled === false) {
      await db.addLog('info', 'Message Received (Bot Disabled)', { phone, text: rawText.slice(0, 100) });
      return null;
    }

    // 2. Fetch or initialize contact record
    const contact = (await db.getContact(phone)) || (await db.saveContact(phone, { name: senderName }));

    // 3. Handle Cancel Command
    if (lowerText === 'cancel' || lowerText === '/cancel') {
      if (contact.current_flow) {
        await db.clearContactFlow(phone);
        await db.addLog('trigger', 'Flow Cancelled by User', { phone });
        return {
          replyText: '🛑 *Conversation cancelled.*\n\nSend *hi* or *menu* to explore available options.',
          automationMatched: 'Cancel Flow Command',
          replyType: 'text'
        };
      }
    }

    // 4. Handle Active Multi-Step Conversation Flow
    if (contact.current_flow && contact.current_step) {
      const flowResult = await flowRunner.handleStep(
        phone,
        rawText,
        contact.current_flow,
        contact.current_step,
        contact.flow_data || {}
      );
      return {
        replyText: flowResult.reply,
        automationMatched: `Flow: ${contact.current_flow} (${contact.current_step})`,
        flowCompleted: flowResult.completed,
        replyType: 'flow'
      };
    }

    // 5. Match against configured Automation Rules
    const automations = await db.getAutomations();
    const activeRules = automations.filter(a => Number(a.is_active) === 1);

    for (const rule of activeRules) {
      const triggerVal = (rule.trigger_value || '').toLowerCase().trim();
      let isMatch = false;

      switch (rule.trigger_type) {
        case 'exact':
          isMatch = (lowerText === triggerVal);
          break;
        case 'contains':
          isMatch = lowerText.includes(triggerVal);
          break;
        case 'starts_with':
          isMatch = lowerText.startsWith(triggerVal);
          break;
        case 'regex':
          try {
            // Guard against ReDoS: limit input length and trigger pattern length
            if (rawText.length <= 500 && rule.trigger_value.length <= 100) {
              const re = new RegExp(rule.trigger_value, 'i');
              isMatch = re.test(rawText);
            }
          } catch (e) {
            isMatch = false;
          }
          break;
        default:
          isMatch = false;
      }

      if (isMatch) {
        await db.incrementAutomationCount(rule.id);
        await db.addLog('trigger', `Rule Triggered: ${rule.name}`, {
          ruleId: rule.id,
          phone,
          trigger: rule.trigger_value
        });

        // If this rule starts a flow
        if (rule.response_type === 'flow') {
          const flowKey = rule.response_content || 'quickbite_onboarding';
          const flowResult = await flowRunner.startFlow(flowKey, phone, senderName);
          return {
            replyText: flowResult.reply,
            automationMatched: rule.name,
            replyType: 'flow'
          };
        }

        // Return direct text / template reply
        return {
          replyText: rule.response_content,
          automationMatched: rule.name,
          replyType: rule.response_type || 'text'
        };
      }
    }

    // 5.6 Check Active Visual Node Workflow (n8n / Langflow Canvas)
    const activeWorkflow = await db.getActiveWorkflow();
    if (activeWorkflow && Number(activeWorkflow.is_active) === 1) {
      try {
        const wfResult = await workflowRunner.execute(activeWorkflow, incomingMsg);
        if (wfResult && wfResult.success && wfResult.finalReply) {
          await db.addLog('trigger', `Workflow Executed: ${activeWorkflow.name}`, {
            workflowId: activeWorkflow.id,
            phone,
            durationMs: wfResult.durationMs
          });
          return {
            replyText: wfResult.finalReply,
            automationMatched: `Workflow: ${activeWorkflow.name}`,
            replyType: 'workflow'
          };
        }
      } catch (wfErr) {
        console.error('[AutomationEngine] Visual workflow execution error:', wfErr.message);
      }
    }

    // 5.7 Check for Default Fallback Automation Rule (Triggered when no keyword matches)
    const defaultRule = activeRules.find(a => a.trigger_type === 'default' || a.trigger_type === 'fallback');
    if (defaultRule) {
      await db.incrementAutomationCount(defaultRule.id);
      await db.addLog('trigger', `Default Fallback Triggered: ${defaultRule.name}`, {
        ruleId: defaultRule.id,
        phone,
        text: rawText.slice(0, 100)
      });

      return {
        replyText: defaultRule.response_content,
        automationMatched: `Default Fallback (${defaultRule.name})`,
        replyType: defaultRule.response_type || 'text'
      };
    }

    // 6. Check External Webhook (e.g. QuickBite Webhook Forwarder)
    const webhookUrl = await db.getSetting('webhook_url', '');
    const webhookSecret = await db.getSetting('webhook_secret', '');
    if (webhookUrl && webhookUrl.trim().length > 5) {
      try {
        const webhookResponse = await this.forwardToWebhook(webhookUrl, {
          event: 'message.received',
          from: phone,
          pushName: senderName,
          text: rawText,
          timestamp: incomingMsg.timestamp || Date.now()
        }, webhookSecret);

        if (webhookResponse && webhookResponse.reply) {
          await db.addLog('webhook', 'Webhook Reply Received', {
            url: webhookUrl.slice(0, 100),
            phone,
            reply: String(webhookResponse.reply).slice(0, 100)
          });
          return {
            replyText: webhookResponse.reply,
            automationMatched: 'External Webhook Reply',
            replyType: 'webhook'
          };
        }
      } catch (err) {
        await db.addLog('error', 'Webhook Forwarding Failed', { error: err.message, url: webhookUrl.slice(0, 100) });
      }
    }

    // 7. Check AI Auto-Responder (Optional Groq / OpenAI)
    const aiEnabled = await db.getSetting('ai_enabled', '0');
    const aiApiKey = await db.getSetting('ai_api_key', '');
    if ((aiEnabled === '1' || aiEnabled === true) && aiApiKey) {
      try {
        const aiReply = await this.generateAIReply(rawText, senderName);
        if (aiReply) {
          await db.addLog('trigger', 'AI Auto-Response Generated', { phone, query: rawText.slice(0, 50) });
          return {
            replyText: aiReply,
            automationMatched: 'AI Smart Assistant',
            replyType: 'ai'
          };
        }
      } catch (err) {
        await db.addLog('error', 'AI Generation Error', { error: err.message });
      }
    }

    // 8. Default Fallback Reply
    const fallbackReply = await db.getSetting(
      'default_fallback_reply',
      'Thank you for reaching out! Send *help* or *menu* to explore our options.'
    );

    await db.addLog('info', 'Default Fallback Triggered', { phone, text: rawText.slice(0, 50) });

    return {
      replyText: fallbackReply,
      automationMatched: 'Default Fallback',
      replyType: 'fallback'
    };
  }

  async forwardToWebhook(url, payload, secret = '') {
    // 1. SSRF Validation
    const ssrfCheck = await validateSSRFUrl(url);
    if (!ssrfCheck.valid) {
      throw new Error(`SSRF blocked: ${ssrfCheck.reason}`);
    }

    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = ssrfCheck.parsedUrl;
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const body = JSON.stringify(payload);
        const headers = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-WhatsFlow-Event': 'message.received',
          'User-Agent': 'WhatsFlow-Webhook-Client/1.0'
        };

        // If webhook secret configured, attach HMAC signature
        if (secret) {
          const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
          headers['X-WhatsFlow-Signature-256'] = `sha256=${sig}`;
        }

        const req = client.request(parsedUrl, {
          method: 'POST',
          headers,
          timeout: 6000
        }, (res) => {
          let responseData = '';
          res.on('data', chunk => {
            responseData += chunk;
            if (responseData.length > 65536) { // Max 64KB response limit
              req.destroy();
              resolve({ raw: responseData });
            }
          });
          res.on('end', () => {
            try {
              const json = JSON.parse(responseData);
              resolve(json);
            } catch (e) {
              resolve({ raw: responseData });
            }
          });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Webhook request timed out')); });
        req.write(body);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  async generateAIReply(userText, userName) {
    const apiKey = await db.getSetting('ai_api_key', '');
    const model = await db.getSetting('ai_model', 'llama-3.3-70b-versatile');
    if (!apiKey) return null;

    const payload = JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: 'You are an intelligent, friendly WhatsApp assistant for a restaurant and ordering platform. Keep responses concise, clear, polite, and formatted with WhatsApp bold (*text*) or lists. Do not write long essays.'
        },
        {
          role: 'user',
          content: `${String(userName).slice(0, 50)}: ${String(userText).slice(0, 500)}`
        }
      ],
      temperature: 0.7,
      max_tokens: 250
    });

    return new Promise((resolve, reject) => {
      const req = https.request('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 8000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content;
            resolve(content || null);
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('AI request timed out')); });
      req.write(payload);
      req.end();
    });
  }
}

const automationEngine = new AutomationEngine();
module.exports = automationEngine;
