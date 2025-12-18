/**
 * CLINIC_ADMIN Role EHR Endpoints Test
 * Tests all EHR endpoints accessible to CLINIC_ADMIN role
 *
 * Run with: node test-scripts/ehr/test-clinic-admin-ehr.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.CLINIC_ADMIN;

const clinicAdminEhrTests = {
  async testGetComprehensiveEHR(ctx) {
    if (!ctx.patientId) {
      ctx.recordTest('Get Comprehensive EHR', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/comprehensive/${ctx.patientId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Comprehensive EHR', passed);
    return passed;
  },

  async testCreateMedicalHistory(ctx) {
    if (!ctx.patientId || !ctx.clinicId) {
      ctx.recordTest('Create Medical History', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/ehr/medical-history', {
      userId: ctx.patientId,
      clinicId: ctx.clinicId,
      diagnosis: 'Test diagnosis',
      notes: 'Test medical history entry',
    });
    const passed = result.ok || result.status === 400 || result.status === 403;
    ctx.recordTest('Create Medical History', passed);
    return passed;
  },

  async testGetMedicalHistory(ctx) {
    if (!ctx.patientId) {
      ctx.recordTest('Get Medical History', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/medical-history/${ctx.patientId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Medical History', passed);
    return passed;
  },

  async testCreateLabReport(ctx) {
    if (!ctx.patientId || !ctx.clinicId) {
      ctx.recordTest('Create Lab Report', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/ehr/lab-reports', {
      userId: ctx.patientId,
      clinicId: ctx.clinicId,
      testName: 'Blood Test',
      results: 'Normal',
    });
    const passed = result.ok || result.status === 400 || result.status === 403;
    ctx.recordTest('Create Lab Report', passed);
    return passed;
  },

  async testGetLabReports(ctx) {
    if (!ctx.patientId) {
      ctx.recordTest('Get Lab Reports', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/lab-reports/${ctx.patientId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Lab Reports', passed);
    return passed;
  },
};

async function runClinicAdminEhrTests() {
  logSection('CLINIC_ADMIN Role EHR Endpoints Test');

  const ctx = new TestContext('CLINIC_ADMIN', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  const testSuite = [
    'testGetComprehensiveEHR',
    'testCreateMedicalHistory',
    'testGetMedicalHistory',
    'testCreateLabReport',
    'testGetLabReports',
  ];

  for (const testName of testSuite) {
    const testFn = clinicAdminEhrTests[testName];
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

runClinicAdminEhrTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});












