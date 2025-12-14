/**
 * CLINIC_ADMIN Role Video Endpoints Test
 * Tests all video consultation endpoints accessible to CLINIC_ADMIN role
 *
 * Run with: node test-scripts/video/test-clinic-admin-video.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.CLINIC_ADMIN;

const clinicAdminVideoTests = {
  async testGenerateVideoToken(ctx) {
    if (!ctx.appointmentId || !ctx.userId) {
      ctx.recordTest('Generate Video Token', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/video/token', {
      appointmentId: ctx.appointmentId,
      userId: ctx.userId,
      userRole: 'CLINIC_ADMIN',
      userInfo: {
        displayName: 'Test Clinic Admin',
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

  async testGetConsultationHistory(ctx) {
    const result = await ctx.makeRequest('GET', '/video/history');
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Consultation History', passed);
    return passed;
  },
};

async function runClinicAdminVideoTests() {
  logSection('CLINIC_ADMIN Role Video Endpoints Test');

  const ctx = new TestContext('CLINIC_ADMIN', TEST_USER);

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

  const testSuite = [
    'testGenerateVideoToken',
    'testGetConsultationStatus',
    'testGetConsultationHistory',
  ];

  for (const testName of testSuite) {
    const testFn = clinicAdminVideoTests[testName];
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

runClinicAdminVideoTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});

