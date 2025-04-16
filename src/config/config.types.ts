export interface DatabaseConfig {
  url: string;
}

export interface RedisConfig {
  host: string;
  port: number;
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
  database: DatabaseConfig;
  redis: RedisConfig;
  whatsapp: WhatsappConfig;
} 