/**
 * E2E tests for appointments workflow.
 *
 * Tests the complete appointment lifecycle:
 * - Create appointment
 * - Get appointment details
 * - List/filter appointments
 * - Update appointment
 * - Cancel appointment
 * - Reschedule appointment
 * - Check-in flow
 * - Complete appointment
 * - My appointments (patient view)
 * - Upcoming appointments
 * - QR code generation and verification
 * - No-show detection
 * - Follow-up plans
 * - Recurring series
 * - Authorization and clinic isolation
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '@app.module';

// Requires TEST_DATABASE_URL or DATABASE_URL configured.
// Run with: TEST_DATABASE_URL=postgresql://... jest --config jest.config.ts#e2e

describe('Appointments E2E', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let adminToken: string;
  let doctorToken: string;
  let patientToken: string;
  let createdAppointmentId: string;
  let testClinicId: string;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
      console.log('Skipping appointments E2E tests - no database configured');
      return;
    }

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 120000);

  afterAll(async () => {
    if (app) await app.close();
    if (moduleRef) await moduleRef.close();
  });

  beforeEach(async () => {
    if (!app || !moduleRef) return;
    createdAppointmentId = '';
    testClinicId = 'test-clinic';

    // Create admin
    const adminEmail = `admin-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: adminEmail,
        password: 'AdminPass123!',
        firstName: 'Admin',
        lastName: 'User',
        clinicId: testClinicId,
        role: 'CLINIC_ADMIN',
      });

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'AdminPass123!' });
    adminToken = adminLogin.body.accessToken;

    // Create doctor
    const doctorEmail = `doctor-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/user')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: doctorEmail,
        password: 'DoctorPass123!',
        firstName: 'Dr',
        lastName: 'Test',
        role: 'DOCTOR',
        clinicId: testClinicId,
      });

    const doctorLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: doctorEmail, password: 'DoctorPass123!' });
    doctorToken = doctorLogin.body.accessToken;

    // Create patient
    const patientEmail = `patient-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: patientEmail,
        password: 'PatientPass123!',
        firstName: 'Test',
        lastName: 'Patient',
        clinicId: testClinicId,
        role: 'PATIENT',
      });

    const patientLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: patientEmail, password: 'PatientPass123!' });
    patientToken = patientLogin.body.accessToken;
  });

  afterEach(async () => {
    if (moduleRef && createdAppointmentId) {
      try {
        const prisma = moduleRef.get('PRISMA_SERVICE_TOKEN');
        await prisma.appointment.delete({ where: { id: createdAppointmentId } }).catch(() => {});
      } catch {
        // ignore cleanup errors
      }
    }
  });

  // =============================================
  // CREATE APPOINTMENT
  // =============================================
  describe('POST /appointments', () => {
    it('should create a new appointment', async () => {
      if (!app) return;

      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 24);

      const response = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid-here',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: futureTime.toISOString(),
          endTime: new Date(futureTime.getTime() + 3600000).toISOString(),
          reason: 'Regular checkup',
        })
        .expect(201);

      expect(response.body).toBeDefined();
      if (response.body.id) {
        createdAppointmentId = response.body.id;
      }
    });

    it('should reject without authentication', async () => {
      if (!app) return;

      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 24);

      await request(app.getHttpServer())
        .post('/appointments')
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: futureTime.toISOString(),
          endTime: new Date(futureTime.getTime() + 3600000).toISOString(),
        })
        .expect(401);
    });

    it('should reject past appointment times', async () => {
      if (!app) return;

      const pastTime = new Date();
      pastTime.setHours(pastTime.getHours() - 1);

      const response = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: pastTime.toISOString(),
          endTime: new Date(pastTime.getTime() + 3600000).toISOString(),
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });
  });

  // =============================================
  // GET APPOINTMENT BY ID
  // =============================================
  describe('GET /appointments/:id', () => {
    it('should return appointment details', async () => {
      if (!app) return;

      // Create appointment first
      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 24);
      const createResponse = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: futureTime.toISOString(),
          endTime: new Date(futureTime.getTime() + 3600000).toISOString(),
        });

      const appointmentId = createResponse.body.id;
      if (!appointmentId) return;
      createdAppointmentId = appointmentId;

      const response = await request(app.getHttpServer())
        .get(`/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(response.body.id).toBe(appointmentId);
    });

    it('should return 404 for non-existent appointment', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/appointments/nonexistent-id')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(404);

      expect(response.body.message).toBeDefined();
    });
  });

  // =============================================
  // LIST APPOINTMENTS
  // =============================================
  describe('GET /appointments', () => {
    it('should return appointments with pagination', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/appointments')
        .query({ clinicId: testClinicId, page: 1, limit: 10 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should filter by status', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/appointments')
        .query({ clinicId: testClinicId, status: 'SCHEDULED' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // =============================================
  // MY APPOINTMENTS
  // =============================================
  describe('GET /appointments/my-appointments', () => {
    it('should return current user appointments', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/appointments/my-appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should reject without authentication', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .get('/appointments/my-appointments')
        .expect(401);
    });
  });

  // =============================================
  // UPCOMING APPOINTMENTS
  // =============================================
  describe('GET /appointments/upcoming', () => {
    it('should return upcoming appointments', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/appointments/upcoming')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // =============================================
  // UPDATE APPOINTMENT
  // =============================================
  describe('PUT /appointments/:id', () => {
    it('should update appointment details', async () => {
      if (!app) return;

      // Create appointment first
      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 24);
      const createResponse = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: futureTime.toISOString(),
          endTime: new Date(futureTime.getTime() + 3600000).toISOString(),
          reason: 'Original reason',
        });

      const appointmentId = createResponse.body.id;
      if (!appointmentId) return;
      createdAppointmentId = appointmentId;

      const response = await request(app.getHttpServer())
        .put(`/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          reason: 'Updated reason',
        })
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  // =============================================
  // CANCEL APPOINTMENT
  // =============================================
  describe('DELETE /appointments/:id', () => {
    it('should cancel an appointment', async () => {
      if (!app) return;

      // Create appointment first
      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 24);
      const createResponse = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: futureTime.toISOString(),
          endTime: new Date(futureTime.getTime() + 3600000).toISOString(),
        });

      const appointmentId = createResponse.body.id;
      if (!appointmentId) return;
      createdAppointmentId = appointmentId;

      const response = await request(app.getHttpServer())
        .delete(`/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ reason: 'Cannot make it' })
        .expect(200);

      expect(response.body.message || response.body.status).toBeDefined();
    });

    it('should reject cancelling non-existent appointment', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .delete('/appointments/nonexistent-id')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ reason: 'Test' })
        .expect(404);
    });
  });

  // =============================================
  // RESCHEDULE APPOINTMENT
  // =============================================
  describe('PATCH /appointments/:id/reschedule', () => {
    it('should reschedule an appointment', async () => {
      if (!app) return;

      // Create appointment first
      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 24);
      const createResponse = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: futureTime.toISOString(),
          endTime: new Date(futureTime.getTime() + 3600000).toISOString(),
        });

      const appointmentId = createResponse.body.id;
      if (!appointmentId) return;
      createdAppointmentId = appointmentId;

      const newStart = new Date(futureTime.getTime() + 86400000); // +1 day
      const response = await request(app.getHttpServer())
        .patch(`/appointments/${appointmentId}/reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          startTime: newStart.toISOString(),
          endTime: new Date(newStart.getTime() + 3600000).toISOString(),
        })
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  // =============================================
  // CHECK-IN
  // =============================================
  describe('POST /appointments/:id/check-in', () => {
    it('should check in for an appointment', async () => {
      if (!app) return;

      // Create appointment first
      const now = new Date();
      const createResponse = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: now.toISOString(),
          endTime: new Date(now.getTime() + 3600000).toISOString(),
        });

      const appointmentId = createResponse.body.id;
      if (!appointmentId) return;
      createdAppointmentId = appointmentId;

      const response = await request(app.getHttpServer())
        .post(`/appointments/${appointmentId}/check-in`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(response.body.checkedIn || response.body.checkInTime || response.body.message).toBeDefined();
    });
  });

  // =============================================
  // COMPLETE APPOINTMENT
  // =============================================
  describe('POST /appointments/:id/complete', () => {
    it('should complete an appointment (doctor only)', async () => {
      if (!app) return;

      // Create appointment first
      const now = new Date();
      const createResponse = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: now.toISOString(),
          endTime: new Date(now.getTime() + 3600000).toISOString(),
        });

      const appointmentId = createResponse.body.id;
      if (!appointmentId) return;
      createdAppointmentId = appointmentId;

      const response = await request(app.getHttpServer())
        .post(`/appointments/${appointmentId}/complete`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ notes: 'Consultation complete' })
        .expect(200);

      expect(response.body.status || response.body.message).toBeDefined();
    });
  });

  // =============================================
  // QR CODE
  // =============================================
  describe('GET /appointments/:id/qr', () => {
    it('should generate QR code for appointment', async () => {
      if (!app) return;

      // Create appointment first
      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 24);
      const createResponse = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: futureTime.toISOString(),
          endTime: new Date(futureTime.getTime() + 3600000).toISOString(),
        });

      const appointmentId = createResponse.body.id;
      if (!appointmentId) return;
      createdAppointmentId = appointmentId;

      const response = await request(app.getHttpServer())
        .get(`/appointments/${appointmentId}/qr`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(response.body.qrCode || response.body.qrData || response.body).toBeDefined();
    });
  });

  // =============================================
  // FOLLOW-UP PLANS
  // =============================================
  describe('POST /appointments/:id/follow-up', () => {
    it('should create a follow-up plan for an appointment', async () => {
      if (!app) return;

      // Create appointment first
      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 24);
      const createResponse = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: futureTime.toISOString(),
          endTime: new Date(futureTime.getTime() + 3600000).toISOString(),
        });

      const appointmentId = createResponse.body.id;
      if (!appointmentId) return;
      createdAppointmentId = appointmentId;

      const response = await request(app.getHttpServer())
        .post(`/appointments/${appointmentId}/follow-up`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          intervalDays: 30,
          durationMonths: 3,
          notes: 'Monthly follow-up',
        })
        .expect(201);

      expect(response.body).toBeDefined();
    });
  });

  // =============================================
  // RECURRING SERIES
  // =============================================
  describe('POST /appointments/recurring', () => {
    it('should create a recurring appointment series', async () => {
      if (!app) return;

      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 24);
      const futureEnd = new Date(futureTime.getTime() + 3600000);

      const response = await request(app.getHttpServer())
        .post('/appointments/recurring')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: futureTime.toISOString(),
          endTime: futureEnd.toISOString(),
          recurrencePattern: 'WEEKLY',
          occurrences: 4,
        })
        .expect(201);

      expect(response.body).toBeDefined();
    });
  });

  // =============================================
  // VIDEO APPOINTMENTS
  // =============================================
  describe('POST /appointments/video/propose', () => {
    it('should propose a video appointment', async () => {
      if (!app) return;

      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 24);

      const response = await request(app.getHttpServer())
        .post('/appointments/video/propose')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          proposedSlots: [
            {
              startTime: futureTime.toISOString(),
              endTime: new Date(futureTime.getTime() + 1800000).toISOString(),
            },
          ],
        })
        .expect(201);

      expect(response.body).toBeDefined();
    });
  });

  // =============================================
  // AUTHORIZATION
  // =============================================
  describe('Authorization', () => {
    it('should prevent patient from completing another patient appointment', async () => {
      if (!app) return;

      // Create a second patient
      const otherPatientEmail = `other-${Date.now()}@example.com`;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: otherPatientEmail,
          password: 'OtherPass123!',
          firstName: 'Other',
          lastName: 'Patient',
          clinicId: testClinicId,
          role: 'PATIENT',
        });

      const otherLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: otherPatientEmail, password: 'OtherPass123!' });
      const otherPatientToken = otherLogin.body.accessToken;

      // Create appointment for first patient
      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 24);
      const createResponse = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorUserId: 'doctor-uuid',
          clinicId: testClinicId,
          appointmentType: 'IN_PERSON',
          startTime: futureTime.toISOString(),
          endTime: new Date(futureTime.getTime() + 3600000).toISOString(),
        });

      const appointmentId = createResponse.body.id;
      if (appointmentId) {
        createdAppointmentId = appointmentId;
      }

      // Try to complete as other patient
      await request(app.getHttpServer())
        .post(`/appointments/${appointmentId}/complete`)
        .set('Authorization', `Bearer ${otherPatientToken}`)
        .expect(403);
    });

    it('should reject unauthenticated requests', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .get('/appointments/my-appointments')
        .expect(401);

      await request(app.getHttpServer())
        .post('/appointments')
        .send({ doctorUserId: 'x', clinicId: testClinicId })
        .expect(401);
    });
  });

  // =============================================
  // CLINIC ISOLATION
  // =============================================
  describe('Clinic isolation', () => {
    it('should only return appointments for the user clinic', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/appointments')
        .query({ clinicId: testClinicId })
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // =============================================
  // NO-SHOW DETECTION
  // =============================================
  describe('POST /appointments/noshow/check', () => {
    it('should trigger no-show check (admin)', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .post('/appointments/noshow/check')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.message || response.body.processed).toBeDefined();
    });

    it('should reject no-show check for non-admin', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .post('/appointments/noshow/check')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(403);
    });
  });
});
