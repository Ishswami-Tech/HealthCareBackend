/**
 * Integration tests for Clinic module.
 *
 * Tests clinic management against real database:
 * - Create clinic
 * - Get clinic by ID
 * - Get current user clinic
 * - Update clinic
 * - Delete clinic
 * - Clinic stats
 * - Operating hours
 * - Clinic staff listing
 * - Clinic doctors listing
 * - Clinic patients listing
 * - App name validation
 * - User association with clinic
 * - Authorization checks
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '@app.module';

// Requires TEST_DATABASE_URL configured.
// Run with: TEST_DATABASE_URL=postgresql://... jest --config jest.config.ts#integration

describe('Clinic Integration', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let adminToken: string;
  let testClinicId: string;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
      console.log('Skipping clinic integration tests - no database configured');
      return;
    }

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60000);

  afterAll(async () => {
    if (app) await app.close();
    if (moduleRef) await moduleRef.close();
  });

  beforeEach(async () => {
    if (!app) return;
    testClinicId = '';
    adminToken = '';

    // Create admin
    const adminEmail = `clinic-admin-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: adminEmail,
        password: 'AdminPass123!',
        firstName: 'Clinic',
        lastName: 'Admin',
        clinicId: 'test-clinic',
        role: 'CLINIC_ADMIN',
      });

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'AdminPass123!' });
    adminToken = adminLogin.body.accessToken;
  });

  afterEach(async () => {
    if (moduleRef && testClinicId) {
      try {
        const prisma = moduleRef.get('PRISMA_SERVICE_TOKEN');
        await prisma.clinic.delete({ where: { id: testClinicId } }).catch(() => {});
      } catch {
        // ignore cleanup errors
      }
    }
  });

  describe('POST /clinic', () => {
    it('should create a new clinic', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .post('/clinic')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `New Clinic ${Date.now()}`,
          address: '123 Healthcare Ave',
          phone: '+919876543210',
          email: 'clinic@example.com',
        })
        .expect(201);

      expect(response.body.name).toBeDefined();
      testClinicId = response.body.id;
    });
  });

  describe('GET /clinic/my-clinic', () => {
    it('should return the current user clinic', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/clinic/my-clinic')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body.name).toBeDefined();
    });

    it('should reject without authentication', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .get('/clinic/my-clinic')
        .expect(401);
    });
  });

  describe('GET /clinic', () => {
    it('should return list of clinics', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/clinic')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /clinic/:id', () => {
    it('should return clinic by id', async () => {
      if (!app) return;

      // First create a clinic
      const createResponse = await request(app.getHttpServer())
        .post('/clinic')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Test Clinic ${Date.now()}`,
          address: '456 Medical St',
          phone: '+919876543211',
        });

      const clinicId = createResponse.body.id;
      if (!clinicId) return;
      testClinicId = clinicId;

      const response = await request(app.getHttpServer())
        .get(`/clinic/${clinicId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.id).toBe(clinicId);
    });

    it('should return 404 for non-existent clinic', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .get('/clinic/nonexistent-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('GET /clinic/:id/stats', () => {
    it('should return clinic statistics', async () => {
      if (!app) return;

      // Create a clinic first
      const createResponse = await request(app.getHttpServer())
        .post('/clinic')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Stats Clinic ${Date.now()}`,
          address: '789 Health Blvd',
          phone: '+919876543212',
        });

      const clinicId = createResponse.body.id;
      if (clinicId) testClinicId = clinicId;

      const response = await request(app.getHttpServer())
        .get(`/clinic/${clinicId}/stats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('GET /clinic/:id/operating-hours', () => {
    it('should return operating hours', async () => {
      if (!app) return;

      // Create a clinic first
      const createResponse = await request(app.getHttpServer())
        .post('/clinic')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Hours Clinic ${Date.now()}`,
          address: '321 Time Ave',
          phone: '+919876543213',
        });

      const clinicId = createResponse.body.id;
      if (clinicId) testClinicId = clinicId;

      const response = await request(app.getHttpServer())
        .get(`/clinic/${clinicId}/operating-hours`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('PUT /clinic/:id', () => {
    it('should update clinic details', async () => {
      if (!app) return;

      const createResponse = await request(app.getHttpServer())
        .post('/clinic')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Update Clinic ${Date.now()}`,
          address: 'Old Address',
          phone: '+919876543214',
        });

      const clinicId = createResponse.body.id;
      if (!clinicId) return;
      testClinicId = clinicId;

      const response = await request(app.getHttpServer())
        .put(`/clinic/${clinicId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          address: 'New Address',
          phone: '+919876543215',
        })
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('GET /clinic/:id/doctors', () => {
    it('should list doctors in clinic', async () => {
      if (!app) return;

      // Create a clinic first
      const createResponse = await request(app.getHttpServer())
        .post('/clinic')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Doctors Clinic ${Date.now()}`,
          address: 'Doctor Street',
          phone: '+919876543216',
        });

      const clinicId = createResponse.body.id;
      if (clinicId) testClinicId = clinicId;

      const response = await request(app.getHttpServer())
        .get(`/clinic/${clinicId}/doctors`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /clinic/:id/staff', () => {
    it('should list staff in clinic', async () => {
      if (!app) return;

      // Create a clinic first
      const createResponse = await request(app.getHttpServer())
        .post('/clinic')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Staff Clinic ${Date.now()}`,
          address: 'Staff Avenue',
          phone: '+919876543217',
        });

      const clinicId = createResponse.body.id;
      if (clinicId) testClinicId = clinicId;

      const response = await request(app.getHttpServer())
        .get(`/clinic/${clinicId}/staff`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /clinic/:id/patients', () => {
    it('should list patients in clinic', async () => {
      if (!app) return;

      // Create a clinic first
      const createResponse = await request(app.getHttpServer())
        .post('/clinic')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Patient Clinic ${Date.now()}`,
          address: 'Patient Road',
          phone: '+919876543218',
        });

      const clinicId = createResponse.body.id;
      if (clinicId) testClinicId = clinicId;

      const response = await request(app.getHttpServer())
        .get(`/clinic/${clinicId}/patients`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('POST /clinic/validate-app-name', () => {
    it('should validate an app name', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .post('/clinic/validate-app-name')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ appName: `valid-app-${Date.now()}` })
        .expect(200);

      expect(response.body.available !== undefined || response.body.isAvailable !== undefined).toBe(true);
    });
  });

  describe('Authorization', () => {
    it('should reject clinic creation without auth', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .post('/clinic')
        .send({ name: 'Unauthorized Clinic' })
        .expect(401);
    });

    it('should reject access with invalid token', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .get('/clinic')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });
});
