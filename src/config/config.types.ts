export interface AppConfig {
  port: number;
  apiPrefix: string;
  environment: string;
  isDev: boolean;
}

export interface DatabaseConfig {
  url: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  ttl: number;
  prefix: string;
}

export interface JwtConfig {
  secret: string;
  expiration: string;
}

export interface PrismaConfig {
  schemaPath: string;
}

export interface RateLimitConfig {
  ttl: number;
  max: number;
}

export interface LoggingConfig {
  level: string;
  enableAuditLogs: boolean;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export interface CorsConfig {
  origin: string;
  credentials: boolean;
  methods: string;
}

export interface SecurityConfig {
  rateLimit: boolean;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  trustProxy: number;
}

export interface WhatsappConfig {
  enabled: boolean;
  apiUrl: string;
  apiKey: string;
  phoneNumberId: string;
  businessAccountId: string;
  otpTemplateId: string;
  appointmentTemplateId: string;
  prescriptionTemplateId: string;
}

export interface Config {
  app: AppConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  jwt: JwtConfig;
  prisma: PrismaConfig;
  rateLimit: RateLimitConfig;
  logging: LoggingConfig;
  email: EmailConfig;
  cors: CorsConfig;
  security: SecurityConfig;
  whatsapp: WhatsappConfig;
} 