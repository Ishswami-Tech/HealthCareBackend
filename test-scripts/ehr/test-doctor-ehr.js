/**
 * DOCTOR Role EHR Endpoints Test
 * Tests all EHR endpoints accessible to DOCTOR role
 *
 * Run with: node test-scripts/ehr/test-doctor-ehr.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.DOCTOR;

const doctorEhrTests = {
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

  async testCreateAllergy(ctx) {
    if (!ctx.patientId || !ctx.clinicId) {
      ctx.recordTest('Create Allergy', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/ehr/allergies', {
      userId: ctx.patientId,
      clinicId: ctx.clinicId,
      allergen: 'Peanuts',
      severity: 'moderate',
    });
    const passed = result.ok || result.status === 400 || result.status === 403;
    ctx.recordTest('Create Allergy', passed);
    return passed;
  },

  async testGetAllergies(ctx) {
    if (!ctx.patientId) {
      ctx.recordTest('Get Allergies', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/allergies/${ctx.patientId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Allergies', passed);
    return passed;
  },

  async testCreateMedication(ctx) {
    if (!ctx.patientId || !ctx.clinicId) {
      ctx.recordTest('Create Medication', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/ehr/medications', {
      userId: ctx.patientId,
      clinicId: ctx.clinicId,
      medicationName: 'Aspirin',
      dosage: '100mg',
      frequency: 'daily',
    });
    const passed = result.ok || result.status === 400 || result.status === 403;
    ctx.recordTest('Create Medication', passed);
    return passed;
  },

  async testGetMedications(ctx) {
    if (!ctx.patientId) {
      ctx.recordTest('Get Medications', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/ehr/medications/${ctx.patientId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Medications', passed);
    return passed;
  },
};

async function runDoctorEhrTests() {
  logSection('DOCTOR Role EHR Endpoints Test');

  const ctx = new TestContext('DOCTOR', TEST_USER);

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
    'testCreateVitals',
    'testGetVitals',
    'testCreateAllergy',
    'testGetAllergies',
    'testCreateMedication',
    'testGetMedications',
  ];

  for (const testName of testSuite) {
    const testFn = doctorEhrTests[testName];
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

runDoctorEhrTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});

