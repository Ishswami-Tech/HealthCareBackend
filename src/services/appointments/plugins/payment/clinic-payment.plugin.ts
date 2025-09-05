import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { PaymentService } from './payment.service';

@Injectable()
export class ClinicPaymentPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-payment-plugin';
  readonly version = '1.0.0';
  readonly features = ['payment-processing', 'insurance-billing', 'refund-management', 'subscription-billing'];

  constructor(
    private readonly paymentService: PaymentService
  ) {
    super();
  }

  async process(data: any): Promise<any> {
    this.logPluginAction('Processing clinic payment operation', { operation: data.operation });
    
    // Delegate to existing payment service - no functionality change
    switch (data.operation) {
      case 'processPayment':
        return await this.paymentService.processPayment(data.paymentId);
      
      case 'refundPayment':
        return await this.paymentService.refundPayment(data.refundData);
      
      case 'getPaymentStatus':
        return await this.paymentService.getPaymentStatus(data.paymentId);
      
      case 'processSubscriptionPayment':
        return await this.paymentService.processSubscriptionPayment(data.subscriptionId);
      
      case 'cancelSubscription':
        return await this.paymentService.cancelSubscription(data.subscriptionId);
      
      case 'processInsuranceClaim':
        return await this.paymentService.processInsuranceClaim(data.claimData);
      
      case 'generateReceipt':
        return await this.paymentService.generateReceipt(data.paymentId);
      
      case 'getPaymentAnalytics':
        return await this.paymentService.getPaymentAnalytics(data.analyticsParams);
      
      default:
        this.logPluginError('Unknown payment operation', { operation: data.operation });
        throw new Error(`Unknown payment operation: ${data.operation}`);
    }
  }

  async validate(data: any): Promise<boolean> {
    // Validate that required fields are present for each operation
    const requiredFields = {
      processPayment: ['paymentId'],
      refundPayment: ['refundData'],
      getPaymentStatus: ['paymentId'],
      processSubscriptionPayment: ['subscriptionId'],
      cancelSubscription: ['subscriptionId'],
      processInsuranceClaim: ['claimData'],
      generateReceipt: ['paymentId'],
      getPaymentAnalytics: ['analyticsParams']
    };

    const operation = data.operation;
    const fields = (requiredFields as any)[operation];
    
    if (!fields) {
      this.logPluginError('Invalid operation', { operation });
      return false;
    }

    const isValid = fields.every((field: any) => data[field] !== undefined);
    if (!isValid) {
      this.logPluginError('Missing required fields', { operation, requiredFields: fields });
    }

    return isValid;
  }
}
