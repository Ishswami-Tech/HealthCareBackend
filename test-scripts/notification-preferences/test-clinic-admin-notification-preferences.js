/**
 * CLINIC_ADMIN Role Notification Preferences Endpoints Test
 * Tests all notification preference endpoints accessible to CLINIC_ADMIN role
 *
 * Run with: node test-scripts/notification-preferences/test-clinic-admin-notification-preferences.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.CLINIC_ADMIN;

const clinicAdminNotificationPreferenceTests = {
  async testGetMyPreferences(ctx) {
    const result = await ctx.makeRequest('GET', '/notification-preferences/me');
    const passed = result.ok || result.status === 404;
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
    const passed = result.ok || result.status === 400;
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

  // Admin-only endpoints
  async testGetUserPreferences(ctx) {
    // Use a test patient ID if available, otherwise use own ID
    const testUserId = ctx.patientId || ctx.userId;
    const result = await ctx.makeRequest('GET', `/notification-preferences/${testUserId}`);
    const passed = result.ok || result.status === 404;
    ctx.recordTest('Get User Preferences (Admin)', passed);
    return passed;
  },

  async testUpdateUserPreferences(ctx) {
    const testUserId = ctx.patientId || ctx.userId;
    const result = await ctx.makeRequest('PUT', `/notification-preferences/${testUserId}`, {
      email: {
        enabled: true,
        appointmentReminders: true,
      },
    });
    const passed = result.ok || result.status === 404;
    ctx.recordTest('Update User Preferences (Admin)', passed);
    return passed;
  },

  async testDeleteUserPreferences(ctx) {
    const testUserId = ctx.patientId || ctx.userId;
    const result = await ctx.makeRequest('DELETE', `/notification-preferences/${testUserId}`);
    const passed = result.ok || result.status === 204 || result.status === 404;
    ctx.recordTest('Delete User Preferences (Admin)', passed);
    return passed;
  },
};

async function runClinicAdminNotificationPreferenceTests() {
  logSection('CLINIC_ADMIN Role Notification Preferences Tests');

  const ctx = new TestContext('CLINIC_ADMIN', TEST_USER);

  // Login
  if (!(await ctx.login())) {
    logSection('Login failed - aborting tests');
    process.exit(1);
  }

  // Load test IDs
  await ctx.loadTestIds();

  // Run tests
  for (const [testName, testFn] of Object.entries(clinicAdminNotificationPreferenceTests)) {
    try {
      await testFn(ctx);
      await wait(500);
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
runClinicAdminNotificationPreferenceTests().catch(error => {
  console.error('CLINIC_ADMIN notification preference tests failed:', error);
  process.exit(1);
});













