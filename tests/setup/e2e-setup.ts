/**
 * Global setup for E2E tests.
 * Boots the NestJS application and sets up the test database.
 */

import type { INestApplication } from '@nestjs/common';

let app: INestApplication | null = null;

export default async (): Promise<void> => {
  process.env.NODE_ENV = 'test';
  console.log('[E2E Setup] Global setup complete');
};

export async function getApp(): Promise<INestApplication | null> {
  return app;
}
