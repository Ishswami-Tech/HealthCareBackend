/**
 * PATIENT Role Clinic Endpoints Test
 * Tests all clinic endpoints accessible to PATIENT role
 *
 * Run with: node test-scripts/clinic/test-patient-clinic.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.PATIENT;

const patientClinicTests = {
  async testGetClinicById(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Get Clinic By ID', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/clinics/${ctx.clinicId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Clinic By ID', passed);
    return passed;
  },

  async testGetMyClinic(ctx) {
    const result = await ctx.makeRequest('GET', '/clinics/my-clinic');
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get My Clinic', passed);
    return passed;
  },

  async testGetClinicDoctors(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Get Clinic Doctors', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/clinics/${ctx.clinicId}/doctors`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Clinic Doctors', passed);
    return passed;
  },

  async testGetClinicPatients(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Get Clinic Patients', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/clinics/${ctx.clinicId}/patients`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Clinic Patients', passed);
    return passed;
  },

  async testRegisterPatient(ctx) {
    const result = await ctx.makeRequest('POST', '/clinics/register', {
      email: `testpatient_${Date.now()}@example.com`,
      password: 'TestPassword123!',
      firstName: 'Test',
      lastName: 'Patient',
      phone: '+1234567890',
      clinicId: ctx.clinicId,
    });
    const passed =
      result.ok || result.status === 400 || result.status === 403 || result.status === 409;
    ctx.recordTest('Register Patient', passed);
    return passed;
  },
};

async function runPatientClinicTests() {
  logSection('PATIENT Role Clinic Endpoints Test');

  const ctx = new TestContext('PATIENT', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  const testSuite = [
    'testGetClinicById',
    'testGetMyClinic',
    'testGetClinicDoctors',
    'testGetClinicPatients',
    'testRegisterPatient',
  ];

  for (const testName of testSuite) {
    const testFn = patientClinicTests[testName];
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

runPatientClinicTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
