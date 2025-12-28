/**
 * Security Alert Template
 * @module EmailTemplates
 */

import type { SecurityAlertEmailContext } from '@core/types';
import { generateUnsubscribeFooter } from './unsubscribe-footer';

/**
 * Generates security alert template
 * @param context - Security alert email context
 * @param unsubscribeUrl - Optional unsubscribe URL (will be added automatically if not provided)
 * @returns HTML email template
 */
export function generateSecurityAlertTemplate(
  context: SecurityAlertEmailContext,
  unsubscribeUrl?: string
): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #d32f2f;">Security Alert</h2>
      <p>Hello ${context.name || 'there'},</p>
      <p>We detected a security concern with your ${context['appName'] || 'Healthcare App'} account.</p>
      
      <div style="background-color: #ffebee; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #d32f2f;">
        <p><strong>Alert Time:</strong> ${context.time}</p>
        <p><strong>Action Taken:</strong> ${context.action || 'Security measures have been applied to your account.'}</p>
      </div>
      
      <p>For your security, we recommend:</p>
      <ul>
        <li>Change your password immediately</li>
        <li>Enable two-factor authentication if available</li>
        <li>Review recent account activity</li>
      </ul>
      
      <p>If you have any questions or concerns, please contact our support team immediately.</p>
      
      <p>Best regards,<br>The ${context['appName'] || 'Healthcare App'} Security Team</p>
      ${unsubscribeUrl ? generateUnsubscribeFooter(unsubscribeUrl) : '<div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;"><p>This is an important security notification. Please do not ignore this message.</p></div>'}
    </div>
  `;
}
