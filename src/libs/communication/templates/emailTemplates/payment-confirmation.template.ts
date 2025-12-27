/**
 * Payment Confirmation Email Template
 * @module EmailTemplates
 */

import type { PaymentTemplateData } from '@communication/channels/email/email-templates.service';
import { generateUnsubscribeFooter } from './unsubscribe-footer';

/**
 * Generates payment confirmation email template
 * @param data - Payment template data
 * @param unsubscribeUrl - Optional unsubscribe URL (will be added automatically if not provided)
 * @returns HTML email template
 */
export function generatePaymentConfirmationTemplate(
  data: PaymentTemplateData,
  unsubscribeUrl?: string
): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Confirmation</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; color: white; border-radius: 10px 10px 0 0;">
        <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Payment Confirmed</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Thank you for your payment</p>
      </div>

      <div style="background: white; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="font-size: 18px; color: #333; margin: 0 0 30px 0;">Dear ${data.patientName},</p>

        <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">
          We have successfully received your payment. Thank you for choosing our healthcare services.
        </p>

        <div style="background: #e8f5e9; padding: 25px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #4CAF50;">
          <h3 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 20px;">Payment Details</h3>
          <div style="display: grid; gap: 12px;">
            <div><strong style="color: #2c3e50;">Amount:</strong> <span style="color: #555; font-size: 18px; font-weight: bold;">${data.currency} ${data.amount.toFixed(2)}</span></div>
            <div><strong style="color: #2c3e50;">Transaction ID:</strong> <span style="color: #555;">${data.transactionId}</span></div>
            <div><strong style="color: #2c3e50;">Payment Date:</strong> <span style="color: #555;">${data.paymentDate}</span></div>
            <div><strong style="color: #2c3e50;">Service:</strong> <span style="color: #555;">${data.serviceDescription}</span></div>
          </div>
        </div>

        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #2196F3;">
          <h4 style="margin: 0 0 10px 0; color: #1976d2;">What's Next?</h4>
          <ul style="margin: 0; padding-left: 20px; color: #1976d2;">
            <li style="margin-bottom: 8px;">You will receive a receipt via email shortly</li>
            <li style="margin-bottom: 8px;">Your appointment is confirmed and scheduled</li>
            <li>If you need to make changes, please contact us</li>
          </ul>
        </div>

        ${
          data.receiptUrl
            ? `
        <div style="text-align: center; margin: 40px 0;">
          <a href="${data.receiptUrl}" style="display: inline-block; background: #4CAF50; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Download Receipt</a>
        </div>
        `
            : ''
        }

        <p style="font-size: 16px; color: #555; margin: 30px 0 0 0;">
          If you have any questions about this payment or need assistance, please contact our billing department.
        </p>
      </div>

      <div style="background: #f8f9fc; padding: 25px 30px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="margin: 0 0 10px 0; font-size: 16px; color: #333; font-weight: bold;">Best regards,</p>
        <p style="margin: 0 0 20px 0; font-size: 16px; color: #4CAF50; font-weight: bold;">${data.clinicName || 'Healthcare Team'}</p>
        ${unsubscribeUrl ? generateUnsubscribeFooter(unsubscribeUrl) : '<p style="margin: 0; font-size: 12px; color: #888;">This is an automated confirmation. Please do not reply to this email.</p>'}
      </div>
    </body>
    </html>
  `;
}
