import { Injectable, NotImplementedException } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

import type {
  PaymentData,
  RefundData,
  SubscriptionData,
  PayoutData,
} from '@core/types/billing.types';

// Re-export types for backward compatibility
export type { PaymentData, RefundData, SubscriptionData, PayoutData };

@Injectable()
export class PaymentService {
  constructor(private readonly loggingService: LoggingService) {}

  private throwLegacyPaymentPluginError(operation: string): never {
    const message =
      `Legacy appointment payment plugin operation '${operation}' is disabled. ` +
      'Use the shared billing/payment services for live payment flows.';
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      message,
      'AppointmentsPluginPaymentService'
    );
    throw new NotImplementedException(message);
  }

  processPayment(paymentId: string): unknown {
    return this.throwLegacyPaymentPluginError(`processPayment:${paymentId}`);
  }

  refundPayment(refundData: RefundData): unknown {
    return this.throwLegacyPaymentPluginError(`refundPayment:${refundData.paymentId}`);
  }

  getPaymentStatus(paymentId: string): unknown {
    return this.throwLegacyPaymentPluginError(`getPaymentStatus:${paymentId}`);
  }

  processSubscriptionPayment(subscriptionId: string): unknown {
    return this.throwLegacyPaymentPluginError(`processSubscriptionPayment:${subscriptionId}`);
  }

  cancelSubscription(subscriptionId: string): unknown {
    return this.throwLegacyPaymentPluginError(`cancelSubscription:${subscriptionId}`);
  }

  processInsuranceClaim(_claimData: unknown): unknown {
    return this.throwLegacyPaymentPluginError('processInsuranceClaim');
  }

  processDesignerPayout(payoutData: PayoutData): unknown {
    return this.throwLegacyPaymentPluginError(`processDesignerPayout:${payoutData.providerId}`);
  }

  generateReceipt(paymentId: string): unknown {
    return this.throwLegacyPaymentPluginError(`generateReceipt:${paymentId}`);
  }

  getPaymentAnalytics(_analyticsParams: unknown): unknown {
    return this.throwLegacyPaymentPluginError('getPaymentAnalytics');
  }
}
