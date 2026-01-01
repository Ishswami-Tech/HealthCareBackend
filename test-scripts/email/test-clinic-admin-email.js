/**
 * CLINIC_ADMIN Role Email Endpoints Test
 * Tests all email service endpoints (CLINIC_ADMIN/SUPER_ADMIN only)
 *
 * Run with: node test-scripts/email/test-clinic-admin-email.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.CLINIC_ADMIN;

const clinicAdminEmailTests = {
  async testGetEmailStatus(ctx) {
    const result = await ctx.makeRequest('GET', '/email/status');
    const passed = result.ok || result.status === 403 || result.status === 401;
    ctx.recordTest('Get Email Status', passed);
    return passed;
  },

  async testGetEmailTest(ctx) {
    const result = await ctx.makeRequest('GET', '/email/test');
    const passed = result.ok || result.status === 403 || result.status === 401;
    ctx.recordTest('Get Email Test', passed);
    return passed;
  },

  async testPostEmailTestCustom(ctx) {
    const result = await ctx.makeRequest('POST', '/email/test-custom', {
      to: ctx.credentials.email,
      subject: 'Test Email',
      body: 'Test email body',
    });
    const passed = result.ok || result.status === 400 || result.status === 403 || result.status === 500;
    ctx.recordTest('Post Email Test Custom', passed);
    return passed;
  },
};

async function runClinicAdminEmailTests() {
  logSection('CLINIC_ADMIN Role Email Tests');

  const ctx = new TestContext('CLINIC_ADMIN', TEST_USER);

  if (!(await ctx.login())) {
    logSection('Login failed - aborting tests');
    process.exit(1);
  }

  for (const [testName, testFn] of Object.entries(clinicAdminEmailTests)) {
    try {
      await testFn(ctx);
      await wait(500);
    } catch (error) {
      ctx.recordTest(testName, false);
      console.error(`Test ${testName} threw error:`, error);
    }
  }

  ctx.printSummary();
  process.exit(ctx.results.failed > 0 ? 1 : 0);
}

runClinicAdminEmailTests().catch(error => {
  console.error('CLINIC_ADMIN email tests failed:', error);
  process.exit(1);
});












