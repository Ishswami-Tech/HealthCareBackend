import { registerAs } from "@nestjs/config";

export default registerAs("redis", () => ({
  host: process.env.REDIS_HOST ?? "localhost",
  port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
  ttl: parseInt(process.env.REDIS_TTL ?? "3600", 10),
  prefix: process.env.REDIS_PREFIX ?? "healthcare:",
  // Add development mode flag to make Redis optional
  enabled:
    process.env.REDIS_ENABLED !== "false" &&
    process.env.NODE_ENV !== "development",
  development: process.env.NODE_ENV === "development",
}));
