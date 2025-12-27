/**
 * PATIENT Role EHR Endpoints Test
 * Tests all EHR endpoints accessible to PATIENT role
 *
 * Run with: node test-scripts/ehr/test-patient-ehr.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.PATIENT;

const patientEhrTests = {
  async testGetComprehensiveEHR(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Comprehensive EHR', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/comprehensive/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Comprehensive EHR', passed);
    return passed;
  },

  async testGetMedicalHistory(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Medical History', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/medical-history/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Medical History', passed);
    return passed;
  },

  async testGetLabReports(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Lab Reports', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/lab-reports/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Lab Reports', passed);
    return passed;
  },

  async testGetRadiologyReports(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Radiology Reports', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/radiology-reports/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Radiology Reports', passed);
    return passed;
  },

  async testGetSurgicalRecords(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Surgical Records', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/surgical-records/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Surgical Records', passed);
    return passed;
  },

  async testGetVitals(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Vitals', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/vitals/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Vitals', passed);
    return passed;
  },

  async testGetAllergies(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Allergies', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/allergies/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Allergies', passed);
    return passed;
  },

  async testGetMedications(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Medications', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/medications/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Medications', passed);
    return passed;
  },

  async testGetImmunizations(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Immunizations', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/immunizations/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Immunizations', passed);
    return passed;
  },

  async testGetHealthTrends(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Health Trends', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/analytics/health-trends/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Health Trends', passed);
    return passed;
  },

  async testGetMedicationAdherence(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Medication Adherence', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'GET',
      `/ehr/analytics/medication-adherence/${ctx.userId}`
    );
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Medication Adherence', passed);
    return passed;
  },
};

async function runPatientEhrTests() {
  logSection('PATIENT Role EHR Endpoints Test');

  const ctx = new TestContext('PATIENT', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  const testSuite = [
    'testGetComprehensiveEHR',
    'testGetMedicalHistory',
    'testGetLabReports',
    'testGetRadiologyReports',
    'testGetSurgicalRecords',
    'testGetVitals',
    'testGetAllergies',
    'testGetMedications',
    'testGetImmunizations',
    'testGetHealthTrends',
    'testGetMedicationAdherence',
  ];

  for (const testName of testSuite) {
    const testFn = patientEhrTests[testName];
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

runPatientEhrTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});


























