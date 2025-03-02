import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, Consumer, Admin } from 'kafkajs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private isConnected: boolean = false;
  private messageCount: number = 0;
  private readonly logger = new Logger(KafkaService.name);
  private readonly retryAttempts = 5;
  private readonly retryDelay = 5000; // 5 seconds

  constructor(private configService: ConfigService) {
    this.kafka = new Kafka({
      clientId: 'user-service',
      brokers: [this.configService.get('KAFKA_BROKERS', 'kafka:9092')],
      retry: {
        initialRetryTime: 100,
        retries: 8,
        maxRetryTime: 30000,
        factor: 2
      },
      connectionTimeout: 3000,
      authenticationTimeout: 1000
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000
    });

    this.consumer = this.kafka.consumer({
      groupId: 'user-consumer-group',
      maxWaitTimeInMs: 50,
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });
  }

  async onModuleInit() {
    await this.connect();
    await this.setupTopics();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async setupTopics() {
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      const topics = ['user.created', 'user.updated', 'user.deleted', 'user.login', 'user.logout'];
      
      const existingTopics = await admin.listTopics();
      const topicsToCreate = topics.filter(topic => !existingTopics.includes(topic));
      
      if (topicsToCreate.length > 0) {
        await admin.createTopics({
          topics: topicsToCreate.map(topic => ({
            topic,
            numPartitions: 1,
            replicationFactor: 1
          }))
        });
        this.logger.log(`Created Kafka topics: ${topicsToCreate.join(', ')}`);
      }
    } catch (error) {
      this.logger.error('Failed to setup Kafka topics:', error);
    } finally {
      await admin.disconnect();
    }
  }

  private async connect() {
    let retries = 0;
    while (retries < this.retryAttempts) {
      try {
        await Promise.all([
          this.producer.connect(),
          this.consumer.connect()
        ]);
        this.isConnected = true;
        this.logger.log('Successfully connected to Kafka');
        return;
      } catch (error) {
        retries++;
        this.logger.error(`Failed to connect to Kafka (attempt ${retries}/${this.retryAttempts}):`, error);
        if (retries < this.retryAttempts) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }
    throw new Error('Failed to connect to Kafka after multiple attempts');
  }

  private async disconnect() {
    try {
      await Promise.all([
        this.producer.disconnect(),
        this.consumer.disconnect()
      ]);
      this.isConnected = false;
      this.logger.log('Disconnected from Kafka');
    } catch (error) {
      this.logger.error('Error disconnecting from Kafka:', error);
    }
  }

  async sendMessage(topic: string, message: any): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      await this.producer.send({
        topic,
        messages: [{
          value: JSON.stringify({
            ...message,
            timestamp: new Date().toISOString()
          })
        }]
      });
      this.messageCount++;
      this.logger.debug(`Message sent to topic ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to send message to topic ${topic}:`, error);
      if (!this.isConnected) {
        await this.connect();
      }
      throw error;
    }
  }

  admin(): Admin {
    return this.kafka.admin();
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      messageCount: this.messageCount,
      topics: [
        'user.created',
        'user.updated',
        'user.deleted',
        'user.login',
        'user.logout'
      ],
      consumerGroup: 'user-consumer-group'
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
        brokers: this.configService.get('KAFKA_BROKERS'),
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

  async emit(topic: string, message: any) {
    try {
      await this.producer.send({
        topic,
        messages: [{ value: JSON.stringify(message) }],
      });
    } catch (error) {
      console.error('Failed to emit Kafka message:', error);
    }
  }

  async onApplicationShutdown() {
    await this.producer.disconnect();
  }

  async ping(): Promise<void> {
    try {
      const admin = this.kafka.admin();
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();
    } catch (error) {
      throw new Error('Kafka connection failed');
    }
  }

  async subscribe(topic: string, callback: (message: any) => void): Promise<void> {
    await this.consumer.subscribe({ topic });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const value = message.value.toString();
        callback(JSON.parse(value));
      },
    });
  }
}
