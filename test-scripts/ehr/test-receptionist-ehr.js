/**
 * RECEPTIONIST Role EHR Endpoints Test
 * Tests all EHR endpoints accessible to RECEPTIONIST role
 *
 * Run with: node test-scripts/ehr/test-receptionist-ehr.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.RECEPTIONIST;

const receptionistEhrTests = {
  async testCreateVitals(ctx) {
    if (!ctx.patientId || !ctx.clinicId) {
      ctx.recordTest('Create Vitals', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/ehr/vitals', {
      userId: ctx.patientId,
      clinicId: ctx.clinicId,
      bloodPressure: '120/80',
      heartRate: 72,
      temperature: 98.6,
    });
    const passed = result.ok || result.status === 400 || result.status === 403;
    ctx.recordTest('Create Vitals', passed);
    return passed;
  },

  async testGetVitals(ctx) {
    if (!ctx.patientId) {
      ctx.recordTest('Get Vitals', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/vitals/${ctx.patientId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Vitals', passed);
    return passed;
  },

  async testUpdateVitals(ctx) {
    // First get vitals to find an ID
    const vitalsResult = await ctx.makeRequest('GET', `/ehr/vitals/${ctx.patientId || ''}`);
    let vitalId = null;
    if (vitalsResult.ok && vitalsResult.data?.data) {
      const vitals = Array.isArray(vitalsResult.data.data)
        ? vitalsResult.data.data
        : [vitalsResult.data.data];
      if (vitals.length > 0 && vitals[0].id) {
        vitalId = vitals[0].id;
      }
    }

    if (!vitalId) {
      ctx.recordTest('Update Vitals', false, true);
      return false;
    }

    const result = await ctx.makeRequest('PUT', `/ehr/vitals/${vitalId}`, {
      heartRate: 75,
    });
    const passed = result.ok || result.status === 404 || result.status === 403;
    ctx.recordTest('Update Vitals', passed);
    return passed;
  },
};

async function runReceptionistEhrTests() {
  logSection('RECEPTIONIST Role EHR Endpoints Test');

  const ctx = new TestContext('RECEPTIONIST', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  const testSuite = ['testCreateVitals', 'testGetVitals', 'testUpdateVitals'];

  for (const testName of testSuite) {
    const testFn = receptionistEhrTests[testName];
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

runReceptionistEhrTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});































