/**
 * Payment Handoff Token Module
 * ==============================
 * Module for secure payment callback token handling
 *
 * @module PaymentHandoffTokenModule
 * @description Dedicated module for payment handoff token services
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PaymentHandoffTokenService } from './payment.handoff-token.service';
import { ConfigModule } from '@config/config.module';
import { LoggingModule } from '@infrastructure/logging';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret =
          process.env['PAYMENT_HANDOFF_JWT_SECRET'] ||
          process.env['JWT_SECRET'] ||
          'fallback-secret';
        const isProduction = process.env['NODE_ENV'] === 'production';

        if (secret === 'fallback-secret' && isProduction) {
          throw new Error('PAYMENT_HANDOFF_JWT_SECRET is required in production environment');
        }

        return {
          secret,
          verifyOptions: {
            clockTolerance: 0, // No clock skew tolerance for strict timing
          },
        };
      },
    }),
    ConfigModule,
    LoggingModule,
  ],
  providers: [PaymentHandoffTokenService],
  exports: [PaymentHandoffTokenService],
})
export class PaymentHandoffTokenModule {}
