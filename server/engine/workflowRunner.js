const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { validateSSRFUrl } = require('../utils/ssrfFilter');
const db = require('../db/db');

class WorkflowRunner {
  /**
   * Execute a workflow graph against an incoming message or test input
   * @param {Object} workflow - { id, name, nodes, edges, settings }
   * @param {Object} incomingMsg - { from, text, pushName, messageId }
   * @returns {Object} { success, finalReply, executionTrace, matched }
   */
  async execute(workflow, incomingMsg) {
    const startTime = Date.now();
    const trace = [];
    const variables = {
      from: String(incomingMsg.from || 'test_user').replace(/[^0-9]/g, ''),
      name: String(incomingMsg.pushName || 'Customer'),
      text: String(incomingMsg.text || '').trim(),
      messageId: incomingMsg.messageId || `sim_${Date.now()}`,
      knowledge_context: '',
      ai_reply: '',
      webhook_response: null,
      last_output: ''
    };

    let finalReply = null;
    let isMatched = true;

    try {
      const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : JSON.parse(workflow.nodes || '[]');
      const edges = Array.isArray(workflow.edges) ? workflow.edges : JSON.parse(workflow.edges || '[]');
      const settings = typeof workflow.settings === 'object' ? workflow.settings : JSON.parse(workflow.settings || '{}');

      // 1. Locate start/trigger node
      const triggerNode = nodes.find(n => n.type === 'whatsapp_trigger') || nodes[0];
      if (!triggerNode) {
        return { success: false, finalReply: null, executionTrace: trace, error: 'No trigger node found.' };
      }

      // Record trigger node execution
      trace.push({
        nodeId: triggerNode.id,
        nodeType: triggerNode.type,
        label: triggerNode.data?.title || triggerNode.label || 'WhatsApp Trigger',
        status: 'success',
        durationMs: 1,
        input: { text: variables.text, from: variables.from },
        output: { event: 'message_received', variables: { ...variables } }
      });

      // 2. Build graph adjacency list
      const edgeMap = new Map(); // sourceNodeId -> Array<{ targetId, sourceHandle, targetHandle }>
      edges.forEach(e => {
        if (!edgeMap.has(e.source)) edgeMap.set(e.source, []);
        edgeMap.get(e.source).push({
          targetId: e.target,
          sourceHandle: e.sourceHandle || 'out',
          targetHandle: e.targetHandle || 'in'
        });
      });

      // 3. Collect all document/knowledge context nodes connected in graph
      const contextNodes = nodes.filter(n => n.type === 'document_context');
      for (const ctxNode of contextNodes) {
        const textContent = ctxNode.data?.contextText || ctxNode.data?.content || '';
        if (textContent) {
          variables.knowledge_context = variables.knowledge_context
            ? `${variables.knowledge_context}\n\n${textContent}`
            : textContent;

          trace.push({
            nodeId: ctxNode.id,
            nodeType: ctxNode.type,
            label: ctxNode.data?.title || 'Knowledge Context',
            status: 'success',
            durationMs: 1,
            input: { contextLength: textContent.length },
            output: { contextSnippet: textContent.slice(0, 80) + '...' }
          });
        }
      }

      // 4. Traverse execution queue starting from Trigger Node
      const queue = (edgeMap.get(triggerNode.id) || []).map(edge => edge.targetId);
      const visited = new Set([triggerNode.id]);

      while (queue.length > 0) {
        const currentNodeId = queue.shift();
        if (visited.has(currentNodeId)) continue;
        visited.add(currentNodeId);

        const node = nodes.find(n => n.id === currentNodeId);
        if (!node) continue;

        const nodeStart = Date.now();
        let nodeOutput = null;
        let nodeStatus = 'success';
        let branchAllowed = true;

        switch (node.type) {
          case 'keyword_filter': {
            const conditionType = node.data?.condition || 'contains';
            const triggerKeyword = (node.data?.keyword || '').toLowerCase().trim();
            const lowerMsg = variables.text.toLowerCase();

            let matched = false;
            if (conditionType === 'exact') {
              matched = (lowerMsg === triggerKeyword);
            } else if (conditionType === 'starts_with') {
              matched = lowerMsg.startsWith(triggerKeyword);
            } else if (conditionType === 'regex') {
              try {
                const pattern = (node.data?.keyword || '').trim();
                // ReDoS protection: limit pattern length and variable text length
                if (pattern && pattern.length <= 100 && variables.text.length <= 1000) {
                  matched = new RegExp(pattern, 'i').test(variables.text);
                } else {
                  matched = false;
                }
              } catch (e) { matched = false; }
            } else {
              matched = lowerMsg.includes(triggerKeyword);
            }

            nodeOutput = { matched, condition: conditionType, keyword: triggerKeyword };
            if (!matched) {
              branchAllowed = false;
              isMatched = false;
            }
            break;
          }

          case 'ai_agent': {
            const promptTemplate = node.data?.promptTemplate || 'Answer the customer inquiry: {{text}}';
            const systemPrompt = node.data?.systemPrompt || 'You are an intelligent, helpful WhatsApp AI assistant. Keep responses clear and concise.';
            const model = node.data?.model || settings.ai_model || 'gpt-4o-mini';
            const temperature = parseFloat(node.data?.temperature || settings.temperature || 0.7);

            // Interpolate prompt variables
            let resolvedPrompt = promptTemplate
              .replace(/{{text}}/g, variables.text)
              .replace(/{{from}}/g, variables.from)
              .replace(/{{name}}/g, variables.name)
              .replace(/{{context}}/g, variables.knowledge_context);

            const aiRes = await this.callAIModel({
              model,
              systemPrompt,
              userPrompt: resolvedPrompt,
              knowledgeContext: variables.knowledge_context,
              apiKey: node.data?.apiKey || settings.ai_api_key || (await db.getSetting('ai_api_key', ''))
            });

            variables.ai_reply = aiRes;
            variables.last_output = aiRes;
            nodeOutput = { reply: aiRes, model };
            break;
          }

          case 'http_request': {
            const url = node.data?.url || '';
            const method = (node.data?.method || 'POST').toUpperCase();
            if (url) {
              const ssrfCheck = await validateSSRFUrl(url);
              if (!ssrfCheck.valid) {
                nodeStatus = 'error';
                nodeOutput = { error: ssrfCheck.reason };
              } else {
                try {
                  const resData = await this.executeHttpRequest(url, method, {
                    from: variables.from,
                    text: variables.text,
                    name: variables.name,
                    ai_reply: variables.ai_reply
                  });
                  variables.webhook_response = resData;
                  nodeOutput = { statusCode: 200, data: resData };
                } catch (reqErr) {
                  nodeStatus = 'warning';
                  nodeOutput = { error: reqErr.message };
                }
              }
            }
            break;
          }

          case 'send_message': {
            const msgTemplate = node.data?.messageTemplate || node.data?.template || '{{ai_reply}}';
            let rendered = msgTemplate
              .replace(/{{ai_reply}}/g, variables.ai_reply || variables.last_output)
              .replace(/{{knowledge_context}}/g, variables.knowledge_context)
              .replace(/{{context}}/g, variables.knowledge_context)
              .replace(/{{text}}/g, variables.text)
              .replace(/{{from}}/g, variables.from)
              .replace(/{{name}}/g, variables.name)
              .replace(/{{last_output}}/g, variables.last_output);

            if (!rendered.trim() && variables.ai_reply) {
              rendered = variables.ai_reply;
            }

            finalReply = rendered;
            variables.last_output = rendered;
            nodeOutput = { finalReply: rendered };
            break;
          }

          default:
            nodeOutput = { skipped: true };
            break;
        }

        trace.push({
          nodeId: node.id,
          nodeType: node.type,
          label: node.data?.title || node.label || node.type,
          status: nodeStatus,
          durationMs: Date.now() - nodeStart,
          input: { text: variables.text, ...node.data },
          output: nodeOutput
        });

        // Continue along graph if this branch was matched
        if (branchAllowed) {
          const nextTargets = (edgeMap.get(node.id) || []).map(edge => edge.targetId);
          queue.push(...nextTargets);
        }
      }

      return {
        success: true,
        finalReply: finalReply || variables.ai_reply || null,
        executionTrace: trace,
        matched: isMatched,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      console.error('[WorkflowRunner] Execution error:', err);
      return {
        success: false,
        finalReply: null,
        executionTrace: trace,
        error: err.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  /**
   * Dispatch AI Request (GroqCloud / OpenAI / Gemini with natural conversational reasoning)
   */
  async callAIModel({ model, systemPrompt, userPrompt, knowledgeContext, apiKey }) {
    const selectedModel = model || 'openai/gpt-oss-120b';
    const effectiveApiKey = (apiKey || '').trim() ||
                            (await db.getSetting('groq_api_key', '')) ||
                            (await db.getSetting('ai_api_key', '')) ||
                            (process.env.GROQ_API_KEY || '').trim() ||
                            (process.env.OPENAI_API_KEY || '').trim() ||
                            '';

    // 1. Groq Cloud API Dispatch (Default Provider)
    const isGroqModel = selectedModel.includes('openai/gpt-oss-120b') || 
                        selectedModel.includes('llama') || 
                        selectedModel.includes('mixtral') || 
                        selectedModel.includes('gemma') || 
                        effectiveApiKey.startsWith('gsk_');

    if (effectiveApiKey && isGroqModel) {
      try {
        const sysContent = [
          systemPrompt || 'You are an intelligent, helpful WhatsApp AI assistant.',
          knowledgeContext ? `\n\n[KNOWLEDGE BASE & CONTEXT]:\n${knowledgeContext}` : '',
          `\n\n[INSTRUCTIONS]:
- Answer the customer naturally, conversationally, and concisely based on the Knowledge Base.
- If the customer speaks in Bengali or Banglish, answer naturally in friendly Bengali or Banglish according to your persona.
- NEVER output raw document headers, notes, section titles, or meta-labels.
- Never output disclaimers or footer stamps like "Generated via...".
- Keep responses friendly, human-like, and formatted cleanly for WhatsApp.`
        ].join('');

        const payload = JSON.stringify({
          model: selectedModel,
          messages: [
            { role: 'system', content: sysContent },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 2048
        });

        const res = await new Promise((resolve, reject) => {
          const req = https.request('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${effectiveApiKey}`,
              'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 15000
          }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
              try {
                const parsed = JSON.parse(data);
                if (parsed.choices && parsed.choices[0]?.message?.content) {
                  resolve(parsed.choices[0].message.content.trim());
                } else {
                  console.error('[WorkflowRunner] Groq API returned error:', parsed.error || data);
                  reject(new Error(parsed.error?.message || 'Groq Cloud API response error.'));
                }
              } catch (e) {
                reject(e);
              }
            });
          });
          req.on('error', reject);
          req.write(payload);
          req.end();
        });

        return res;
      } catch (groqErr) {
        console.warn('[WorkflowRunner] Groq Cloud API call fallback:', groqErr.message);
      }
    }

    // 2. OpenAI API Dispatch
    if (effectiveApiKey && effectiveApiKey.startsWith('sk-') && !isGroqModel) {
      try {
        const sysContent = [
          systemPrompt || 'You are an intelligent, helpful WhatsApp AI assistant.',
          knowledgeContext ? `\n\n[KNOWLEDGE BASE & CONTEXT]:\n${knowledgeContext}` : '',
          `\n\n[INSTRUCTIONS]:
- Answer the customer naturally, conversationally, and concisely based on the Knowledge Base.
- If the customer speaks in Bengali or Banglish, answer naturally in friendly Bengali or Banglish.
- NEVER output raw document headers, notes, section titles, or meta-labels.
- Never output disclaimers or footer stamps.`
        ].join('');

        const payload = JSON.stringify({
          model: selectedModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: sysContent },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7
        });

        const res = await new Promise((resolve, reject) => {
          const req = https.request('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${effectiveApiKey}`,
              'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 12000
          }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
              try {
                const parsed = JSON.parse(data);
                if (parsed.choices && parsed.choices[0]?.message?.content) {
                  resolve(parsed.choices[0].message.content.trim());
                } else {
                  reject(new Error(parsed.error?.message || 'OpenAI API error.'));
                }
              } catch (e) {
                reject(e);
              }
            });
          });
          req.on('error', reject);
          req.write(payload);
          req.end();
        });

        return res;
      } catch (apiErr) {
        console.warn('[WorkflowRunner] OpenAI API call fallback:', apiErr.message);
      }
    }

    // Clean Natural Fallback (when API key is missing or network unavailable)
    const lowerInput = userPrompt.toLowerCase();
    if (knowledgeContext && knowledgeContext.length > 5) {
      const lines = knowledgeContext.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#') && !l.toUpperCase().includes('KNOWLEDGE BASE') && !l.toUpperCase().includes('DIRECT ANSWERS'));
      
      const matchedLine = lines.find(l => {
        const words = lowerInput.split(' ').filter(w => w.length > 3);
        return words.some(w => l.toLowerCase().includes(w));
      });

      if (matchedLine) {
        return matchedLine.replace(/^[^a-zA-Z0-9\u0980-\u09FF]+/, '');
      }
    }

    if (lowerInput.includes('hello') || lowerInput.includes('hi') || lowerInput.includes('hey')) {
      return `Hello! How can I help you today?`;
    }
    if (lowerInput.includes('ki') || lowerInput.includes('valo') || lowerInput.includes('kemon')) {
      return `Hello! Kemon achen? Kichu dorkar thakle bolte paren.`;
    }
    if (lowerInput.includes('support') || lowerInput.includes('help')) {
      return `Our support team is online 24/7. Please let us know how we can assist you!`;
    }

    return `Thank you for reaching out! How can I assist you today?`;
  }

  /**
   * Execute SSRF-Safe HTTP Webhook Request
   */
  async executeHttpRequest(url, method, payload) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;
      const dataStr = JSON.stringify(payload);

      const req = client.request(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsFlow-Workflow-Runner/1.0',
          'Content-Length': Buffer.byteLength(dataStr)
        },
        timeout: 5000
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve({ raw: body, statusCode: res.statusCode });
          }
        });
      });

      req.on('error', reject);
      req.write(dataStr);
      req.end();
    });
  }
}

const runner = new WorkflowRunner();
module.exports = runner;
