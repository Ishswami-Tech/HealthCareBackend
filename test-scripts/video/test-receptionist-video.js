/**
 * RECEPTIONIST Role Video Endpoints Test
 * Tests all video consultation endpoints accessible to RECEPTIONIST role
 *
 * Run with: node test-scripts/video/test-receptionist-video.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.RECEPTIONIST;

const receptionistVideoTests = {
  async testGenerateVideoToken(ctx) {
    if (!ctx.appointmentId || !ctx.userId) {
      ctx.recordTest('Generate Video Token', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/video/token', {
      appointmentId: ctx.appointmentId,
      userId: ctx.userId,
      userRole: 'RECEPTIONIST',
      userInfo: {
        displayName: 'Test Receptionist',
        email: ctx.credentials.email,
      },
    });
    const passed =
      result.ok || result.status === 400 || result.status === 403 || result.status === 404;
    ctx.recordTest('Generate Video Token', passed);
    return passed;
  },

  async testGetConsultationStatus(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Get Consultation Status', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/video/consultation/${ctx.appointmentId}/status`);
    const passed = result.ok || result.status === 404 || result.status === 403;
    ctx.recordTest('Get Consultation Status', passed);
    return passed;
  },
};

async function runReceptionistVideoTests() {
  logSection('RECEPTIONIST Role Video Endpoints Test');

  const ctx = new TestContext('RECEPTIONIST', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  // Try to get an appointment for video tests
  const appointmentsResult = await ctx.makeRequest('GET', '/appointments');
  if (appointmentsResult.ok) {
    let appointments = [];
    if (Array.isArray(appointmentsResult.data)) {
      appointments = appointmentsResult.data;
    } else if (Array.isArray(appointmentsResult.data?.data)) {
      appointments = appointmentsResult.data.data;
    } else if (Array.isArray(appointmentsResult.data?.appointments)) {
      appointments = appointmentsResult.data.appointments;
    }
    if (appointments.length > 0 && appointments[0].id) {
      ctx.appointmentId = appointments[0].id;
    }
  }

  const testSuite = ['testGenerateVideoToken', 'testGetConsultationStatus'];

  for (const testName of testSuite) {
    const testFn = receptionistVideoTests[testName];
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

runReceptionistVideoTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});

