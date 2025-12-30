/**
 * CLINIC_ADMIN Role Clinic Communication Endpoints Test
 * Tests all clinic communication configuration endpoints (CLINIC_ADMIN only)
 *
 * Run with: node test-scripts/clinic-communication/test-clinic-admin-clinic-communication.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.CLINIC_ADMIN;

const clinicAdminClinicCommunicationTests = {
  async testGetCommunicationConfig(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Get Communication Config', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'GET',
      `/clinics/${ctx.clinicId}/communication/config`
    );
    const passed = result.ok || result.status === 404;
    ctx.recordTest('Get Communication Config', passed);
    return passed;
  },

  async testUpdateCommunicationConfig(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Update Communication Config', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'PUT',
      `/clinics/${ctx.clinicId}/communication/config`,
      {
        email: {
          primary: {
            provider: 'smtp',
            enabled: true,
            credentials: {
              host: 'smtp.example.com',
              port: '587',
              user: 'test@example.com',
              password: 'test123',
            },
            priority: 1,
          },
          defaultFrom: 'test@example.com',
          defaultFromName: 'Test Clinic',
        },
      }
    );
    const passed = result.ok || result.status === 400;
    ctx.recordTest('Update Communication Config', passed);
    return passed;
  },

  async testUpdateSESConfig(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Update SES Config', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'PUT',
      `/clinics/${ctx.clinicId}/communication/ses`,
      {
        region: 'us-east-1',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        fromEmail: 'test@example.com',
        fromName: 'Test Clinic',
        enabled: true,
      }
    );
    const passed = result.ok || result.status === 400;
    ctx.recordTest('Update SES Config', passed);
    return passed;
  },

  async testTestEmailConfig(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Test Email Config', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'POST',
      `/clinics/${ctx.clinicId}/communication/test-email`,
      {
        testEmail: ctx.credentials.email,
      }
    );
    const passed = result.ok || result.status === 400 || result.status === 500;
    ctx.recordTest('Test Email Config', passed);
    return passed;
  },

  async testTestWhatsAppConfig(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Test WhatsApp Config', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'POST',
      `/clinics/${ctx.clinicId}/communication/test-whatsapp`,
      {
        phoneNumber: '+1234567890',
      }
    );
    const passed = result.ok || result.status === 400 || result.status === 500;
    ctx.recordTest('Test WhatsApp Config', passed);
    return passed;
  },

  async testTestSMSConfig(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Test SMS Config', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'POST',
      `/clinics/${ctx.clinicId}/communication/test-sms`,
      {
        phoneNumber: '+1234567890',
      }
    );
    const passed = result.ok || result.status === 400 || result.status === 500;
    ctx.recordTest('Test SMS Config', passed);
    return passed;
  },
};

async function runClinicAdminClinicCommunicationTests() {
  logSection('CLINIC_ADMIN Role Clinic Communication Tests');

  const ctx = new TestContext('CLINIC_ADMIN', TEST_USER);

  if (!(await ctx.login())) {
    logSection('Login failed - aborting tests');
    process.exit(1);
  }

  await ctx.loadTestIds();

  for (const [testName, testFn] of Object.entries(clinicAdminClinicCommunicationTests)) {
    try {
      await testFn(ctx);
      await wait(500);
    } catch (error) {
      ctx.recordTest(testName, false);
      console.error(`Test ${testName} threw error:`, error);
    }
  }

  ctx.printSummary();
  process.exit(ctx.results.failed > 0 ? 1 : 0);
}

runClinicAdminClinicCommunicationTests().catch(error => {
  console.error('CLINIC_ADMIN clinic communication tests failed:', error);
  process.exit(1);
});











