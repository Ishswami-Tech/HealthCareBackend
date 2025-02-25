import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, Consumer, Partitioners } from 'kafkajs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private messageCount: number = 0;
  private isConnected: boolean = false;
  private readonly logger = new Logger(KafkaService.name);

  constructor(private configService: ConfigService) {
    const brokers = this.configService.get<string[]>('kafka.brokers') || ['kafka:29092'];
    
    this.kafka = new Kafka({
      clientId: 'user-service',
      brokers,
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });

    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner
    });
    this.consumer = this.kafka.consumer({ 
      groupId: 'user-consumer-group',
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });
  }

  async onModuleInit() {
    try {
      await this.connect();
      await this.setupConsumer();
      this.isConnected = true;
      this.logger.log('Successfully connected to Kafka');
    } catch (error) {
      this.logger.error('Failed to connect to Kafka:', error);
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    try {
      await this.producer.disconnect();
      await this.consumer.disconnect();
      this.isConnected = false;
    } catch (error) {
      this.logger.error('Error disconnecting from Kafka:', error);
    }
  }

  private async connect() {
    try {
      await this.producer.connect();
      await this.consumer.connect();
    } catch (error) {
      this.logger.error('Error connecting to Kafka:', error);
      throw error;
    }
  }

  private async setupConsumer() {
    try {
      await this.consumer.subscribe({
        topic: "user-events",
        fromBeginning: true,
      });

      await this.consumer.run({
        eachMessage: async ({ message }) => {
          this.messageCount++;
          this.logger.debug('Received message:', message.value?.toString());
        },
      });
    } catch (error) {
      this.logger.error('Error setting up consumer:', error);
      throw error;
    }
  }

  async sendMessage(topic: string, message: any): Promise<void> {
    try {
      await this.producer.send({
        topic,
        messages: [{ value: JSON.stringify(message) }],
      });
    } catch (error) {
      this.logger.error('Error sending message:', error);
      throw error;
    }
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      messageCount: this.messageCount,
      topics: ["user-events"],
      consumerGroup: "user-consumer-group"
    };
  }

  async getDetailedStatus() {
    try {
      const admin = this.kafka.admin();
      await admin.connect();

      const topics = await admin.listTopics();
      const groups = await admin.listGroups();

      await admin.disconnect();

      return {
        isConnected: this.isConnected,
        messageCount: this.messageCount,
        topics,
        consumerGroups: groups,
        brokers: this.configService.get('kafka.brokers'),
        clientId: "user-service",
      };
    } catch (error) {
      return {
        isConnected: false,
        error: error.message,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const admin = this.kafka.admin();
      await admin.connect();
      const topics = await admin.listTopics();
      await admin.disconnect();
      return topics.includes("user-events");
    } catch (error) {
      console.error("Kafka health check failed:", error);
      return false;
    }
  }
}
