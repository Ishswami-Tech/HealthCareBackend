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
      const topics = ['user.created', 'user.updated', 'user.deleted', 'user.login', 'user.logout', 'email.sent'];
      
      const existingTopics = await admin.listTopics();
      const topicsToCreate = topics.filter(topic => !existingTopics.includes(topic));
      
      if (topicsToCreate.length > 0) {
        this.logger.log(`Creating Kafka topics: ${topicsToCreate.join(', ')}`);
        
        // Create topics one by one to avoid leadership election issues
        for (const topic of topicsToCreate) {
          try {
            await admin.createTopics({
              topics: [{
                topic,
                numPartitions: 1,
                replicationFactor: 1,
                configEntries: [
                  { name: 'min.insync.replicas', value: '1' }
                ]
              }]
            });
            this.logger.log(`Created Kafka topic: ${topic}`);
            // Add a small delay between topic creations
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            this.logger.warn(`Failed to create Kafka topic ${topic}: ${error.message}`);
          }
        }
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
      // Check if topic exists, create if it doesn't
      const admin = this.kafka.admin();
      await admin.connect();
      const existingTopics = await admin.listTopics();
      
      if (!existingTopics.includes(topic)) {
        this.logger.log(`Topic ${topic} does not exist, creating it...`);
        try {
          await admin.createTopics({
            topics: [{
              topic,
              numPartitions: 1,
              replicationFactor: 1,
              configEntries: [
                { name: 'min.insync.replicas', value: '1' }
              ]
            }]
          });
          this.logger.log(`Created Kafka topic: ${topic}`);
          // Add a small delay after topic creation
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (topicError) {
          this.logger.warn(`Failed to create Kafka topic ${topic}: ${topicError.message}`);
        }
      }
      
      await admin.disconnect();

      // Send the message with retry logic
      let retries = 0;
      const maxRetries = 3;
      
      while (retries < maxRetries) {
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
          return;
        } catch (sendError) {
          retries++;
          this.logger.warn(`Failed to send message to topic ${topic} (attempt ${retries}/${maxRetries}): ${sendError.message}`);
          
          if (retries < maxRetries) {
            // Exponential backoff
            const delay = Math.pow(2, retries) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            throw sendError;
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to send message to topic ${topic}:`, error);
      if (!this.isConnected) {
        await this.connect();
      }
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
      
      // Check if broker is available
      const clusterInfo = await admin.describeCluster();
      const brokerCount = clusterInfo.brokers.length;
      
      if (brokerCount === 0) {
        this.logger.warn('No Kafka brokers available');
        await admin.disconnect();
        return false;
      }
      
      // Check if topics can be listed
      const topics = await admin.listTopics();
      await admin.disconnect();
      
      this.logger.debug(`Kafka health check: ${brokerCount} brokers, ${topics.length} topics`);
      return true;
    } catch (error) {
      this.logger.error("Kafka health check failed:", error);
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
