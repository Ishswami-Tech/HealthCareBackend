/**
 * Health Check Endpoint Test
 * Tests the health check endpoint (public, no auth required)
 *
 * Run with: node test-scripts/health/test-health.js
 */

const { TestContext, logSection, wait } = require('../_shared-utils');

const { httpRequestJson } = require('../_shared-utils');

const healthTests = {
  async testHealthCheck(ctx) {
    // Health check is public, no auth needed and is excluded from /api/v1 prefix
    // So it's at /health, not /api/v1/health
    const BASE_URL = 'http://localhost:8088';
    const result = await httpRequestJson('GET', `${BASE_URL}/health`, null, {
      'User-Agent': 'healthcare-api-test',
    });
    // Health endpoint returns 200 even if degraded, so check for status 200
    const passed = result.status === 200 || result.ok;
    ctx.recordTest('Health Check', passed);
    if (!passed) {
      console.error('Health check failed:', result.status, result.data);
    }
    return passed;
  },
};

async function runHealthTests() {
  logSection('Health Check Endpoint Test');

  // Health check doesn't require authentication, so we can use a dummy context
  const ctx = new TestContext('SYSTEM', { email: '', password: '' });

  const testSuite = ['testHealthCheck'];

  for (const testName of testSuite) {
    const testFn = healthTests[testName];
    if (testFn) {
      try {
        await testFn(ctx);
        await wait(300);
      } catch (error) {
        ctx.recordTest(testName, false);
      }
    }
  }

  ctx.printSummary();

  if (ctx.results.failed > 0) {
    process.exit(1);
  }
}

runHealthTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});


























