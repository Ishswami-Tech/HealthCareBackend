/**
 * PATIENT Role Users Endpoints Test
 * Tests all user management endpoints accessible to PATIENT role
 *
 * Run with: node test-scripts/users/test-patient-users.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.PATIENT;

const patientUsersTests = {
  async testGetProfile(ctx) {
    const result = await ctx.makeRequest('GET', '/user/profile');
    const passed = result.ok;
    ctx.recordTest('Get Profile', passed);
    return passed;
  },

  async testGetUserById(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get User By ID', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/user/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get User By ID', passed);
    return passed;
  },

  async testUpdateUser(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Update User', false, true);
      return false;
    }
    const result = await ctx.makeRequest('PATCH', `/user/${ctx.userId}`, {
      firstName: 'Updated',
    });
    const passed = result.ok || result.status === 403 || result.status === 400; // 403 = permission, 400 = validation
    ctx.recordTest('Update User', passed);
    return passed;
  },

  async testGetPatients(ctx) {
    const result = await ctx.makeRequest('GET', '/user/role/patient');
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Patients', passed);
    return passed;
  },
};

async function runPatientUsersTests() {
  logSection('PATIENT Role Users Endpoints Test');

  const ctx = new TestContext('PATIENT', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  const testSuite = ['testGetProfile', 'testGetUserById', 'testUpdateUser', 'testGetPatients'];

  for (const testName of testSuite) {
    const testFn = patientUsersTests[testName];
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

runPatientUsersTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
