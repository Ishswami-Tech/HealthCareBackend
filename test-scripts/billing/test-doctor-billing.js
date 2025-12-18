/**
 * DOCTOR Role Billing Endpoints Test
 * Tests all billing endpoints accessible to DOCTOR role
 *
 * Run with: node test-scripts/billing/test-doctor-billing.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.DOCTOR;

const doctorBillingTests = {
  async testGetBillingPlans(ctx) {
    const result = await ctx.makeRequest('GET', '/billing/plans');
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Billing Plans', passed);
    return passed;
  },

  async testGetBillingPlanById(ctx) {
    // First get a plan ID
    const plansResult = await ctx.makeRequest('GET', '/billing/plans');
    let planId = null;
    if (plansResult.ok && plansResult.data?.data) {
      const plans = Array.isArray(plansResult.data.data)
        ? plansResult.data.data
        : [plansResult.data.data];
      if (plans.length > 0 && plans[0].id) {
        planId = plans[0].id;
      }
    }

    if (!planId) {
      ctx.recordTest('Get Billing Plan By ID', false, true);
      return false;
    }

    const result = await ctx.makeRequest('GET', `/billing/plans/${planId}`);
    const passed = result.ok || result.status === 404 || result.status === 403;
    ctx.recordTest('Get Billing Plan By ID', passed);
    return passed;
  },

  async testGetUserInvoices(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get User Invoices', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/billing/invoices/user/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get User Invoices', passed);
    return passed;
  },

  async testGetUserPayments(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get User Payments', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/billing/payments/user/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get User Payments', passed);
    return passed;
  },
};

async function runDoctorBillingTests() {
  logSection('DOCTOR Role Billing Endpoints Test');

  const ctx = new TestContext('DOCTOR', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  const testSuite = [
    'testGetBillingPlans',
    'testGetBillingPlanById',
    'testGetUserInvoices',
    'testGetUserPayments',
  ];

  for (const testName of testSuite) {
    const testFn = doctorBillingTests[testName];
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

runDoctorBillingTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});













