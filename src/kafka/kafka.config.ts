import { KafkaOptions, Transport } from '@nestjs/microservices';

export const kafkaConfig: KafkaOptions = {
  transport: Transport.KAFKA,
  options: {
    client: {
      clientId: 'user-service',
      brokers: process.env.KAFKA_BROKERS?.split(',') || ['kafka:29092'],
      retry: {
        initialRetryTime: 100,
        retries: 5
      }
    },
    consumer: {
      groupId: 'user-consumer-group'
    }
  }
}; 

