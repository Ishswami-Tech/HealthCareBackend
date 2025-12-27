/**
 * PATIENT Role Billing Endpoints Test
 * Tests all billing endpoints accessible to PATIENT role
 *
 * Run with: node test-scripts/billing/test-patient-billing.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.PATIENT;

const patientBillingTests = {
  async testCreateSubscription(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Create Subscription', false, true);
      return false;
    }
    // First get available plans
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
      ctx.recordTest('Create Subscription', false, true);
      return false;
    }

    const result = await ctx.makeRequest('POST', '/billing/subscriptions', {
      planId,
      userId: ctx.userId,
      clinicId: ctx.clinicId,
    });
    const passed =
      result.ok || result.status === 400 || result.status === 403 || result.status === 409;
    ctx.recordTest('Create Subscription', passed);
    return passed;
  },

  async testGetUserSubscriptions(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get User Subscriptions', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/billing/subscriptions/user/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get User Subscriptions', passed);
    return passed;
  },

  async testGetActiveSubscription(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Active Subscription', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/billing/subscriptions/user/${ctx.userId}/active`);
    const passed = result.ok || result.status === 404 || result.status === 403;
    ctx.recordTest('Get Active Subscription', passed);
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

  async testCreatePayment(ctx) {
    if (!ctx.userId || !ctx.clinicId) {
      ctx.recordTest('Create Payment', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/billing/payments', {
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      amount: 100,
      currency: 'USD',
      paymentMethod: 'card',
    });
    const passed = result.ok || result.status === 400 || result.status === 403;
    ctx.recordTest('Create Payment', passed);
    return passed;
  },
};

async function runPatientBillingTests() {
  logSection('PATIENT Role Billing Endpoints Test');

  const ctx = new TestContext('PATIENT', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  const testSuite = [
    'testCreateSubscription',
    'testGetUserSubscriptions',
    'testGetActiveSubscription',
    'testGetUserInvoices',
    'testGetUserPayments',
    'testCreatePayment',
  ];

  for (const testName of testSuite) {
    const testFn = patientBillingTests[testName];
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

runPatientBillingTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});


























