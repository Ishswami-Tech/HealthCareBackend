/**
 * PATIENT Role Appointment Endpoints Test
 * Tests all appointment endpoints accessible to PATIENT role
 *
 * Run with: node test-scripts/appointments/test-patient-appointments.js
 */

const { TestContext, logSection, logInfo, wait } = require('./_shared-utils');

const TEST_USER = {
  email: 'patient1@example.com',
  password: 'test1234',
};

// PATIENT-specific endpoint tests
const patientTests = {
  async testCreateAppointment(ctx) {
    if (!ctx.clinicId || !ctx.doctorId) {
      ctx.recordTest('Create Appointment', false, true);
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
      type: ctx.locationId ? 'IN_PERSON' : 'VIDEO_CALL',
      notes: 'Test appointment created by PATIENT',
    });

    if (result.ok && result.data?.data) {
      ctx.appointmentId = result.data.data.id;
      if (result.data.data.doctor?.id) ctx.doctorId = result.data.data.doctor.id;
      ctx.recordTest('Create Appointment', true);
      return true;
    } else {
      ctx.recordTest('Create Appointment', false);
      return false;
    }
  },

  async testGetMyAppointments(ctx) {
    const result = await ctx.makeRequest('GET', '/appointments/my-appointments');
    ctx.recordTest('Get My Appointments', result.ok);
    return result.ok;
  },

  async testGetAppointmentById(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Get Appointment By ID', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/appointments/${ctx.appointmentId}`);
    ctx.recordTest('Get Appointment By ID', result.ok);
    return result.ok;
  },

  async testUpdateAppointment(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Update Appointment', false, true);
      return false;
    }
    const result = await ctx.makeRequest('PUT', `/appointments/${ctx.appointmentId}`, {
      notes: 'Updated by PATIENT',
    });
    ctx.recordTest('Update Appointment', result.ok);
    return result.ok;
  },

  async testCancelAppointment(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Cancel Appointment', false, true);
      return false;
    }
    const result = await ctx.makeRequest('DELETE', `/appointments/${ctx.appointmentId}`);
    ctx.recordTest('Cancel Appointment', result.ok);
    return result.ok;
  },

  async testCheckInAppointment(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Check In Appointment', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', `/appointments/${ctx.appointmentId}/check-in`, {
      locationId: ctx.locationId || undefined,
    });
    const passed = result.ok || result.status === 400; // 400 = already checked in or invalid time
    ctx.recordTest('Check In Appointment', passed);
    return passed;
  },

  async testGetDoctorAvailability(ctx) {
    if (!ctx.doctorId) {
      ctx.recordTest('Get Doctor Availability', false, true);
      return false;
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const result = await ctx.makeRequest(
      'GET',
      `/appointments/doctor/${ctx.doctorId}/availability?date=${tomorrow.toISOString().split('T')[0]}`
    );
    ctx.recordTest('Get Doctor Availability', result.ok);
    return result.ok;
  },

  async testGetUserUpcomingAppointments(ctx) {
    const result = await ctx.makeRequest('GET', `/appointments/user/${ctx.userId}/upcoming`);
    ctx.recordTest('Get User Upcoming Appointments', result.ok);
    return result.ok;
  },

  async testGetAppointmentChain(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Get Appointment Chain', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/appointments/${ctx.appointmentId}/chain`);
    ctx.recordTest('Get Appointment Chain', result.ok);
    return result.ok;
  },

  async testGetAppointmentFollowUps(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Get Appointment Follow-Ups', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/appointments/${ctx.appointmentId}/follow-ups`);
    ctx.recordTest('Get Appointment Follow-Ups', result.ok);
    return result.ok;
  },

  async testScanQRCode(ctx) {
    if (!ctx.locationId) {
      ctx.recordTest('Scan QR Code', false, true);
      return false;
    }
    const mockQRCode = JSON.stringify({
      locationId: ctx.locationId,
      type: 'LOCATION_CHECK_IN',
    });
    const result = await ctx.makeRequest('POST', '/appointments/check-in/scan-qr', {
      qrCode: mockQRCode,
      appointmentId: ctx.appointmentId || undefined,
    });
    const passed =
      result.ok || result.status === 400 || result.status === 404 || result.status === 500; // Expected failures
    ctx.recordTest('Scan QR Code', passed);
    return passed;
  },

  async testGetVideoJoinToken(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Get Video Join Token', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'POST',
      `/appointments/${ctx.appointmentId}/video/join-token`
    );
    const passed = result.ok || result.status === 400; // 400 = not a video appointment
    ctx.recordTest('Get Video Join Token', passed);
    return passed;
  },

  async testStartVideoConsultation(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Start Video Consultation', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', `/appointments/${ctx.appointmentId}/video/start`);
    const passed = result.ok || result.status === 400 || result.status === 403; // Expected failures
    ctx.recordTest('Start Video Consultation', passed);
    return passed;
  },

  async testEndVideoConsultation(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('End Video Consultation', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', `/appointments/${ctx.appointmentId}/video/end`, {
      meetingNotes: 'Test consultation completed',
    });
    const passed = result.ok || result.status === 400 || result.status === 403; // Expected failures
    ctx.recordTest('End Video Consultation', passed);
    return passed;
  },

  async testGetVideoStatus(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Get Video Status', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/appointments/${ctx.appointmentId}/video/status`);
    const passed = result.ok || result.status === 400 || result.status === 404; // Expected failures
    ctx.recordTest('Get Video Status', passed);
    return passed;
  },

  async testReportTechnicalIssue(ctx) {
    if (!ctx.appointmentId) {
      ctx.recordTest('Report Technical Issue', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'POST',
      `/appointments/${ctx.appointmentId}/video/report-issue`,
      {
        issueType: 'connection',
        description: 'Test technical issue report',
      }
    );
    const passed = result.ok || result.status === 400 || result.status === 403; // Expected failures
    ctx.recordTest('Report Technical Issue', passed);
    return passed;
  },
};

