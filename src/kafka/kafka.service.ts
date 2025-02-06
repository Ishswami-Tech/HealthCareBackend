import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Kafka, Producer, Consumer } from "kafkajs";

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private isConnected = false;
  private messageCount = 0;

  constructor() {
    this.kafka = new Kafka({
      clientId: "user-service",
      brokers: [process.env.KAFKA_BROKERS || "kafka:29092"],
      retry: {
        initialRetryTime: 1000,
        retries: 10,
      },
    });
    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({ groupId: "user-group" });
  }

  async onModuleInit() {
    try {
      await this.producer.connect();
      await this.consumer.connect();

      // Create topic if it doesn't exist
      const admin = this.kafka.admin();
      await admin.createTopics({
        topics: [
          {
            topic: "user-events",
            numPartitions: 1,
            replicationFactor: 1,
          },
        ],
      });
      await admin.disconnect();

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

      this.isConnected = true;
    } catch (error) {
      console.error("Failed to connect to Kafka:", error);
      this.isConnected = false;
    }
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
}
