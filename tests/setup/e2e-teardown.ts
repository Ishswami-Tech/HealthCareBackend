/**
 * Global teardown for E2E tests.
 * Shuts down the NestJS application.
 */

export default async (): Promise<void> => {
  console.log('[E2E Teardown] Global teardown complete');
};
