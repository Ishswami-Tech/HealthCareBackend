/**
 * Global Jest test setup.
 * Runs before all test files.
 */

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (console as any).log = (...args: any[]) => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (console as any).warn = (...args: any[]) => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (console as any).error = (...args: any[]) => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (console as any).info = (...args: any[]) => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (console as any).debug = (...args: any[]) => {};
}

export {};
