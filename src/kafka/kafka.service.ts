import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Kafka, Producer, Consumer } from "kafkajs";

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private isConnected = false;
  private messageCount = 0;
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000;

  constructor() {
    this.kafka = new Kafka({
      clientId: "user-service",
      brokers: [process.env.KAFKA_BROKERS || 'kafka:29092'],
      retry: {
        initialRetryTime: 1000,
        retries: 8
      },
      connectionTimeout: 3000,
    });
    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({ groupId: "user-group" });
  }

  async onModuleInit() {
    try {
      await this.producer.connect();
      await this.consumer.connect();
      console.log('Successfully connected to Kafka');
    } catch (error) {
      console.error('Failed to connect to Kafka:', error);
    }
  }

  private async connectWithRetry(retryCount = 0) {
    try {
      if (!this.isConnected) {
        await this.producer.connect();
        await this.consumer.connect();

        await this.setupTopics();
        await this.setupConsumer();

        this.isConnected = true;
        console.log("Successfully connected to Kafka");
      }
    } catch (error) {
      console.error(
        `Failed to connect to Kafka (attempt ${retryCount + 1}/${
          this.maxRetries
        }):`,
        error
      );

      if (retryCount < this.maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
        await this.connectWithRetry(retryCount + 1);
      } else {
        console.error("Max retry attempts reached. Failed to connect to Kafka");
        this.isConnected = false;
      }
    }
  }

  private async setupTopics() {
    const admin = this.kafka.admin();
    await admin.connect();

    try {
      await admin.createTopics({
        topics: [
          {
            topic: "user-events",
            numPartitions: 1,
            replicationFactor: 1,
          },
        ],
        timeout: 5000,
      });
    } catch (error) {
      // Topic might already exist, ignore error
      console.log("Topic creation error (might already exist):", error.message);
    }

    await admin.disconnect();
  }

  private async setupConsumer() {
    await this.consumer.subscribe({
      topic: "user-events",
      fromBeginning: true,
    });

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        this.messageCount++;
        console.log("Received message:", message.value?.toString());
      },
    });
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
    await this.consumer.disconnect();
  }

  async sendMessage(topic: string, message: any) {
    try {
      await this.producer.send({
        topic,
        messages: [{ value: JSON.stringify(message) }],
      });
      return true;
    } catch (error) {
      console.error("Failed to send message:", error);
      return false;
    }
  }

  async getStatus() {
    return {
      isConnected: this.isConnected,
      messageCount: this.messageCount,
      topics: ["user-events"],
      consumerGroup: "user-group",
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
        brokers: process.env.KAFKA_BROKERS,
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
