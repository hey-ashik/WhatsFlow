const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('../server/db/db');
const apiRoutes = require('../server/routes/api');
const config = require('../server/config');

async function verifyLiveEndpoints() {
  console.log('\n--- Running Live HTTP Endpoints Verification ---');
  await db.init();

  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(3099, '127.0.0.1', resolve));

  const request = (path, method = 'GET', headers = {}, body = null) => {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port: 3099,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };

  try {
    // 1. Verify Unauthenticated /settings returns 401
    const unauthSettings = await request('/api/v1/settings');
    assert.strictEqual(unauthSettings.status, 401, 'Unauthenticated /settings must return 401');
    console.log('✓ Protected route /settings correctly returns 401 Unauthorized for unauthenticated requests');

    // 2. Verify /auth/me without token returns 401
    const unauthMe = await request('/api/v1/auth/me');
    assert.strictEqual(unauthMe.status, 401, 'Unauthenticated /auth/me must return 401');
    console.log('✓ /auth/me returns 401 for unauthenticated callers (no admin fallback leak)');

    // 3. Verify /auth/register creates user and returns signed token
    const regRes = await request('/api/v1/auth/register', 'POST', {}, {
      email: `live_tester_${Date.now()}@example.com`,
      password: 'mypassword123',
      name: 'Live Tester'
    });
    assert.strictEqual(regRes.status, 200, 'Register should return 200');
    assert(regRes.data.data.token, 'Register must return token');
    const token = regRes.data.data.token;
    console.log('✓ /auth/register successfully creates user and returns signed HMAC token');

    // 4. Verify /auth/me with signed token returns user
    const authMe = await request('/api/v1/auth/me', 'GET', { 'Authorization': `Bearer ${token}` });
    assert.strictEqual(authMe.status, 200, '/auth/me with token must return 200');
    assert.strictEqual(authMe.data.data.email, regRes.data.data.user.email, 'Returned user email must match');
    console.log('✓ /auth/me with signed token verifies successfully');

    // 5. Verify /settings with signed token returns 200
    const authSettings = await request('/api/v1/settings', 'GET', { 'Authorization': `Bearer ${token}` });
    assert.strictEqual(authSettings.status, 200, '/settings with token must return 200');
    console.log('✓ Authenticated access to /settings succeeds');

    // 6. Verify /send-message without API Key returns 401
    const unauthSend = await request('/api/v1/send-message', 'POST', {}, { to: '8801700000000', message: 'Hello' });
    assert.strictEqual(unauthSend.status, 401, '/send-message without API Key must return 401');
    console.log('✓ Public API Gateway /send-message requires valid API Key');

    // 7. Verify /settings with Master API Key in Authorization header succeeds
    const masterApiKey = await db.getSetting('api_key', config.apiKey);
    const masterSettings = await request('/api/v1/settings', 'GET', { 'Authorization': `Bearer ${masterApiKey}` });
    assert.strictEqual(masterSettings.status, 200, '/settings with Master API Key must return 200');
    console.log('✓ Master API Key allows full administrative access');

    // 8. Verify /messages DELETE without auth returns 401
    const unauthDelMsgs = await request('/api/v1/messages', 'DELETE');
    assert.strictEqual(unauthDelMsgs.status, 401, 'Unauthenticated /messages DELETE must return 401');
    console.log('✓ Unauthenticated DELETE /messages returns 401');

    // 9. Verify /messages DELETE with auth returns 200
    const authDelMsgs = await request('/api/v1/messages', 'DELETE', { 'Authorization': `Bearer ${token}` });
    assert.strictEqual(authDelMsgs.status, 200, 'Authenticated /messages DELETE must return 200');
    console.log('✓ Authenticated DELETE /messages clears feed successfully');

    // 10. Verify /automations/:id PUT updates automation status
    const createdRule = await db.createAutomation({
      name: 'Toggle Test Rule',
      trigger_type: 'exact',
      trigger_value: 'toggle_test',
      response_content: 'Toggle Response',
      is_active: 1
    });
    const putRes = await request(`/api/v1/automations/${createdRule.id}`, 'PUT', { 'Authorization': `Bearer ${token}` }, {
      is_active: 0
    });
    assert.strictEqual(putRes.status, 200, 'PUT /automations/:id must return 200');
    assert.strictEqual(putRes.data.data.is_active, 0, 'Automation is_active should be updated to 0');
    console.log('✓ PUT /automations/:id updates automation state properly');

    // 11. Verify Unauthenticated /workflows returns 401
    const unauthWf = await request('/api/v1/workflows');
    assert.strictEqual(unauthWf.status, 401, 'Unauthenticated /workflows must return 401');
    console.log('✓ Protected route /workflows correctly returns 401 for unauthenticated requests');

    // 12. Verify Authenticated /workflows and /workflows/:id/test simulation
    const authWf = await request('/api/v1/workflows', 'GET', { 'Authorization': `Bearer ${token}` });
    assert.strictEqual(authWf.status, 200, '/workflows with token must return 200');
    assert(Array.isArray(authWf.data.data), '/workflows data must be an array');

    const testSimulation = await request('/api/v1/workflows/test_draft/test', 'POST', { 'Authorization': `Bearer ${token}` }, {
      nodes: [
        { id: 'n1', type: 'whatsapp_trigger', label: 'Trigger' },
        { id: 'n2', type: 'send_message', label: 'Output', data: { messageTemplate: 'Simulated Reply: {{text}}' } }
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      text: 'Live Test Message'
    });
    assert.strictEqual(testSimulation.status, 200, '/workflows/:id/test must return 200');
    assert.strictEqual(testSimulation.data.data.finalReply, 'Simulated Reply: Live Test Message', 'Test simulation should execute workflow graph');
    console.log('✓ POST /workflows/:id/test successfully simulates live node execution');

    // 13. Verify BOLA / Cross-Tenant Project Authorization
    const projA = await db.createProject({ name: 'Project Alpha' });
    const projB = await db.createProject({ name: 'Project Beta' });

    // Try calling Project B endpoint using Project A's API key
    const bolaRes = await request(`/api/v1/projects/${projB.id}/send-message`, 'POST', {
      'Authorization': `Bearer ${projA.api_key}`
    }, { to: '8801700000000', message: 'Unauthorized test' });
    assert.strictEqual(bolaRes.status, 403, 'Cross-tenant project API key access must return 403 Forbidden');
    console.log('✓ Cross-tenant project API key dispatch correctly rejected with 403 Forbidden (BOLA mitigation)');

    // 14. Verify Unauthenticated /auth/forgot-password cannot hijack account
    const testUserEmail = `target_user_${Date.now()}@example.com`;
    await db.createUser({ email: testUserEmail, password: 'originalPassword123', name: 'Target' });

    const unauthResetRes = await request('/api/v1/auth/forgot-password', 'POST', {}, {
      email: testUserEmail,
      newPassword: 'hackerPassword123'
    });
    assert.strictEqual(unauthResetRes.status, 200, 'Forgot password returns 200 generic message');
    // Verify password was NOT changed by unauthenticated caller
    const stillOriginalLogin = await db.verifyUserLogin(testUserEmail, 'originalPassword123');
    assert(stillOriginalLogin, 'Original password must remain unchanged after unauthenticated reset request');
    const hackerLoginAttempt = await db.verifyUserLogin(testUserEmail, 'hackerPassword123');
    assert.strictEqual(hackerLoginAttempt, null, 'Hacker password must NOT log in');
    console.log('✓ Unauthenticated /auth/forgot-password does not overwrite account password (ATO mitigated)');

    // 15. Verify /auth/change-password requires correct current password
    const userToChange = await db.createUser({ email: `change_${Date.now()}@example.com`, password: 'oldPass12345', name: 'Change Tester' });
    const userToken = db.generateAuthToken(userToChange);

    const badPassChange = await request('/api/v1/auth/change-password', 'POST', { 'Authorization': `Bearer ${userToken}` }, {
      currentPassword: 'wrongPassword',
      newPassword: 'newValidPass123'
    });
    assert.strictEqual(badPassChange.status, 401, 'Change password with wrong current password must return 401');

    const goodPassChange = await request('/api/v1/auth/change-password', 'POST', { 'Authorization': `Bearer ${userToken}` }, {
      currentPassword: 'oldPass12345',
      newPassword: 'newValidPass123'
    });
    assert.strictEqual(goodPassChange.status, 200, 'Change password with correct current password must return 200');
    console.log('✓ /auth/change-password properly verifies current password before updating');

    // Clean up test projects
    await db.deleteProject(projA.id);
    await db.deleteProject(projB.id);

    console.log('\n🎉 ALL LIVE ENDPOINT & SECURITY VERIFICATIONS PASSED! (15/15)\n');
  } finally {
    server.close();
  }
}

verifyLiveEndpoints().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
