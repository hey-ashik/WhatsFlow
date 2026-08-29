const db = require('../db/db');
const config = require('../config');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { validateSSRFUrl } = require('../utils/ssrfFilter');

/**
 * Multi-Step Conversation State Machine
 * Handles interactive chatbot sequences (e.g. QuickBite Restaurant Onboarding)
 */
class FlowRunner {
  constructor() {
    this.flows = {
      quickbite_onboarding: {
        name: 'QuickBite Restaurant Builder Flow',
        startStep: 'ask_owner_name',
        steps: {
          ask_owner_name: {
            prompt: '👨‍🍳 *QuickBite Restaurant Creator (Step 1/4)*\n\nWhat is your *Full Name*? (Owner Name)\n\n_Type your name below or send cancel to exit_',
            nextStep: 'ask_email',
            field: 'owner_name',
            validate: (input) => input.trim().length >= 2 ? null : 'Please enter a valid full name (at least 2 characters).'
          },
          ask_email: {
            prompt: (data) => `👋 Nice to meet you, *${data.owner_name}*!\n\n📧 *(Step 2/4)*: What is your *Email Address*?\n\n_(This will be used for your QuickBite dashboard login)_`,
            nextStep: 'ask_restaurant_name',
            field: 'email',
            validate: (input) => {
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              return emailRegex.test(input.trim()) ? null : '⚠️ Please enter a valid email address (e.g. name@example.com)';
            }
          },
          ask_restaurant_name: {
            prompt: '🏢 *(Step 3/4)*: What is the *Name of your Restaurant* or Food Business?',
            nextStep: 'ask_location',
            field: 'restaurant_name',
            validate: (input) => input.trim().length >= 2 ? null : 'Please enter a valid restaurant name (at least 2 characters).'
          },
          ask_location: {
            prompt: (data) => `📍 *(Step 4/4)*: Where is *${data.restaurant_name}* located? (City, Street, or Area)`,
            nextStep: 'complete_creation',
            field: 'location',
            validate: (input) => input.trim().length >= 2 ? null : 'Please enter a valid location.'
          }
        }
      }
    };
  }

  /**
   * Start a new flow for a contact
   */
  async startFlow(flowKey, phone, userFirstName = 'User') {
    const flow = this.flows[flowKey];
    if (!flow) {
      return { reply: 'Unknown conversation flow.', completed: true };
    }

    const firstStepKey = flow.startStep;
    const firstStep = flow.steps[firstStepKey];

    await db.updateContactFlow(phone, flowKey, firstStepKey, {
      owner_phone: phone,
      started_at: new Date().toISOString()
    });

    await db.addLog('trigger', 'Flow Started', { flow: flowKey, phone });

    const promptText = typeof firstStep.prompt === 'function'
      ? firstStep.prompt({ first_name: userFirstName })
      : firstStep.prompt;

    return {
      reply: promptText,
      completed: false,
      flow: flowKey,
      step: firstStepKey
    };
  }

  /**
   * Process incoming user message for an active flow
   */
  async handleStep(phone, messageText, activeFlowKey, activeStepKey, flowData = {}) {
    const cleanText = messageText.trim();
    const flow = this.flows[activeFlowKey];

    if (!flow) {
      await db.clearContactFlow(phone);
      return { reply: 'Session reset. Type *hi* or *create* to start again.', completed: true };
    }

    const currentStep = flow.steps[activeStepKey];
    if (!currentStep) {
      await db.clearContactFlow(phone);
      return { reply: 'Session error. Flow has been reset.', completed: true };
    }

    // Step Validation
    if (currentStep.validate) {
      const errorMsg = currentStep.validate(cleanText, flowData);
      if (errorMsg) {
        return { reply: `${errorMsg}\n\n_Please try again, or type cancel to quit._`, completed: false };
      }
    }

    // Save field in flow state (sanitized length)
    const fieldName = currentStep.field;
    flowData[fieldName] = cleanText.slice(0, 255);

    const nextStepKey = currentStep.nextStep;

    // Check if this step was the final transition
    if (nextStepKey === 'complete_creation' || !flow.steps[nextStepKey]) {
      return await this.completeQuickBiteOnboarding(phone, flowData);
    }

    // Transition to next step
    await db.updateContactFlow(phone, activeFlowKey, nextStepKey, flowData);
    const nextStep = flow.steps[nextStepKey];

    const nextPrompt = typeof nextStep.prompt === 'function'
      ? nextStep.prompt(flowData)
      : nextStep.prompt;

    return {
      reply: nextPrompt,
      completed: false,
      flow: activeFlowKey,
      step: nextStepKey
    };
  }

