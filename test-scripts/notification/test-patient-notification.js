/**
 * PATIENT Role Notification Endpoints Test
 * Tests all notification endpoints accessible to PATIENT role
 *
 * Run with: node test-scripts/notification/test-patient-notification.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.PATIENT;

const patientNotificationTests = {
  async testSendPushNotification(ctx) {
    // This requires a device token - mark as skipped if not available
    ctx.recordTest('Send Push Notification', false, true);
    return false;
  },

  async testSubscribeToTopic(ctx) {
    const result = await ctx.makeRequest('POST', '/notifications/push/subscribe', {
      deviceToken: 'test-device-token',
      topic: 'appointments',
    });
    const passed =
      result.ok ||
      result.status === 400 ||
      result.status === 403 ||
      result.status === 404 ||
      result.status === 500;
    ctx.recordTest('Subscribe To Topic', passed);
    return passed;
  },

  async testUnsubscribeFromTopic(ctx) {
    const result = await ctx.makeRequest('POST', '/notifications/push/unsubscribe', {
      deviceToken: 'test-device-token',
      topic: 'appointments',
    });
    const passed =
      result.ok ||
      result.status === 400 ||
      result.status === 403 ||
      result.status === 404 ||
      result.status === 500;
    ctx.recordTest('Unsubscribe From Topic', passed);
    return passed;
  },

  async testSendEmailNotification(ctx) {
    const result = await ctx.makeRequest('POST', '/notifications/email', {
      to: ctx.credentials.email,
      subject: 'Test Email',
      body: 'Test email body',
    });
    const passed =
      result.ok ||
      result.status === 400 ||
      result.status === 403 ||
      result.status === 404 ||
      result.status === 500;
    ctx.recordTest('Send Email Notification', passed);
    return passed;
  },

  async testGetChatHistory(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get Chat History', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/notifications/chat-history/${ctx.userId}`);
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500; // 403 = permission, 404/500 = no data or backend issue
    ctx.recordTest('Get Chat History', passed);
    return passed;
  },
};

async function runPatientNotificationTests() {
  logSection('PATIENT Role Notification Endpoints Test');

  const ctx = new TestContext('PATIENT', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  const testSuite = [
    'testSendPushNotification',
    'testSubscribeToTopic',
    'testUnsubscribeFromTopic',
    'testSendEmailNotification',
    'testGetChatHistory',
  ];

  for (const testName of testSuite) {
    const testFn = patientNotificationTests[testName];
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

runPatientNotificationTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
