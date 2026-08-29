// Automated test suite for WhatsFlow security, auth, projects, automations, SSRF & rate limiting
const assert = require('assert');
const db = require('../server/db/db');
const automationEngine = require('../server/engine/automations');
const { validateSSRFUrl, isPrivateOrReservedIP } = require('../server/utils/ssrfFilter');
const { RateLimiter } = require('../server/middleware/rateLimiter');

async function runTests() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚡ WhatsFlow Security & Backward Compatibility Test Suite');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Initialize Database
  console.log('\n[1] Testing Database Initialization & Secure Storage...');
  await db.init();
  const settings = await db.getSettings();
  assert(settings.api_key, 'Master API Key should exist');
  console.log('✓ Database initialized with clean settings and storage engine.');

  // 2. Test User Authentication & Cryptographically Signed HMAC Tokens
  console.log('\n[2] Testing User Auth & Cryptographic HMAC Token Security...');
  const testEmail = `test_${Date.now()}@example.com`;
  const createdUser = await db.createUser({
    email: testEmail,
    password: 'securePassword123',
    name: 'Security Tester'
  });
  assert(createdUser.id, 'User ID should be generated');
  assert(createdUser.email === testEmail, 'User email should match');
  assert(!createdUser.password_hash, 'Returned user object must NOT contain password_hash');

  const verifiedUser = await db.verifyUserLogin(testEmail, 'securePassword123');
  assert(verifiedUser, 'User should log in successfully with correct password');

  const failedLogin = await db.verifyUserLogin(testEmail, 'wrongPassword');
  assert(failedLogin === null, 'User login should fail with wrong password');

  // Generate signed HMAC token
  const validToken = db.generateAuthToken(verifiedUser);
  assert(validToken.startsWith('wf_tok_'), 'Token should start with wf_tok_');
  assert(validToken.includes('.'), 'Token should contain cryptographic signature separator');

  const verifiedPayload = db.verifyAuthToken(validToken);
  assert(verifiedPayload && verifiedPayload.id === verifiedUser.id, 'Signed token should verify successfully');

  // Test Tampered Token Rejection
  const [payloadB64, sig] = validToken.slice(7).split('.');
  const forgedSig = 'invalid_signature_tampered_123';
  const tamperedToken = `wf_tok_${payloadB64}.${forgedSig}`;
  const tamperedResult = db.verifyAuthToken(tamperedToken);
  assert(tamperedResult === null, 'Tampered token MUST be rejected');

  // Test Forged Token (Fake Admin) Rejection
  const fakeAdminPayload = Buffer.from(JSON.stringify({ id: 'usr_admin_default', email: 'admin@example.com', exp: Date.now() + 100000 })).toString('base64url');
  const fakeToken = `wf_tok_${fakeAdminPayload}.invalidsig`;
  assert(db.verifyAuthToken(fakeToken) === null, 'Forged admin token without valid signature MUST be rejected');
  console.log('✓ Cryptographic HMAC token signing, verification, and tamper rejection verified.');

  // 3. Test Constant-Time String Comparison (Timing Attack Protection)
  console.log('\n[3] Testing Constant-Time API Key Comparison...');
  assert(db.timingSafeEqualString('qb_live_secure_key_123', 'qb_live_secure_key_123') === true, 'Matching keys must equal true');
  assert(db.timingSafeEqualString('qb_live_secure_key_123', 'qb_live_wrong_key_456') === false, 'Non-matching keys must equal false');
  assert(db.timingSafeEqualString('short', 'much_longer_string_value') === false, 'Different length keys must safely return false without exception');
  console.log('✓ Timing-safe string comparisons verified.');

  // 4. Test SSRF Protection Utility
  console.log('\n[4] Testing SSRF (Server-Side Request Forgery) Protections...');
  // Loopback / Localhost
  assert(isPrivateOrReservedIP('127.0.0.1') === true, '127.0.0.1 must be detected as private/loopback');
  assert(isPrivateOrReservedIP('10.0.0.1') === true, '10.0.0.1 must be detected as private');
  assert(isPrivateOrReservedIP('192.168.1.1') === true, '192.168.1.1 must be detected as private');
  assert(isPrivateOrReservedIP('172.16.0.1') === true, '172.16.0.1 must be detected as private');
  assert(isPrivateOrReservedIP('169.254.169.254') === true, 'AWS/GCP metadata IP 169.254.169.254 must be blocked');
  assert(isPrivateOrReservedIP('8.8.8.8') === false, 'Public IP 8.8.8.8 must be allowed');

  const blockedLocalhost = await validateSSRFUrl('http://localhost:3000/admin');
  assert(blockedLocalhost.valid === false, 'http://localhost must be blocked by SSRF filter');

  const blockedIPv6 = await validateSSRFUrl('http://[::1]:3000/admin');
  assert(blockedIPv6.valid === false, 'http://[::1] must be blocked by SSRF filter');

  const blockedGoogleMetadata = await validateSSRFUrl('http://metadata.google.internal/computeMetadata/v1/');
  assert(blockedGoogleMetadata.valid === false, 'metadata.google.internal must be blocked by SSRF filter');

  const blockedMetadata = await validateSSRFUrl('http://169.254.169.254/latest/meta-data/');
  assert(blockedMetadata.valid === false, 'Cloud metadata endpoint must be blocked by SSRF filter');

  const blockedFileProtocol = await validateSSRFUrl('file:///etc/passwd');
  assert(blockedFileProtocol.valid === false, 'file:// protocol must be blocked');

  const validPublicUrl = await validateSSRFUrl('https://example.com/webhook');
  assert(validPublicUrl.valid === true, 'Public HTTPS URL must be allowed');
  console.log('✓ SSRF protections successfully block internal IPs, IPv6 bracketed hosts, metadata endpoints, and non-http protocols.');

  // 5. Test Rate Limiter Middleware
  console.log('\n[5] Testing Sliding Window Rate Limiter & Auth Tamper Resistance...');
  const testLimiter = new RateLimiter({ windowMs: 1000, max: 3, keyByIp: true });
  const mockReq = { headers: { authorization: 'Bearer fake_random_header_1' }, socket: { remoteAddress: '192.0.2.1' } };
  let statusSet = null;
  let jsonResponse = null;
  const mockRes = {
    setHeader: () => {},
    status: (s) => { statusSet = s; return mockRes; },
    json: (j) => { jsonResponse = j; return mockRes; }
  };

  const middleware = testLimiter.middleware();
  let nextCalls = 0;
  const next = () => { nextCalls++; };

  // First 3 requests should succeed
  middleware(mockReq, mockRes, next);
  mockReq.headers.authorization = 'Bearer fake_random_header_2';
  middleware(mockReq, mockRes, next);
  mockReq.headers.authorization = 'Bearer fake_random_header_3';
  middleware(mockReq, mockRes, next);
  assert(nextCalls === 3, 'First 3 requests should pass rate limiter');

  // 4th request from same IP even with rotated fake token should be rate limited (429)
  mockReq.headers.authorization = 'Bearer fake_random_header_4';
  middleware(mockReq, mockRes, next);
  assert(statusSet === 429, '4th request must be rate limited with 429 Too Many Requests despite rotated bearer header');
  console.log('✓ Rate limiting sliding window successfully throttles excessive traffic and resists header rotation attacks.');

  // 6. Test Project Creation & Dedicated API Key
  console.log('\n[6] Testing Project Creation & Dedicated API Key...');
  const newProj = await db.createProject({
    name: 'QuickBite Partner Store',
    webhook_url: ''
  });
  assert(newProj.id, 'Project ID should be generated');
  assert(newProj.api_key.startsWith('qb_live_'), 'Dedicated API key should start with qb_live_');
  
  const foundByApiKey = await db.getProjectByApiKey(newProj.api_key);
  assert(foundByApiKey && foundByApiKey.id === newProj.id, 'Project should be retrievable by API key');
  console.log('✓ Dedicated Project created with API Key:', newProj.api_key);

  // 7. Test Project-Linked Automations
  console.log('\n[7] Testing Project-Linked Automations...');
  const newRule = await db.createAutomation({
    project_id: newProj.id,
    name: 'Test Project Rule',
    trigger_type: 'exact',
    trigger_value: 'hello_test',
    response_content: 'Test response received!',
    is_active: 1
  });
  assert(newRule.id, 'Rule ID should be created');

  const projectRules = await db.getAutomations(newProj.id);
  assert(projectRules.some(r => r.id === newRule.id), 'Project rules should contain new rule');

  const autoRes = await automationEngine.processIncomingMessage({
    from: '8801700000099',
    text: 'hello_test',
    pushName: 'Tester',
    projectId: newProj.id
  });
  assert(autoRes && autoRes.replyText === 'Test response received!', 'Automation engine should match rule');
  console.log('✓ Project-Linked Automation matched and executed successfully.');

  // 8. Test Visual Workflow Builder & Graph Execution Runner
  console.log('\n[8] Testing Visual Workflow Builder & Node Graph Execution...');
  const workflowRunner = require('../server/engine/workflowRunner');
  const testWf = await db.createWorkflow({
    name: 'Test Customer Support Agent',
    description: 'Unit test workflow',
    is_active: 1,
    nodes: [
      {
        id: 'n_trigger',
        type: 'whatsapp_trigger',
        label: 'When Chat Message Received',
        x: 50, y: 100,
        data: { title: 'When Chat Message Received' }
      },
      {
        id: 'n_ctx',
        type: 'document_context',
        label: 'Knowledge Base',
        x: 300, y: 50,
        data: { title: 'FAQ', contextText: 'Store Operating Hours: Monday to Friday 9am to 6pm.' }
      },
      {
        id: 'n_filter',
        type: 'keyword_filter',
        label: 'Filter Hours Keyword',
        x: 300, y: 180,
        data: { title: 'Filter', condition: 'contains', keyword: 'hours' }
      },
      {
        id: 'n_send',
        type: 'send_message',
        label: 'Send WhatsApp Reply',
        x: 600, y: 150,
        data: { title: 'Send Reply', messageTemplate: 'Hello {{name}}, our hours are: {{knowledge_context}}' }
      }
    ],
    edges: [
      { id: 'e1', source: 'n_trigger', target: 'n_filter' },
      { id: 'e2', source: 'n_ctx', target: 'n_send' },
      { id: 'e3', source: 'n_filter', target: 'n_send' }
    ]
  });

  assert(testWf.id, 'Workflow ID must be generated');
  const retrievedWf = await db.getWorkflow(testWf.id);
  assert(retrievedWf && retrievedWf.name === 'Test Customer Support Agent', 'Workflow should be retrieved from storage');

  const wfResult = await workflowRunner.execute(testWf, {
    from: '+8801712345678',
    text: 'What are your hours?',
    pushName: 'Ashik'
  });

  assert(wfResult.success === true, 'Workflow execution must succeed');
  assert(wfResult.finalReply.includes('Monday to Friday 9am to 6pm'), 'Workflow output must contain interpolated knowledge context');
  assert(wfResult.executionTrace.length >= 3, 'Workflow execution trace must track node executions');
  console.log('✓ Visual Workflow Graph execution and node traversal verified.');

  // [9] Testing Webhook Precedence Over Local Automations
  console.log('\n[9] Testing Webhook Precedence Over Local Automations...');

  // Create a project with webhook URL configured
  const webhookProj = await db.createProject({
    name: 'Webhook Relay Project',
    webhook_url: 'https://example.com/mock_webhook'
  });

  // Mock forwardToWebhook to simulate external PHP/Node webhook response
  const originalForward = automationEngine.forwardToWebhook;
  automationEngine.forwardToWebhook = async (url, payload, secret) => {
    return { reply: `Order #104 status from PHP Webhook: Confirmed! Hello ${payload.pushName}` };
  };

  const webhookResult = await automationEngine.processIncomingMessage({
    from: '8801712345678',
    text: 'order_status_104',
    pushName: 'Ashik'
  });

  assert(webhookResult && webhookResult.replyType === 'webhook', 'Webhook must handle incoming message when configured');
  assert(webhookResult.replyText.includes('Order #104 status from PHP Webhook: Confirmed!'), 'Webhook response must be returned');

  // Restore original forwardToWebhook
  automationEngine.forwardToWebhook = originalForward;

  // Verify project update with custom webhook
  const updatedWebhookProj = await db.updateProject(webhookProj.id, {
    webhook_url: 'https://quickbite.ashiik.com/whatsapp_bot.php'
  });
  assert.strictEqual(updatedWebhookProj.webhook_url, 'https://quickbite.ashiik.com/whatsapp_bot.php', 'updateProject must persist updated webhook URL');
  console.log('✓ Webhook exclusive precedence and project webhook URL update verified.');

  // Clean up test data
  await db.deleteAutomation(newRule.id);
  await db.deleteWorkflow(testWf.id);
  await db.deleteProject(newProj.id);
  await db.deleteProject(webhookProj.id);
  console.log('✓ Test cleanup completed.');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 ALL WHATSFLOW SECURITY & FUNCTIONAL TESTS PASSED! (9/9)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
