import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { PaymentService } from './payment.service';
import type { RefundData } from '@core/types/billing.types';

interface PaymentPluginData {
  operation: string;
  paymentId?: string;
  refundData?: RefundData;
  subscriptionId?: string;
  claimData?: unknown;
  analyticsParams?: unknown;
}

@Injectable()
export class ClinicPaymentPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-payment-plugin';
  readonly version = '1.0.0';
  readonly features = [
    'payment-processing',
    'insurance-billing',
    'refund-management',
    'subscription-billing',
  ];

  constructor(private readonly paymentService: PaymentService) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = this.validatePluginData(data);
    this.logPluginAction('Processing clinic payment operation', {
      operation: pluginData.operation,
    });

    // Delegate to existing payment service - no functionality change
    switch (pluginData.operation) {
      case 'processPayment': {
        if (!pluginData.paymentId) {
          throw new Error('Missing required field: paymentId');
        }
        return await this.paymentService.processPayment(pluginData.paymentId);
      }

      case 'refundPayment': {
        if (!pluginData.refundData) {
          throw new Error('Missing required field: refundData');
        }
        return await this.paymentService.refundPayment(pluginData.refundData);
      }

      case 'getPaymentStatus': {
        if (!pluginData.paymentId) {
          throw new Error('Missing required field: paymentId');
        }
        return await this.paymentService.getPaymentStatus(pluginData.paymentId);
      }

      case 'processSubscriptionPayment': {
        if (!pluginData.subscriptionId) {
          throw new Error('Missing required field: subscriptionId');
        }
        return await this.paymentService.processSubscriptionPayment(pluginData.subscriptionId);
      }

      case 'cancelSubscription': {
        if (!pluginData.subscriptionId) {
          throw new Error('Missing required field: subscriptionId');
        }
        return await this.paymentService.cancelSubscription(pluginData.subscriptionId);
      }

      case 'processInsuranceClaim': {
        if (!pluginData.claimData) {
          throw new Error('Missing required field: claimData');
        }
        return await this.paymentService.processInsuranceClaim(pluginData.claimData);
      }

      case 'generateReceipt': {
        if (!pluginData.paymentId) {
          throw new Error('Missing required field: paymentId');
        }
        return await this.paymentService.generateReceipt(pluginData.paymentId);
      }

      case 'getPaymentAnalytics': {
        if (!pluginData.analyticsParams) {
          throw new Error('Missing required field: analyticsParams');
        }
        return await this.paymentService.getPaymentAnalytics(pluginData.analyticsParams);
      }

      default:
        this.logPluginError('Unknown payment operation', {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown payment operation: ${pluginData.operation}`);
    }
  }

  private validatePluginData(data: unknown): PaymentPluginData {
    if (typeof data !== 'object' || data === null) {
      throw new Error('Invalid plugin data: must be an object');
    }
    const record = data as Record<string, unknown>;
    if (typeof record['operation'] !== 'string') {
      throw new Error('Invalid plugin data: operation must be a string');
    }
    return record as unknown as PaymentPluginData;
  }

  validate(data: unknown): Promise<boolean> {
    try {
      const pluginData = this.validatePluginData(data);
      // Validate that required fields are present for each operation
      const requiredFields: Record<string, string[]> = {
        processPayment: ['paymentId'],
        refundPayment: ['refundData'],
        getPaymentStatus: ['paymentId'],
        processSubscriptionPayment: ['subscriptionId'],
        cancelSubscription: ['subscriptionId'],
        processInsuranceClaim: ['claimData'],
        generateReceipt: ['paymentId'],
        getPaymentAnalytics: ['analyticsParams'],
      };

      const operation = pluginData.operation;
      const fields = requiredFields[operation];

      if (!fields) {
        this.logPluginError('Invalid operation', { operation });
        return Promise.resolve(false);
      }

      const isValid = fields.every(
        field => pluginData[field as keyof PaymentPluginData] !== undefined
      );
      if (!isValid) {
        this.logPluginError('Missing required fields', {
          operation,
          requiredFields: fields,
        });
      }

      return Promise.resolve(isValid);
    } catch {
      return Promise.resolve(false);
    }
  }
}
