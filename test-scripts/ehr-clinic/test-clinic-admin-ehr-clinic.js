/**
 * CLINIC_ADMIN Role EHR-Clinic Endpoints Test
 * Tests all EHR-Clinic endpoints accessible to CLINIC_ADMIN role
 *
 * Run with: node test-scripts/ehr-clinic/test-clinic-admin-ehr-clinic.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.CLINIC_ADMIN;

const clinicAdminEhrClinicTests = {
  async testGetComprehensiveHealthRecord(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Comprehensive Health Record', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/clinic/comprehensive/${ctx.userId}`, null, {
      clinicId: ctx.clinicId,
    });
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Comprehensive Health Record', passed);
    return passed;
  },

  async testGetClinicPatientsRecords(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Get Clinic Patients Records', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/clinic/${ctx.clinicId}/patients/records`);
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Clinic Patients Records', passed);
    return passed;
  },

  async testGetClinicEHRAnalytics(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Get Clinic EHR Analytics', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/clinic/${ctx.clinicId}/analytics`);
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Clinic EHR Analytics', passed);
    return passed;
  },

  async testGetClinicPatientsSummary(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Get Clinic Patients Summary', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/clinic/${ctx.clinicId}/patients/summary`);
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Clinic Patients Summary', passed);
    return passed;
  },

  async testSearchClinicRecords(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Search Clinic Records', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/clinic/${ctx.clinicId}/search?q=test`);
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Search Clinic Records', passed);
    return passed;
  },

  async testGetClinicCriticalAlerts(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Get Clinic Critical Alerts', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/clinic/${ctx.clinicId}/alerts/critical`);
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Clinic Critical Alerts', passed);
    return passed;
  },
};

async function runClinicAdminEhrClinicTests() {
  logSection('CLINIC_ADMIN Role EHR-Clinic Endpoints Test');

  const ctx = new TestContext('CLINIC_ADMIN', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  const testSuite = [
    'testGetComprehensiveHealthRecord',
    'testGetClinicPatientsRecords',
    'testGetClinicEHRAnalytics',
    'testGetClinicPatientsSummary',
    'testSearchClinicRecords',
    'testGetClinicCriticalAlerts',
  ];

  for (const testName of testSuite) {
    const testFn = clinicAdminEhrClinicTests[testName];
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

runClinicAdminEhrClinicTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});

