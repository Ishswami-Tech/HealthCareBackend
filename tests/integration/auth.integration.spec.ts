/**
 * Integration tests for Auth module.
 *
 * Tests auth behavior against real infrastructure:
 * - User registration with database
 * - Login with password verification
 * - Token generation and verification
 * - Duplicate email rejection
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '@app.module';

// These tests require a running PostgreSQL database.
// Set TEST_DATABASE_URL in .env.test or environment.
// Run with: TEST_DATABASE_URL=postgresql://... jest --config jest.config.ts#integration

describe('Auth Integration', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let accessToken: string;
  let testEmail: string;

  beforeAll(async () => {
    // Skip if no test database is configured
    if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
      console.log('Skipping auth integration tests - no database configured');
      return;
    }

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  beforeEach(() => {
    testEmail = `test-${Date.now()}@example.com`;
    accessToken = '';
  });

  afterEach(async () => {
    // Clean up test data if database is available
    if (moduleRef && testEmail) {
      try {
        const prisma = moduleRef.get('PRISMA_SERVICE_TOKEN');
        await prisma.user.deleteMany({ where: { email: testEmail } });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('POST /auth/register', () => {
    it('should register a new user with valid data', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
          firstName: 'Test',
          lastName: 'User',
          clinicId: 'test-clinic',
        })
        .expect(201);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(testEmail);
      expect(response.body.user.role).toBe('PATIENT');
      expect(response.body.requiresVerification).toBe(true);
      expect(response.body.user).not.toHaveProperty('password');
    });

    it('should reject duplicate email registration', async () => {
      if (!app) return;

      const registerData = {
        email: testEmail,
        password: 'SecurePass123!',
        firstName: 'Test',
        lastName: 'User',
        clinicId: 'test-clinic',
      };

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerData)
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerData)
        .expect(409);

      expect(response.body.message).toContain('already exists');
    });

    it('should reject registration with missing required fields', async () => {
      if (!app) return;

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: testEmail })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      if (!app) return;
      // Register a user before each login test
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
          firstName: 'Test',
          lastName: 'User',
          clinicId: 'test-clinic',
        })
        .expect(201);
    });

    it('should login with valid credentials', async () => {
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
      expect(typeof response.body.accessToken).toBe('string');
      expect(typeof response.body.refreshToken).toBe('string');
      accessToken = response.body.accessToken;
    });

    it('should reject invalid credentials', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'wrong-password',
        })
        .expect(401);

      expect(response.body.message).toContain('Invalid');
    });

    it('should reject non-existent email', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password',
        })
        .expect(401);

      expect(response.body.message).toContain('Invalid');
    });

    it('should not expose password in response', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
        })
        .expect(200);

      expect(response.body).not.toHaveProperty('password');
      expect(response.body.user).not.toHaveProperty('password');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh tokens with valid refresh token', async () => {
      if (!app) return;

      // First login to get tokens
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
        })
        .expect(200);

      const refreshToken = loginResponse.body.refreshToken;

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(typeof response.body.accessToken).toBe('string');
    });

    it('should reject invalid refresh token', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);

      expect(response.body.message).toBeDefined();
    });
  });

  describe('protected endpoints', () => {
    it('should reject requests without token', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/auth/profile')
        .expect(401);

      expect(response.body.message).toBeDefined();
    });

    it('should reject requests with invalid token', async () => {
      if (!app) return;

      const response = await request(app.getHttpServer())
        .get('/auth/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.message).toBeDefined();
    });

    it('should return profile with valid token', async () => {
      if (!app) return;

      // Register and login
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
          firstName: 'Test',
          lastName: 'User',
          clinicId: 'test-clinic',
        });

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'SecurePass123!',
        });

      const token = loginResponse.body.accessToken;

      const response = await request(app.getHttpServer())
        .get('/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.email).toBe(testEmail);
      expect(response.body).not.toHaveProperty('password');
    });
  });
});