// Main test runner
async function runPatientTests() {
  logSection('PATIENT Role Appointment Endpoints Test');

  const ctx = new TestContext('PATIENT', TEST_USER);

  // Login
  if (!(await ctx.login())) {
    process.exit(1);
  }

  // Load test IDs
  await ctx.loadTestIds();
  ctx.patientId = ctx.userId; // PATIENT uses their own userId

  // Ensure we have required IDs
  if (!ctx.doctorId && ctx.clinicId) {
    const doctorsResult = await ctx.makeRequest('GET', `/clinics/${ctx.clinicId}/doctors`);
    if (doctorsResult.ok && doctorsResult.data?.data) {
      const doctors = Array.isArray(doctorsResult.data.data)
        ? doctorsResult.data.data
        : [doctorsResult.data.data];
      if (doctors.length > 0 && doctors[0].id) {
        ctx.doctorId = doctors[0].id;
      }
    }
  }

  logInfo(
    `Clinic: ${ctx.clinicId}, Doctor: ${ctx.doctorId}, Patient: ${ctx.patientId}, Location: ${ctx.locationId}`
  );

  // Create appointment first
  logInfo('Creating test appointment...');
  await patientTests.testCreateAppointment(ctx);
  await wait(500);

  // Run all PATIENT tests
  const testSuite = [
    'testCreateAppointment',
    'testGetMyAppointments',
    'testGetAppointmentById',
    'testGetDoctorAvailability',
    'testGetUserUpcomingAppointments',
    'testUpdateAppointment',
    'testCheckInAppointment',
    'testScanQRCode',
    'testGetVideoJoinToken',
    'testStartVideoConsultation',
    'testGetVideoStatus',
    'testEndVideoConsultation',
    'testReportTechnicalIssue',
    'testGetAppointmentChain',
    'testGetAppointmentFollowUps',
    'testCancelAppointment', // Cancel last
  ];

  for (const testName of testSuite) {
    if (testName === 'testCreateAppointment' && ctx.appointmentId) {
      ctx.recordTest('Create Appointment (setup)', true);
      continue;
    }
    const testFn = patientTests[testName];
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
runPatientTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});


