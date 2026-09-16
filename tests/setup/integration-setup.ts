/**
 * Global setup for integration tests.
 * Runs once before all integration test suites.
 */

export default async (): Promise<void> => {
  // Ensure test environment variables are set
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/healthcare_test';
  process.env.REDIS_HOST = process.env.TEST_REDIS_HOST || 'localhost';
  process.env.REDIS_PORT = process.env.TEST_REDIS_PORT || '6379';

  console.log('[Integration Setup] Test environment initialized');
};
