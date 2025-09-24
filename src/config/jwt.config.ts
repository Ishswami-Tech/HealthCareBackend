import { JwtModuleOptions } from "@nestjs/jwt";

export const jwtConfig: JwtModuleOptions = {
  secret: process.env.JWT_SECRET || "your-secret-key",
  signOptions: { expiresIn: process.env.JWT_EXPIRATION || "15m" },
};
