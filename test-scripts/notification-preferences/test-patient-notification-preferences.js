/**
 * PATIENT Role Notification Preferences Endpoints Test
 * Tests all notification preference endpoints accessible to PATIENT role
 *
 * Run with: node test-scripts/notification-preferences/test-patient-notification-preferences.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.PATIENT;

const patientNotificationPreferenceTests = {
  async testGetMyPreferences(ctx) {
    const result = await ctx.makeRequest('GET', '/notification-preferences/me');
    const passed = result.ok || result.status === 404; // 404 if not created yet
    ctx.recordTest('Get My Notification Preferences', passed);
    return passed;
  },

  async testCreatePreferences(ctx) {
    const result = await ctx.makeRequest('POST', '/notification-preferences', {
      email: {
        enabled: true,
        appointmentReminders: true,
        prescriptionReady: true,
        generalUpdates: true,
      },
      push: {
        enabled: true,
        appointmentReminders: true,
        prescriptionReady: true,
        generalUpdates: true,
      },
      sms: {
        enabled: false,
        appointmentReminders: false,
        prescriptionReady: false,
        generalUpdates: false,
      },
    });
    const passed = result.ok || result.status === 400; // 400 if already exists
    ctx.recordTest('Create Notification Preferences', passed);
    return passed;
  },

  async testUpdateMyPreferences(ctx) {
    const result = await ctx.makeRequest('PUT', '/notification-preferences/me', {
      email: {
        enabled: true,
        appointmentReminders: true,
        prescriptionReady: false,
        generalUpdates: true,
      },
      push: {
        enabled: true,
        appointmentReminders: true,
        prescriptionReady: true,
        generalUpdates: false,
      },
    });
    const passed = result.ok || result.status === 404;
    ctx.recordTest('Update My Notification Preferences', passed);
    return passed;
  },

  async testDeleteMyPreferences(ctx) {
    const result = await ctx.makeRequest('DELETE', '/notification-preferences/me');
    const passed = result.ok || result.status === 204 || result.status === 404;
    ctx.recordTest('Delete My Notification Preferences', passed);
    return passed;
  },

  // These should fail for PATIENT (admin only)
  async testGetUserPreferences(ctx) {
    const result = await ctx.makeRequest('GET', `/notification-preferences/${ctx.userId}`);
    const passed = result.status === 403 || result.status === 401; // Expected 403
    ctx.recordTest('Get User Preferences (Admin Only - Expected 403)', passed);
    return passed;
  },

  async testUpdateUserPreferences(ctx) {
    const result = await ctx.makeRequest('PUT', `/notification-preferences/${ctx.userId}`, {
      email: { enabled: true },
    });
    const passed = result.status === 403 || result.status === 401; // Expected 403
    ctx.recordTest('Update User Preferences (Admin Only - Expected 403)', passed);
    return passed;
  },

  async testDeleteUserPreferences(ctx) {
    const result = await ctx.makeRequest('DELETE', `/notification-preferences/${ctx.userId}`);
    const passed = result.status === 403 || result.status === 401; // Expected 403
    ctx.recordTest('Delete User Preferences (Admin Only - Expected 403)', passed);
    return passed;
  },
};

async function runPatientNotificationPreferenceTests() {
  logSection('PATIENT Role Notification Preferences Tests');

  const ctx = new TestContext('PATIENT', TEST_USER);

  // Login
  if (!(await ctx.login())) {
    logSection('Login failed - aborting tests');
    process.exit(1);
  }

  // Run tests
  for (const [testName, testFn] of Object.entries(patientNotificationPreferenceTests)) {
    try {
      await testFn(ctx);
      await wait(500); // Small delay between tests
    } catch (error) {
      ctx.recordTest(testName, false);
      console.error(`Test ${testName} threw error:`, error);
    }
  }

  // Print summary
  ctx.printSummary();

  // Exit with appropriate code
  process.exit(ctx.results.failed > 0 ? 1 : 0);
}

// Run tests
runPatientNotificationPreferenceTests().catch(error => {
  console.error('Patient notification preference tests failed:', error);
  process.exit(1);
});











