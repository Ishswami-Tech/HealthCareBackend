import * as dotenv from 'dotenv';
import * as path from 'path';
import type { Config } from '@core/types/config.types';
import developmentConfig from './environment/development.config';
import productionConfig from './environment/production.config';
import stagingConfig from './environment/staging.config';
import testConfig from './environment/test.config';
import cacheConfig, { redisConfig } from './cache.config';
import rateLimitConfig from './rate-limit.config';
import jitsiConfig from './jitsi.config';
import videoConfig from './video.config';
import { healthcareConfig } from '@infrastructure/database/config/healthcare.config';
import { ENV_VARS } from './constants';
import {
  validateEnvironmentConfig,
  getEnvironmentValidationErrorMessage,
} from './environment/validation';

type ConfigStore = Omit<Config, 'jitsi' | 'rateLimit' | 'redis' | 'video'> & {
  cache: ReturnType<typeof cacheConfig>;
  healthcare: ReturnType<typeof healthcareConfig>;
  jitsi: ReturnType<typeof jitsiConfig>;
  rateLimit: ReturnType<typeof rateLimitConfig>;
  redis: ReturnType<typeof redisConfig>;
  video: ReturnType<typeof videoConfig>;
};

let configStore: ConfigStore | null = null;

function loadEnvironmentVariables(): void {
  const nodeEnv = process.env[ENV_VARS.NODE_ENV] || 'development';
  const rootPath = process.cwd();

  dotenv.config({ path: path.join(rootPath, '.env') });
  dotenv.config({ path: path.join(rootPath, `.env.${nodeEnv}`) });
  dotenv.config({ path: path.join(rootPath, '.env.local'), override: true });
}

function getConfigFactory(): () => Config {
  const nodeEnv = process.env[ENV_VARS.NODE_ENV] || 'development';

  switch (nodeEnv) {
    case 'production':
      return productionConfig;
    case 'staging':
    case 'local-prod':
      return stagingConfig;
    case 'test':
      return testConfig;
    case 'development':
    default:
      return developmentConfig;
  }
}

function validateConfigEarly(): void {
  const nodeEnv = process.env[ENV_VARS.NODE_ENV] || 'development';
  const result = validateEnvironmentConfig(nodeEnv, false);

  if (!result.isValid) {
    if (result.warnings.length > 0 && nodeEnv !== 'test') {
      console.warn(
        `Recommended environment variables not set for ${nodeEnv}: ${result.warnings.join(', ')}`
      );
    }

    if (
      (nodeEnv === 'production' || nodeEnv === 'staging' || nodeEnv === 'local-prod') &&
      result.missing.length > 0
    ) {
      throw new Error(getEnvironmentValidationErrorMessage(nodeEnv, result.missing));
    }
  }
}

function buildConfigStore(): ConfigStore {
  loadEnvironmentVariables();
  validateConfigEarly();

  const environmentConfig = getConfigFactory()();

  return {
    ...environmentConfig,
    cache: cacheConfig(),
    healthcare: healthcareConfig(),
    jitsi: jitsiConfig(),
    rateLimit: rateLimitConfig(),
    redis: redisConfig(),
    video: videoConfig(),
  };
}

function ensureConfigStore(): ConfigStore {
  if (!configStore) {
    configStore = buildConfigStore();
  }

  return configStore;
}

function getFromPath(source: unknown, pathValue: string): unknown {
  const segments = pathValue.split('.');
  let current: unknown = source;

  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export function getConfigValue<T>(pathValue: string, defaultValue?: T): T | undefined {
  const store = ensureConfigStore();
  const value = getFromPath(store, pathValue);

  if (value !== undefined) {
    return value as T;
  }

  if (process.env[pathValue] !== undefined) {
    return process.env[pathValue] as T;
  }

  return defaultValue;
}
