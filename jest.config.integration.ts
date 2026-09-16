import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.integration.spec.ts'],
  moduleNameMapper: {
    '^@database/(.*)$': '<rootDir>/src/libs/infrastructure/database/$1',
    '^@infrastructure/(.*)$': '<rootDir>/src/libs/infrastructure/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@dtos/(.*)$': '<rootDir>/src/libs/dtos/$1',
    '^@core/(.*)$': '<rootDir>/src/libs/core/$1',
    '^@types/(.*)$': '<rootDir>/src/libs/core/types/$1',
    '^@logging/(.*)$': '<rootDir>/src/libs/infrastructure/logging/$1',
    '^@cache/(.*)$': '<rootDir>/src/libs/infrastructure/cache/$1',
    '^@events/(.*)$': '<rootDir>/src/libs/infrastructure/events/$1',
    '^@queue/(.*)$': '<rootDir>/src/libs/infrastructure/queue/$1',
    '^@security/(.*)$': '<rootDir>/src/libs/security/$1',
    '^@communication/(.*)$': '<rootDir>/src/libs/communication/$1',
    '^@config$': '<rootDir>/src/config',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@utils/(.*)$': '<rootDir>/src/libs/utils/$1',
    '^@app$': '<rootDir>/src/app.module.ts',
    '^@app\.module$': '<rootDir>/src/app.module.ts',
    '^@core/session/session-management.service$':
      '<rootDir>/src/libs/core/session/session-management.service.ts',
  },
  testTimeout: 60000,
  clearMocks: true,
  restoreMocks: true,
};

export default config;
