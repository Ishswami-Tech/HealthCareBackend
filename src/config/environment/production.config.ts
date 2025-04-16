export default () => ({
  app: {
    port: parseInt(process.env.PORT || '8088', 10),
    apiPrefix: process.env.API_PREFIX || '/api/v1',
    environment: 'production',
    isDev: false,
  },
  database: {
    url: process.env.DATABASE_URL_PROD || process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/userdb?schema=public',
  },
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    ttl: parseInt(process.env.REDIS_TTL || '3600', 10),
    prefix: process.env.REDIS_PREFIX || 'healthcare:',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-key-change-in-production',
    expiration: process.env.JWT_EXPIRATION || '24h',
  },
  prisma: {
    schemaPath: process.env.PRISMA_SCHEMA_PATH || './src/shared/database/prisma/schema.prisma',
  },
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableAuditLogs: process.env.ENABLE_AUDIT_LOGS !== 'false',
  },
  email: {
    host: process.env.EMAIL_HOST || 'sandbox.smtp.mailtrap.io',
    port: parseInt(process.env.EMAIL_PORT || '2525', 10),
    secure: process.env.EMAIL_SECURE === 'true',
    user: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASSWORD || '',
    from: process.env.EMAIL_FROM || 'noreply@healthcare.com',
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:8088,http://localhost:5050,http://localhost:8082',
    credentials: process.env.CORS_CREDENTIALS === 'true',
    methods: process.env.CORS_METHODS || 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  },
  security: {
    rateLimit: process.env.SECURITY_RATE_LIMIT === 'true',
    rateLimitMax: parseInt(process.env.SECURITY_RATE_LIMIT_MAX || '1000', 10),
    rateLimitWindowMs: parseInt(process.env.SECURITY_RATE_LIMIT_WINDOW_MS || '150', 10),
    trustProxy: parseInt(process.env.TRUST_PROXY || '1', 10),
  },
  whatsapp: {
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    apiUrl: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v17.0',
    apiKey: process.env.WHATSAPP_API_KEY || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    otpTemplateId: process.env.WHATSAPP_OTP_TEMPLATE_ID || 'otp_verification',
    appointmentTemplateId: process.env.WHATSAPP_APPOINTMENT_TEMPLATE_ID || 'appointment_reminder',
    prescriptionTemplateId: process.env.WHATSAPP_PRESCRIPTION_TEMPLATE_ID || 'prescription_notification',
  },
}); 