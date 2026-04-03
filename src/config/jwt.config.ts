import type { JwtModuleOptions } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { ENV_VARS, DEFAULT_CONFIG } from './constants';
import { getEnv, getEnvWithDefault } from './environment/utils';

/**
 * Validates JWT configuration
 * @param config - JWT configuration object
 * @throws Error if configuration is invalid
 */
function validateJwtConfig(config: JwtModuleOptions): void {
  // Use helper functions (which use dotenv) for environment variable access
  if (!config.secret) {
    throw new Error('JWT_SECRET must be set in runtime environment');
  }

  if (!config.signOptions?.expiresIn) {
    throw new Error('JWT expiration time must be specified');
  }
}

/**
 * JWT module configuration
 * Use helper functions (which use dotenv) for environment variable access
 * These mimic ConfigService methods but work in config factories
 * @constant jwtConfig
 */
const expiresInValue: string = getEnvWithDefault(
  ENV_VARS.JWT_EXPIRATION,
  DEFAULT_CONFIG.JWT_EXPIRATION
);
export const jwtConfig: JwtModuleOptions = {
  secret: getEnv(ENV_VARS.JWT_SECRET) || '',
  signOptions: {
    expiresIn: expiresInValue as SignOptions['expiresIn'],
  } as SignOptions,
};

// Validate configuration on module load
validateJwtConfig(jwtConfig);
