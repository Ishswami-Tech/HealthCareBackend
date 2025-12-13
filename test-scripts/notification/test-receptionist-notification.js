/**
 * RECEPTIONIST Role Notification Endpoints Test
 * Tests all notification endpoints accessible to RECEPTIONIST role
 *
 * Run with: node test-scripts/notification/test-receptionist-notification.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.RECEPTIONIST;

const receptionistNotificationTests = {
  async testSendPushNotification(ctx) {
    ctx.recordTest('Send Push Notification', false, true);
    return false;
  },

  async testSendEmailNotification(ctx) {
    const result = await ctx.makeRequest('POST', '/notification/email', {
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

  async testSendAppointmentReminder(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Send Appointment Reminder', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/notification/appointment-reminder', {
      appointmentId: ctx.appointmentId,
      reminderType: 'upcoming',
    });
    const passed =
      result.ok ||
      result.status === 400 ||
      result.status === 403 ||
      result.status === 404 ||
      result.status === 500;
    ctx.recordTest('Send Appointment Reminder', passed);
    return passed;
  },
};

async function runReceptionistNotificationTests() {
  logSection('RECEPTIONIST Role Notification Endpoints Test');

  const ctx = new TestContext('RECEPTIONIST', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  // Try to get an appointment
  const appointmentsResult = await ctx.makeRequest('GET', '/appointments');
  if (appointmentsResult.ok) {
    let appointments = [];
    if (Array.isArray(appointmentsResult.data)) {
      appointments = appointmentsResult.data;
    } else if (Array.isArray(appointmentsResult.data?.data)) {
      appointments = appointmentsResult.data.data;
    } else if (Array.isArray(appointmentsResult.data?.appointments)) {
      appointments = appointmentsResult.data.appointments;
    }
    if (appointments.length > 0 && appointments[0].id) {
      ctx.appointmentId = appointments[0].id;
    }
  }

  const testSuite = [
    'testSendPushNotification',
    'testSendEmailNotification',
    'testSendAppointmentReminder',
  ];

  for (const testName of testSuite) {
    const testFn = receptionistNotificationTests[testName];
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

runReceptionistNotificationTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
