/**
 * E2E tests for the complete users flow.
 *
 * Tests user CRUD operations against the real NestJS application.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '@app.module';
import { Role } from '@core/types/enums.types';

// Requires TEST_DATABASE_URL or DATABASE_URL configured.
// Run with: TEST_DATABASE_URL=postgresql://... jest --config jest.config.ts#e2e

describe('Users E2E', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let adminToken: string;
  let createdUserId: string;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
      console.log('Skipping Users E2E tests - no database configured');
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
    // Create admin for each test
    if (!app || !moduleRef) return;

    const adminEmail = `admin-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: adminEmail,
        password: 'AdminPass123!',
        firstName: 'Admin',
        lastName: 'User',
        clinicId: 'test-clinic',
        role: 'CLINIC_ADMIN',
      });

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'AdminPass123!' });
    adminToken = adminLogin.body.accessToken;
    createdUserId = '';
  });

  afterEach(async () => {
    if (moduleRef && createdUserId) {
      try {
        const prisma = moduleRef.get('PRISMA_SERVICE_TOKEN');
        await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
      } catch {
        // ignore cleanup errors
      }
    }
  });

  describe('POST /user - create user', () => {
    it('should create a patient user', async () => {
      if (!app) return;

      const newEmail = `patient-${Date.now()}@example.com`;
      const response = await request(app.getHttpServer())
        .post('/user')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: newEmail,
          password: 'Patient123!',
          firstName: 'New',
          lastName: 'Patient',
          role: 'PATIENT',
          clinicId: 'test-clinic',
        })
        .expect(201);

      expect(response.body.email).toBe(newEmail);
      expect(response.body.role).toBe(Role.PATIENT);
      expect(response.body).not.toHaveProperty('password');
      createdUserId = response.body.id;
    });

    it('should create a doctor user', async () => {
      if (!app) return;

      const newEmail = `doctor-${Date.now()}@example.com`;
      const response = await request(app.getHttpServer())
        .post('/user')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: newEmail,
          password: 'Doctor123!',
          firstName: 'New',
          lastName: 'Doctor',
          role: 'DOCTOR',
          clinicId: 'test-clinic',
        })
        .expect(201);

      expect(response.body.role).toBe(Role.DOCTOR);
      createdUserId = response.body.id;
    });

    it('should reject duplicate email', async () => {
      if (!app) return;

      const dupEmail = `dup-${Date.now()}@example.com`;
      await request(app.getHttpServer())
        .post('/user')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: dupEmail,
          password: 'Pass123!',
          firstName: 'First',
          lastName: 'User',
          role: 'PATIENT',
          clinicId: 'test-clinic',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/user')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: dupEmail,
          password: 'Pass123!',
          firstName: 'Second',
          lastName: 'User',
          role: 'PATIENT',
          clinicId: 'test-clinic',
        })
        .expect(409);

      expect(response.body.message).toContain('already exists');
    });

    it('should reject creation without auth', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .post('/user')
        .send({
          email: 'noauth@example.com',
          password: 'Pass123!',
          firstName: 'No',
          lastName: 'Auth',
          role: 'PATIENT',
          clinicId: 'test-clinic',
        })
        .expect(401);
    });
  });

  describe('GET /user/all - list users', () => {
    it('should return a list of users', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/user/all')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should filter by clinic ID', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/user/all')
        .query({ clinicId: 'test-clinic' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /user/search - search users', () => {
    it('should search users by query', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/user/search')
        .query({ q: 'test', limit: 10 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /user/profile - current user', () => {
    it('should return profile for authenticated user', async () => {
      if (!app) return;

      // Create a regular user and login
      const userEmail = `regular-${Date.now()}@example.com`;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: userEmail,
          password: 'UserPass123!',
          firstName: 'Regular',
          lastName: 'User',
          clinicId: 'test-clinic',
        });

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userEmail, password: 'UserPass123!' });
      const userToken = loginResponse.body.accessToken;

      const response = await request(app.getHttpServer())
        .get('/user/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.email).toBe(userEmail);
      expect(response.body.firstName).toBe('Regular');
      expect(response.body).not.toHaveProperty('password');
    });

    it('should reject unauthenticated access', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .get('/user/profile')
        .expect(401);
    });
  });

  describe('Security checks', () => {
    it('should never expose passwords in any user endpoint', async () => {
      if (!app) return;

      // Create a user
      const newEmail = `secure-${Date.now()}@example.com`;
      const createResponse = await request(app.getHttpServer())
        .post('/user')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: newEmail,
          password: 'SecretPass123!',
          firstName: 'Secure',
          lastName: 'User',
          role: 'PATIENT',
          clinicId: 'test-clinic',
        })
        .expect(201);

      expect(createResponse.body).not.toHaveProperty('password');
      if (createResponse.body.user) {
        expect(createResponse.body.user).not.toHaveProperty('password');
      }

      // List users
      const token = adminToken;
      const listResponse = await request(app.getHttpServer())
        .get('/user/all')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      for (const user of listResponse.body) {
        expect(user).not.toHaveProperty('password');
      }
    });
  });
});
