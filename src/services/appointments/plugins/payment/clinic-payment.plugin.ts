import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { PaymentService } from './payment.service';

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
    const pluginData = data as any;
    this.logPluginAction('Processing clinic payment operation', {
      operation: pluginData.operation,
    });

    // Delegate to existing payment service - no functionality change
    switch (pluginData.operation) {
      case 'processPayment':
        return await this.paymentService.processPayment(pluginData.paymentId);

      case 'refundPayment':
        return await this.paymentService.refundPayment(pluginData.refundData);

      case 'getPaymentStatus':
        return await this.paymentService.getPaymentStatus(pluginData.paymentId);

      case 'processSubscriptionPayment':
        return await this.paymentService.processSubscriptionPayment(pluginData.subscriptionId);

      case 'cancelSubscription':
        return await this.paymentService.cancelSubscription(pluginData.subscriptionId);

      case 'processInsuranceClaim':
        return await this.paymentService.processInsuranceClaim(pluginData.claimData);

      case 'generateReceipt':
        return await this.paymentService.generateReceipt(pluginData.paymentId);

      case 'getPaymentAnalytics':
        return await this.paymentService.getPaymentAnalytics(pluginData.analyticsParams);

      default:
        this.logPluginError('Unknown payment operation', {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown payment operation: ${pluginData.operation}`);
    }
  }

  validate(data: unknown): Promise<boolean> {
    const pluginData = data as any;
    // Validate that required fields are present for each operation
    const requiredFields = {
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
    const fields = (requiredFields as any)[operation];

    if (!fields) {
      this.logPluginError('Invalid operation', { operation });
      return Promise.resolve(false);
    }

    const isValid = fields.every((field: unknown) => pluginData[field as string] !== undefined);
    if (!isValid) {
      this.logPluginError('Missing required fields', {
        operation,
        requiredFields: fields,
      });
    }

    return Promise.resolve(isValid);
  }
}
