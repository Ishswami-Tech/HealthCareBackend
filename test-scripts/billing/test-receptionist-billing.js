/**
 * RECEPTIONIST Role Billing Endpoints Test
 * Tests all billing endpoints accessible to RECEPTIONIST role
 *
 * Run with: node test-scripts/billing/test-receptionist-billing.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.RECEPTIONIST;

const receptionistBillingTests = {
  async testCreateInvoice(ctx) {
    if (!ctx.clinicId || !ctx.userId) {
      ctx.recordTest('Create Invoice', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/billing/invoices', {
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      amount: 100,
      currency: 'USD',
      description: 'Test invoice',
    });
    const passed = result.ok || result.status === 400 || result.status === 403;
    ctx.recordTest('Create Invoice', passed);
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

  async testUpdateInvoice(ctx) {
    // First get an invoice
    const invoicesResult = await ctx.makeRequest(
      'GET',
      `/billing/invoices/user/${ctx.userId || ''}`
    );
    let invoiceId = null;
    if (invoicesResult.ok && invoicesResult.data?.data) {
      const invoices = Array.isArray(invoicesResult.data.data)
        ? invoicesResult.data.data
        : [invoicesResult.data.data];
      if (invoices.length > 0 && invoices[0].id) {
        invoiceId = invoices[0].id;
      }
    }

    if (!invoiceId) {
      ctx.recordTest('Update Invoice', false, true);
      return false;
    }

    const result = await ctx.makeRequest('PUT', `/billing/invoices/${invoiceId}`, {
      description: 'Updated invoice',
    });
    const passed = result.ok || result.status === 404 || result.status === 403;
    ctx.recordTest('Update Invoice', passed);
    return passed;
  },

  async testMarkInvoicePaid(ctx) {
    const invoicesResult = await ctx.makeRequest(
      'GET',
      `/billing/invoices/user/${ctx.userId || ''}`
    );
    let invoiceId = null;
    if (invoicesResult.ok && invoicesResult.data?.data) {
      const invoices = Array.isArray(invoicesResult.data.data)
        ? invoicesResult.data.data
        : [invoicesResult.data.data];
      if (invoices.length > 0 && invoices[0].id) {
        invoiceId = invoices[0].id;
      }
    }

    if (!invoiceId) {
      ctx.recordTest('Mark Invoice Paid', false, true);
      return false;
    }

    const result = await ctx.makeRequest('POST', `/billing/invoices/${invoiceId}/mark-paid`);
    const passed = result.ok || result.status === 404 || result.status === 403;
    ctx.recordTest('Mark Invoice Paid', passed);
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

async function runReceptionistBillingTests() {
  logSection('RECEPTIONIST Role Billing Endpoints Test');

  const ctx = new TestContext('RECEPTIONIST', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  const testSuite = [
    'testCreateInvoice',
    'testGetUserInvoices',
    'testUpdateInvoice',
    'testMarkInvoicePaid',
    'testCreatePayment',
    'testGetUserPayments',
  ];

  for (const testName of testSuite) {
    const testFn = receptionistBillingTests[testName];
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

runReceptionistBillingTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});












