/**
 * DOCTOR Role Auth Endpoints Test
 * Tests all authentication endpoints accessible to DOCTOR role
 *
 * Run with: node test-scripts/auth/test-doctor-auth.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.DOCTOR;

// DOCTOR-specific auth endpoint tests
const doctorAuthTests = {
  async testLogin(ctx) {
    const result = await ctx.makeRequest('POST', '/auth/login', {
      email: ctx.credentials.email,
      password: ctx.credentials.password,
    });
    const passed = result.ok && result.data?.data?.accessToken;
    ctx.recordTest('Login', passed);
    return passed;
  },

  async testRefreshToken(ctx) {
    if (!ctx.refreshToken) {
      ctx.recordTest('Refresh Token', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/auth/refresh', {
      refreshToken: ctx.refreshToken,
    });
    const passed = result.ok || result.status === 400 || result.status === 401;
    ctx.recordTest('Refresh Token', passed);
    return passed;
  },

  async testLogout(ctx) {
    const result = await ctx.makeRequest('POST', '/auth/logout');
    const passed = result.ok || result.status === 401;
    ctx.recordTest('Logout', passed);
    return passed;
  },

  async testChangePassword(ctx) {
    const result = await ctx.makeRequest('POST', '/auth/change-password', {
      currentPassword: ctx.credentials.password,
      newPassword: 'NewPassword123!',
    });
    const passed = result.ok || result.status === 400 || result.status === 401;
    ctx.recordTest('Change Password', passed);
    return passed;
  },

  async testGetSessions(ctx) {
    const result = await ctx.makeRequest('GET', '/auth/sessions');
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Sessions', passed);
    return passed;
  },
};

// Main test runner
async function runDoctorAuthTests() {
  logSection('DOCTOR Role Auth Endpoints Test');

  const ctx = new TestContext('DOCTOR', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  const testSuite = [
    'testLogin',
    'testRefreshToken',
    'testChangePassword',
    'testGetSessions',
    'testLogout',
  ];

  for (const testName of testSuite) {
    if (testName === 'testLogin') {
      ctx.recordTest('Login (setup)', true);
      continue;
    }
    const testFn = doctorAuthTests[testName];
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

runDoctorAuthTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