  /**
   * Finalize restaurant onboarding and create record
   */
  async completeQuickBiteOnboarding(phone, data) {
    const siteUrl = await db.getSetting('quickbite_url', config.quickbiteSiteUrl);
    const webhookUrl = await db.getSetting('webhook_url', config.webhookUrl);
    const webhookSecret = await db.getSetting('webhook_secret', config.webhookSecret);

    // Create URL slug: e.g. "Burger King Cafe" -> "burger-king-cafe"
    const baseSlug = (data.restaurant_name || 'restaurant')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const slug = `${baseSlug}-${randomSuffix}`;
    const generatedPassword = `qb_${crypto.randomBytes(4).toString('hex')}`;

    const newRestaurant = {
      owner_name: data.owner_name,
      email: data.email,
      phone: phone,
      restaurant_name: data.restaurant_name,
      location: data.location,
      slug: slug,
      password: generatedPassword,
      created_at: new Date().toISOString()
    };

    // If webhook is configured (e.g. QuickBite API endpoint), dispatch creation event
    if (webhookUrl && webhookUrl.trim().length > 5) {
      this.dispatchWebhook(webhookUrl, {
        event: 'restaurant.create',
        source: 'whatsapp_bot',
        data: newRestaurant
      }, webhookSecret).catch(err => console.warn('[FlowRunner] Webhook dispatch error:', err.message));
    }

    // Clear flow from contact state
    await db.clearContactFlow(phone);

    await db.addLog('trigger', 'Restaurant Created via WhatsApp', {
      owner: data.owner_name,
      restaurant: data.restaurant_name,
      slug: slug,
      phone: phone
    });

    const completionMessage = 
`🎉 *Congratulations, ${data.owner_name}!*

Your restaurant page for *${data.restaurant_name}* has been successfully generated on QuickBite!

━━━━━━━━━━━━━━━━━━━━━
🌐 *Live Restaurant Page*:
${siteUrl}/${slug}

🔑 *Owner Dashboard Login*:
${siteUrl}/login

📧 *Login Email*: ${data.email}
🔒 *Temporary Password*: \`${generatedPassword}\`
📍 *Location*: ${data.location}
━━━━━━━━━━━━━━━━━━━━━

💡 *Next Steps*:
1. Log in to your dashboard to add food menu items and prices.
2. Share your live link with customers on WhatsApp!

_Send *menu* to preview demo items or *help* for options._`;

    return {
      reply: completionMessage,
      completed: true,
      data: newRestaurant
    };
  }

  async dispatchWebhook(url, payload, secret = '') {
    // 1. SSRF Check
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
          'X-WhatsFlow-Event': payload.event || 'message',
          'User-Agent': 'WhatsFlow-FlowRunner/1.0'
        };

        if (secret) {
          const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
          headers['X-WhatsFlow-Signature-256'] = `sha256=${sig}`;
        }

        const req = client.request(parsedUrl, {
          method: 'POST',
          headers,
          timeout: 8000
        }, (res) => {
          let responseData = '';
          res.on('data', chunk => {
            responseData += chunk;
            if (responseData.length > 65536) {
              req.destroy();
              resolve({ status: res.statusCode, data: responseData });
            }
          });
          res.on('end', () => resolve({ status: res.statusCode, data: responseData }));
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
        req.write(body);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

const flowRunner = new FlowRunner();
module.exports = flowRunner;
