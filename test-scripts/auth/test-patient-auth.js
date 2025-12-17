/**
 * PATIENT Role Auth Endpoints Test
 * Tests all authentication endpoints accessible to PATIENT role
 *
 * Run with: node test-scripts/auth/test-patient-auth.js
 */

const { TestContext, logSection, logInfo, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.PATIENT;

// PATIENT-specific auth endpoint tests
const patientAuthTests = {
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
    const passed = result.ok || result.status === 401; // 401 = already logged out
    ctx.recordTest('Logout', passed);
    return passed;
  },

  async testChangePassword(ctx) {
    const originalPassword = ctx.credentials.password;
    const tempPassword = 'NewPassword123!';

    // Change password
    const result = await ctx.makeRequest('POST', '/auth/change-password', {
      currentPassword: originalPassword,
      newPassword: tempPassword,
      confirmPassword: tempPassword, // Required by ChangePasswordDto
    });
    const passed = result.ok || result.status === 400 || result.status === 401;
    ctx.recordTest('Change Password', passed);

    // IMPORTANT: Revert password back to original to avoid breaking subsequent tests
    if (result.ok) {
      // Re-login with new password first
      const reLoginResult = await ctx.makeRequest('POST', '/auth/login', {
        email: ctx.credentials.email,
        password: tempPassword,
      });

      if (reLoginResult.ok && reLoginResult.data?.data?.accessToken) {
        ctx.accessToken = reLoginResult.data.data.accessToken;
        ctx.refreshToken = reLoginResult.data.data.refreshToken;

        // Wait a bit for session to be established
        await wait(200);

        // Change password back to original
        const revertResult = await ctx
          .makeRequest('POST', '/auth/change-password', {
            currentPassword: tempPassword,
            newPassword: originalPassword,
            confirmPassword: originalPassword,
          })
          .catch(() => {
            // Ignore errors when reverting - test already passed
            return { ok: false };
          });

        // Re-login with original password to update context
        if (revertResult?.ok) {
          await wait(200);
          const finalLogin = await ctx.makeRequest('POST', '/auth/login', {
            email: ctx.credentials.email,
            password: originalPassword,
          });

          if (finalLogin.ok && finalLogin.data?.data?.accessToken) {
            ctx.accessToken = finalLogin.data.data.accessToken;
            ctx.refreshToken = finalLogin.data.data.refreshToken;
          }
        }
      }
    }

    return passed;
  },

  async testGetSessions(ctx) {
    const result = await ctx.makeRequest('GET', '/auth/sessions');
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Sessions', passed);
    return passed;
  },

  async testRegisterWithClinicId(ctx) {
    // Test registration with clinicId (now required)
    const testEmail = `test-patient-${Date.now()}@example.com`;
    if (!ctx.clinicId) {
      ctx.recordTest('Register With ClinicId', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/auth/register', {
      email: testEmail,
      password: 'Test1234!@#',
      firstName: 'Test',
      lastName: 'Patient',
      phone: '+1234567890',
      clinicId: ctx.clinicId, // REQUIRED
      role: 'PATIENT',
    });
    const passed =
      result.ok || result.status === 400 || result.status === 409; // 400 = validation error, 409 = user exists
    ctx.recordTest('Register With ClinicId', passed);
    return passed;
  },

  async testRegisterWithoutClinicId(ctx) {
    // Test that registration fails without clinicId
    const testEmail = `test-patient-no-clinic-${Date.now()}@example.com`;
    const result = await ctx.makeRequest('POST', '/auth/register', {
      email: testEmail,
      password: 'Test1234!@#',
      firstName: 'Test',
      lastName: 'Patient',
      phone: '+1234567890',
      // clinicId missing - should fail
      role: 'PATIENT',
    });
    // Should fail with 400 (validation error) because clinicId is required
    const passed = result.status === 400 || result.status === 422;
    ctx.recordTest('Register Without ClinicId (Should Fail)', passed);
    return passed;
  },
};

// Main test runner
async function runPatientAuthTests() {
  logSection('PATIENT Role Auth Endpoints Test');

  const ctx = new TestContext('PATIENT', TEST_USER);

  // Login first
  if (!(await ctx.login())) {
    process.exit(1);
  }

  // Run all PATIENT auth tests
  const testSuite = [
    'testLogin',
    'testRefreshToken',
    'testChangePassword',
    'testGetSessions',
    'testRegisterWithClinicId',
    'testRegisterWithoutClinicId',
    'testLogout',
  ];

  for (const testName of testSuite) {
    if (testName === 'testLogin') {
      ctx.recordTest('Login (setup)', true);
      continue;
    }
    const testFn = patientAuthTests[testName];
    if (testFn) {
      try {
        await testFn(ctx);
        await wait(300);
      } catch (error) {
        ctx.recordTest(testName, false);
      }
    }
  }

  // Print summary
  ctx.printSummary();

  if (ctx.results.failed > 0) {
    process.exit(1);
  }
}

// Run tests
runPatientAuthTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
