import { registerAs } from "@nestjs/config";

export default registerAs("redis", () => ({
  host: process.env.REDIS_HOST ?? (process.env.NODE_ENV === 'production' ? 'redis' : 'localhost'),
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  ttl: parseInt(process.env.REDIS_TTL ?? '3600', 10),
  prefix: process.env.REDIS_PREFIX ?? 'healthcare:',
}));
