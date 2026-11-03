/**
 * Jest configuration for the healthcare backend test suite.
 *
 * Three separate projects target unit, integration, and E2E suites.
 * Run with: jest --selectProjects unit | integration | e2e
 */

import type { Config } from 'jest';
import { spawnSync } from 'node:child_process';
import * as vm from 'node:vm';

/**
 * NestJS 12 (and several other runtime deps) ship as ESM-only packages
 * ("type": "module"). The app itself is CommonJS and loads them through
 * Node 24's native require(esm). Jest 30 mirrors that only when
 * `vm.SourceTextModule` exists, i.e. when Node runs with
 * --experimental-vm-modules; without it every suite that touches
 * @nestjs/* fails with "Must use import to load ES Module".
 *
 * The yarn test scripts pass the flag via NODE_OPTIONS. This guard makes a
 * bare `npx jest` (or an IDE runner) behave the same: if the flag is missing
 * it re-runs the identical jest command once with the flag and exits with
 * its status.
 */
const VM_MODULES_FLAG = '--experimental-vm-modules';
const REEXEC_MARKER = 'HEALTHCARE_JEST_VM_MODULES_REEXEC';

function ensureVmModules(): void {
  const hasSourceTextModule =
    typeof (vm as { SourceTextModule?: unknown }).SourceTextModule === 'function';
  if (hasSourceTextModule || process.env[REEXEC_MARKER] === '1') {
    return;
  }
  const nodeOptions = [process.env['NODE_OPTIONS'] ?? '', VM_MODULES_FLAG].join(' ').trim();
  const result = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: nodeOptions, [REEXEC_MARKER]: '1' },
  });
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

ensureVmModules();

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
