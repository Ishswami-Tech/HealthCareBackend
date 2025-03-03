export interface DatabaseConfig {
  url: string;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface KafkaConfig {
  brokers: string[];
}

export interface WhatsAppConfig {
  enabled: boolean;
  apiUrl: string;
  apiKey: string;
  phoneNumberId: string;
  businessAccountId: string;
  otpTemplateId: string;
  appointmentTemplateId: string;
  prescriptionTemplateId: string;
}

export interface AppConfig {
  database: DatabaseConfig;
  redis: RedisConfig;
  kafka: KafkaConfig;
  whatsapp: WhatsAppConfig;
} 