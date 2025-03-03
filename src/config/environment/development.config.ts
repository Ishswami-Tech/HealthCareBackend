export default () => ({
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  kafka: {
    brokers: process.env.KAFKA_BROKERS?.split(',') || ['kafka:9092'],
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