import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppConfig } from './whatsapp.config';

@Module({
  imports: [ConfigModule],
  providers: [WhatsAppService, WhatsAppConfig],
  exports: [WhatsAppService, WhatsAppConfig],
})
export class WhatsAppModule {} 