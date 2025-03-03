import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { ConfigModule } from '@nestjs/config';
import { KafkaModule } from '../kafka/kafka.module';

@Module({
  imports: [
    ConfigModule,
    KafkaModule
  ],
  providers: [EmailService],
  exports: [EmailService]
})
export class EmailModule {} 