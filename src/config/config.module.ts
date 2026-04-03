import { Module, Global } from '@nestjs/common';
import { ConfigService } from './config.service';
import { PaymentConfigService } from './payment-config.service';

/**
 * Enhanced Configuration Module for the Healthcare Application
 *
 * Uses the local configuration store instead of @nestjs/config so the app
 * can keep the same public ConfigService API without the vulnerable package.
 */
@Global()
@Module({
  providers: [ConfigService, PaymentConfigService],
  exports: [ConfigService, PaymentConfigService],
})
export class ConfigModule {
  static forRoot(): typeof ConfigModule {
    return ConfigModule;
  }
}
