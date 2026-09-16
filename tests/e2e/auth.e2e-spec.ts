/**
 * E2E tests for the complete auth and users flow.
 *
 * These tests boot the real NestJS application and exercise
 * HTTP endpoints via supertest.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '@app.module';

// Requires TEST_DATABASE_URL or DATABASE_URL configured.
// Run with: TEST_DATABASE_URL=postgresql://... jest --config jest.config.ts#e2e

describe('Auth & Users E2E', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let testEmail: string;
  let adminToken: string;
  let userToken: string;
  let createdUserId: string;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
      console.log('Skipping E2E tests - no database configured');
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

  beforeEach(() => {
    testEmail = `e2e-${Date.now()}@example.com`;
    adminToken = '';
    userToken = '';
    createdUserId = '';
  });

  afterEach(async () => {
    if (moduleRef && testEmail) {
      try {
        const prisma = moduleRef.get('PRISMA_SERVICE_TOKEN');
        await prisma.user.deleteMany({ where: { email: testEmail } }).catch(() => {});
        await prisma.user.deleteMany({ where: { email: testEmail.replace('e2e-', 'admin-') } }).catch(() => {});
      } catch {
        // ignore cleanup errors
      }
    }
  });

  describe('Registration flow', () => {
    it('should complete full registration → login → get profile flow', async () => {
      if (!app) return;

      // 1. Register
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
          firstName: 'E2E',
          lastName: 'Test',
          clinicId: 'test-clinic',
        })
        .expect(201);

      expect(registerResponse.body.user.email).toBe(testEmail);
      expect(registerResponse.body.requiresVerification).toBe(true);

      // 2. Login
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
        })
        .expect(200);

      userToken = loginResponse.body.accessToken;
      expect(typeof userToken).toBe('string');
      expect(userToken.length).toBeGreaterThan(0);

      // 3. Get profile
      const profileResponse = await request(app.getHttpServer())
        .get('/auth/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(profileResponse.body.email).toBe(testEmail);
      expect(profileResponse.body.firstName).toBe('E2E');
      expect(profileResponse.body).not.toHaveProperty('password');
      expect(profileResponse.body.user).not.toHaveProperty('password');
    });

    it('should reject registration with duplicate email', async () => {
      if (!app) return;

      const regData = {
        email: testEmail,
        password: 'SecurePass123!',
        firstName: 'First',
        lastName: 'User',
        clinicId: 'test-clinic',
      };

      await request(app.getHttpServer()).post('/auth/register').send(regData).expect(201);

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(regData)
        .expect(409);

      expect(response.body.message).toContain('already exists');
    });

    it('should reject weak passwords via validation', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: testEmail,
          password: '123', // too short
          firstName: 'Test',
          lastName: 'User',
          clinicId: 'test-clinic',
        })
        .expect(400);
    });
  });

  describe('Login flow', () => {
    beforeEach(async () => {
      if (!app) return;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
          firstName: 'Login',
          lastName: 'Test',
          clinicId: 'test-clinic',
        });
    });

    it('should login with correct credentials', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.accessToken.length).toBeGreaterThan(0);
      userToken = response.body.accessToken;
    });

    it('should reject wrong password', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'wrong-password',
        })
        .expect(401);

      expect(response.body.message).toBeDefined();
    });

    it('should reject non-existent email', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'nobody@example.com',
          password: 'password',
        })
        .expect(401);

      expect(response.body.message).toBeDefined();
    });
  });

  describe('Protected endpoints', () => {
    beforeEach(async () => {
      if (!app) return;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
          firstName: 'Protected',
          lastName: 'Test',
          clinicId: 'test-clinic',
        });

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: 'SecurePass123!' });
      userToken = loginResponse.body.accessToken;
    });

    it('should return 401 without token', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/auth/profile')
        .expect(401);

      expect(response.body.message).toBeDefined();
    });

    it('should return 401 with invalid token', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/auth/profile')
        .set('Authorization', 'Bearer invalid-token-xyz')
        .expect(401);

      expect(response.body.message).toBeDefined();
    });

    it('should return profile with valid token', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/auth/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.email).toBe(testEmail);
      expect(response.body).not.toHaveProperty('password');
    });
  });

  describe('Users management', () => {
    beforeEach(async () => {
      if (!app) return;

      // Create an admin user
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
    });

    it('should create a user as admin', async () => {
      if (!app) return;

      const newEmail = `created-${Date.now()}@example.com`;
      const response = await request(app.getHttpServer())
        .post('/user')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: newEmail,
          password: 'NewUser123!',
          firstName: 'New',
          lastName: 'User',
          role: 'PATIENT',
          clinicId: 'test-clinic',
        })
        .expect(201);

      expect(response.body.email).toBe(newEmail);
      expect(response.body).not.toHaveProperty('password');
      createdUserId = response.body.id;
    });

    it('should list users as admin', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/user/all')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should reject user creation without auth', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .post('/user')
        .send({
          email: 'unauth@example.com',
          password: 'Pass123!',
          firstName: 'No',
          lastName: 'Auth',
          role: 'PATIENT',
          clinicId: 'test-clinic',
        })
        .expect(401);
    });
  });

  describe('Sensitive data protection', () => {
    it('should never expose passwords in any response', async () => {
      if (!app) return;

      // Register
      const regResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
          firstName: 'Secure',
          lastName: 'Test',
          clinicId: 'test-clinic',
        });

      // Login
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: 'SecurePass123!' });
      const token = loginResponse.body.accessToken;

      // Get profile
      const profileResponse = await request(app.getHttpServer())
        .get('/auth/profile')
        .set('Authorization', `Bearer ${token}`);

      // Check no password in any level of response
      expect(profileResponse.body).not.toHaveProperty('password');
      if (profileResponse.body.user) {
        expect(profileResponse.body.user).not.toHaveProperty('password');
      }

      // Check register response too
      expect(regResponse.body.user).not.toHaveProperty('password');
    });
  });
});
