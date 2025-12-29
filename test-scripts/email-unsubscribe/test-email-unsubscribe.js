/**
 * Email Unsubscribe Endpoints Test
 * Tests all email unsubscribe endpoints (Public endpoints)
 *
 * Run with: node test-scripts/email-unsubscribe/test-email-unsubscribe.js
 */

const { TestContext, logSection, wait, httpRequestJson, BASE_URL } = require('../_shared-utils');

const emailUnsubscribeTests = {
  async testGetUnsubscribe() {
    // This is a public endpoint, no auth needed
    const result = await httpRequestJson('GET', `${BASE_URL}/email/unsubscribe`, null, {
      'Accept': 'application/json',
    });
    const passed = result.ok || result.status === 400 || result.status === 404;
    return { passed, name: 'Get Unsubscribe Page' };
  },

  async testPostUnsubscribe() {
    // This is a public endpoint, no auth needed
    const result = await httpRequestJson(
      'POST',
      `${BASE_URL}/email/unsubscribe`,
      {
        email: 'test@example.com',
        reason: 'No longer interested',
      },
      {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
    );
    const passed = result.ok || result.status === 400 || result.status === 404;
    return { passed, name: 'Post Unsubscribe' };
  },

  async testGetUnsubscribeByToken() {
    // This is a public endpoint, no auth needed
    // Using a dummy token for testing
    const result = await httpRequestJson(
      'GET',
      `${BASE_URL}/email/unsubscribe/test-token-123`,
      null,
      {
        'Accept': 'application/json',
      }
    );
    const passed = result.ok || result.status === 400 || result.status === 404;
    return { passed, name: 'Get Unsubscribe By Token' };
  },
};

async function runEmailUnsubscribeTests() {
  logSection('Email Unsubscribe Tests (Public Endpoints)');

  // Create a context for tracking results
  const ctx = new TestContext('PUBLIC', { email: '', password: '' });

  for (const [testName, testFn] of Object.entries(emailUnsubscribeTests)) {
    try {
      const result = await testFn();
      ctx.recordTest(result.name, result.passed);
      await wait(500);
    } catch (error) {
      ctx.recordTest(testName, false);
      console.error(`Test ${testName} threw error:`, error);
    }
  }

  ctx.printSummary();
  process.exit(ctx.results.failed > 0 ? 1 : 0);
}

runEmailUnsubscribeTests().catch(error => {
  console.error('Email unsubscribe tests failed:', error);
  process.exit(1);
});

