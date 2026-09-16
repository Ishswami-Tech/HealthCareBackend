/**
 * Jest configuration for the healthcare backend test suite.
 *
 * Three separate projects target unit, integration, and E2E suites.
 * Run with: jest --selectProjects unit | integration | e2e
 */

import type { Config } from 'jest';

const moduleMapper = {
  '^@infrastructure/(.*)$': '<rootDir>/src/libs/infrastructure/$1',
  '^@services/(.*)$': '<rootDir>/src/services/$1',
  '^@dtos/(.*)$': '<rootDir>/src/libs/dtos/$1',
  '^@dtos$': '<rootDir>/src/libs/dtos',
  '^@core/(.*)$': '<rootDir>/src/libs/core/$1',
  '^@types/(.*)$': '<rootDir>/src/libs/core/types/$1',
  '^@logging$': '<rootDir>/src/libs/infrastructure/logging',
  '^@logging/(.*)$': '<rootDir>/src/libs/infrastructure/logging/$1',
  '^@cache/(.*)$': '<rootDir>/src/libs/infrastructure/cache/$1',
  '^@events/(.*)$': '<rootDir>/src/libs/infrastructure/events/$1',
  '^@queue/(.*)$': '<rootDir>/src/libs/infrastructure/queue/$1',
  '^@security/(.*)$': '<rootDir>/src/libs/security/$1',
  '^@communication/(.*)$': '<rootDir>/src/libs/communication/$1',
  '^@config$': '<rootDir>/src/config',
  '^@config/(.*)$': '<rootDir>/src/config/$1',
  '^@database/(.*)$': '<rootDir>/src/libs/infrastructure/database/$1',
  '^@utils/(.*)$': '<rootDir>/src/libs/utils/$1',
  '^@queues/(.*)$': '<rootDir>/src/libs/infrastructure/queue/$1',
  '^@payment/(.*)$': '<rootDir>/src/libs/payment/$1',
  '^@app$': '<rootDir>/src/app.module.ts',
  '^@app\.module$': '<rootDir>/src/app.module.ts',
  '^@nestjs/swagger$': '<rootDir>/src/shims/nest-swagger',
};

const baseConfig: Partial<Config> = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: moduleMapper,
  rootDir: '.',
  clearMocks: true,
  restoreMocks: true,
  transformIgnorePatterns: ['node_modules/(?!(uuid)/)'],
};

const config: Config = {
  projects: [
    {
      ...baseConfig,
      displayName: 'unit',
      roots: ['<rootDir>/tests/unit'],
      testMatch: ['**/*.spec.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
      },
      collectCoverageFrom: [
        'src/services/**/*.ts',
        'src/libs/core/**/*.ts',
        '!src/**/*.dto.ts',
        '!src/**/*.module.ts',
        '!src/**/index.ts',
        '!src/**/*.spec.ts',
        '!src/**/*.e2e-spec.ts',
      ],
      coverageDirectory: '<rootDir>/coverage/unit',
    },
    {
      ...baseConfig,
      displayName: 'integration',
      roots: ['<rootDir>/tests/integration'],
      testMatch: ['**/*.spec.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
      },
      testTimeout: 60000,
    },
    {
      ...baseConfig,
      displayName: 'e2e',
      roots: ['<rootDir>/tests/e2e'],
      testMatch: ['**/*.e2e-spec.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
      },
      testTimeout: 120000,
    },
  ],
};

export default config;
