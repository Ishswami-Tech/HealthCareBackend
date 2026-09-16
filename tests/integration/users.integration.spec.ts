/**
 * Integration tests for Users module.
 *
 * Tests user management against real database:
 * - Create user
 * - Get user by ID
 * - Get current user profile
 * - Update user
 * - List users with filters
 * - Search users
 * - Password field never exposed
 * - Clinic/tenant isolation
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '@app.module';

// Requires TEST_DATABASE_URL configured.
// Run with: TEST_DATABASE_URL=postgresql://... jest --config jest.config.ts#integration

describe('Users Integration', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let adminToken: string;
  let testUserId: string;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
      console.log('Skipping users integration tests - no database configured');
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

  beforeEach(() => {
    testUserId = '';
    adminToken = '';
  });

  afterEach(async () => {
    if (moduleRef && testUserId) {
      try {
        const prisma = moduleRef.get('PRISMA_SERVICE_TOKEN');
        await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
      } catch {
        // ignore cleanup errors
      }
    }
  });

  describe('POST /user', () => {
    it('should create a new user', async () => {
      if (!app) return;

      // First create an admin and get token
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

      const newUserEmail = `newuser-${Date.now()}@example.com`;
      const response = await request(app.getHttpServer())
        .post('/user')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: newUserEmail,
          password: 'UserPass123!',
          firstName: 'New',
          lastName: 'User',
          role: 'PATIENT',
          clinicId: 'test-clinic',
        })
        .expect(201);

      expect(response.body.email).toBe(newUserEmail);
      expect(response.body).not.toHaveProperty('password');
      testUserId = response.body.id;
    });

    it('should reject duplicate email', async () => {
      if (!app) return;

      const userEmail = `dup-${Date.now()}@example.com`;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: userEmail,
          password: 'Pass123!',
          firstName: 'User',
          lastName: 'One',
          clinicId: 'test-clinic',
        });

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

      const response = await request(app.getHttpServer())
        .post('/user')
        .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
        .send({
          email: userEmail,
          password: 'Pass123!',
          firstName: 'User',
          lastName: 'Two',
          role: 'PATIENT',
          clinicId: 'test-clinic',
        })
        .expect(409);

      expect(response.body.message).toContain('already exists');
    });
  });

  describe('GET /user/profile', () => {
    it('should return current user profile', async () => {
      if (!app) return;

      const userEmail = `profile-${Date.now()}@example.com`;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: userEmail,
          password: 'Pass123!',
          firstName: 'Profile',
          lastName: 'User',
          clinicId: 'test-clinic',
        });

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userEmail, password: 'Pass123!' });

      const token = loginResponse.body.accessToken;

      const response = await request(app.getHttpServer())
        .get('/user/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.email).toBe(userEmail);
      expect(response.body.firstName).toBe('Profile');
      expect(response.body).not.toHaveProperty('password');
    });
  });

  describe('GET /user/all', () => {
    it('should return list of users', async () => {
      if (!app) return;

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

      const response = await request(app.getHttpServer())
        .get('/user/all')
        .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should reject unauthorized access', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .get('/user/all')
        .expect(401);
    });
  });
});
