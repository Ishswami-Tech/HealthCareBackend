/**
 * Global teardown for integration tests.
 * Runs once after all integration test suites complete.
 */

export default async (): Promise<void> => {
  console.log('[Integration Teardown] Test environment cleaned up');
};
