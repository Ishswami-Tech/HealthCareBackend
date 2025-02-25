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

export interface AppConfig {
  database: DatabaseConfig;
  redis: RedisConfig;
  kafka: KafkaConfig;
} 