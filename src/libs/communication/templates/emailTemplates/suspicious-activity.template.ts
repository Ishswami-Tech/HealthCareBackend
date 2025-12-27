/**
 * Suspicious Activity Template
 * @module EmailTemplates
 */

import type { SuspiciousActivityEmailContext } from '@core/types';
import { generateUnsubscribeFooter } from './unsubscribe-footer';

/**
 * Generates suspicious activity template
 * @param context - Suspicious activity email context
 * @param unsubscribeUrl - Optional unsubscribe URL (will be added automatically if not provided)
 * @returns HTML email template
 */
export function generateSuspiciousActivityTemplate(
  context: SuspiciousActivityEmailContext,
  unsubscribeUrl?: string
): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #ff9800;">Suspicious Activity Detected</h2>
      <p>Hello ${context.name || 'there'},</p>
      <p>We've detected unusual activity on your Healthcare App account that requires additional verification.</p>
      
      <div style="background-color: #fff3e0; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #ff9800;">
        <p><strong>Detection Time:</strong> ${context.time}</p>
        <p><strong>Reason:</strong> Multiple login attempts from unfamiliar devices or locations</p>
      </div>
      
      <p>For your protection, we've temporarily added additional security measures to your account.</p>
      <p>The next time you log in, you'll need to verify your identity through additional steps.</p>
      
      <p>If you believe this is an error or have questions, please contact our support team at ${context.supportEmail || 'support@healthcareapp.com'}.</p>
      
      <p>Best regards,<br>The Healthcare App Security Team</p>
      ${unsubscribeUrl ? generateUnsubscribeFooter(unsubscribeUrl) : '<div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;"><p>This is an automated security notification. Please do not reply to this email.</p></div>'}
    </div>
  `;
}
