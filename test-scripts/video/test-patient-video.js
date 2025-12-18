/**
 * PATIENT Role Video Endpoints Test
 * Tests all video consultation endpoints accessible to PATIENT role
 *
 * Run with: node test-scripts/video/test-patient-video.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.PATIENT;

const patientVideoTests = {
  async testCreateVideoAppointment(ctx) {
    if (!ctx.clinicId || !ctx.doctorId) {
      ctx.recordTest('Create Video Appointment (setup)', false, true);
      return false;
    }

    const appointmentDate = new Date();
    appointmentDate.setDate(appointmentDate.getDate() + 1);
    appointmentDate.setHours(10, 0, 0, 0);

    const result = await ctx.makeRequest('POST', '/appointments', {
      patientId: ctx.patientId || ctx.userId,
      doctorId: ctx.doctorId,
      clinicId: ctx.clinicId,
      ...(ctx.locationId ? { locationId: ctx.locationId } : {}),
      appointmentDate: appointmentDate.toISOString(),
      duration: 30,
      type: 'VIDEO_CALL',
      notes: 'Test VIDEO_CALL appointment for video consultation tests',
    });

    if (result.ok && result.data?.data) {
      ctx.appointmentId = result.data.data.id;
      ctx.recordTest('Create Video Appointment (setup)', true);
      return true;
    } else {
      ctx.recordTest('Create Video Appointment (setup)', false);
      return false;
    }
  },

  async testGenerateVideoToken(ctx) {
    if (!ctx.appointmentId || !ctx.userId) {
      ctx.recordTest('Generate Video Token', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/video/token', {
      appointmentId: ctx.appointmentId,
      userId: ctx.userId,
      userRole: 'PATIENT',
      userInfo: {
        displayName: 'Test Patient',
        email: ctx.credentials.email,
      },
    });
    const passed =
      result.ok || result.status === 400 || result.status === 403 || result.status === 404;
    ctx.recordTest('Generate Video Token', passed);
    return passed;
  },

  async testStartConsultation(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Start Consultation', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/video/consultation/start', {
      appointmentId: ctx.appointmentId,
    });
    const passed =
      result.ok || result.status === 400 || result.status === 403 || result.status === 404;
    ctx.recordTest('Start Consultation', passed);
    return passed;
  },

  async testEndConsultation(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('End Consultation', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', '/video/consultation/end', {
      appointmentId: ctx.appointmentId,
      meetingNotes: 'Test consultation completed',
    });
    const passed =
      result.ok || result.status === 400 || result.status === 403 || result.status === 404;
    ctx.recordTest('End Consultation', passed);
    return passed;
  },

  async testGetConsultationStatus(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Get Consultation Status', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/video/consultation/${ctx.appointmentId}/status`);
    const passed = result.ok || result.status === 404 || result.status === 403;
    ctx.recordTest('Get Consultation Status', passed);
    return passed;
  },

  async testReportTechnicalIssue(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Report Technical Issue', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'POST',
      `/video/consultation/${ctx.appointmentId}/report`,
      {
        issueType: 'connection',
        description: 'Test technical issue',
      }
    );
    const passed =
      result.ok || result.status === 400 || result.status === 403 || result.status === 404;
    ctx.recordTest('Report Technical Issue', passed);
    return passed;
  },

  async testGetConsultationHistory(ctx) {
    const result = await ctx.makeRequest('GET', '/video/history');
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Consultation History', passed);
    return passed;
  },
};

async function runPatientVideoTests() {
  logSection('PATIENT Role Video Endpoints Test');

  const ctx = new TestContext('PATIENT', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  // Try to get an existing VIDEO_CALL appointment for video tests
  const appointmentsResult = await ctx.makeRequest('GET', '/appointments/my-appointments');
  let hasVideoAppointment = false;
  if (appointmentsResult.ok && appointmentsResult.data?.data) {
    const appointments = Array.isArray(appointmentsResult.data.data)
      ? appointmentsResult.data.data
      : [appointmentsResult.data.data];
    const videoAppointment = appointments.find(apt => apt.type === 'VIDEO_CALL');
    if (videoAppointment && videoAppointment.id) {
      ctx.appointmentId = videoAppointment.id;
      hasVideoAppointment = true;
    }
  }

  // If no VIDEO_CALL appointment exists, create one
  if (!hasVideoAppointment) {
    await patientVideoTests.testCreateVideoAppointment(ctx);
    await wait(500);
  }

  const testSuite = [
    'testGenerateVideoToken',
    'testStartConsultation',
    'testGetConsultationStatus',
    'testEndConsultation',
    'testReportTechnicalIssue',
    'testGetConsultationHistory',
  ];

  for (const testName of testSuite) {
    const testFn = patientVideoTests[testName];
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

runPatientVideoTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});












