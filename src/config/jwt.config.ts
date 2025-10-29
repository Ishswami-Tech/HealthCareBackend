import type { JwtModuleOptions } from "@nestjs/jwt";
import { ENV_VARS, DEFAULT_CONFIG } from "./constants";

/**
 * Validates JWT configuration
 * @param config - JWT configuration object
 * @throws Error if configuration is invalid
 */
function validateJwtConfig(config: JwtModuleOptions): void {
  if (!config.secret || config.secret === "your-secret-key") {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("JWT_SECRET must be set in production environment");
    }
  }

  if (!config.signOptions?.expiresIn) {
    throw new Error("JWT expiration time must be specified");
  }
}

/**
 * JWT module configuration
 * @constant jwtConfig
 */
export const jwtConfig: JwtModuleOptions = {
  secret: process.env[ENV_VARS.JWT_SECRET] || "your-secret-key",
  signOptions: {
    expiresIn:
      process.env[ENV_VARS.JWT_EXPIRATION] || DEFAULT_CONFIG.JWT_EXPIRATION,
  },
};

// Validate configuration on module load
validateJwtConfig(jwtConfig);
