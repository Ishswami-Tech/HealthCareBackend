/**
 * Login Notification Template
 * @module EmailTemplates
 */

import type { LoginNotificationEmailContext } from '@core/types';
import { generateUnsubscribeFooter } from './unsubscribe-footer';

/**
 * Generates login notification template
 * @param context - Login notification email context
 * @param unsubscribeUrl - Optional unsubscribe URL (will be added automatically if not provided)
 * @returns HTML email template
 */
export function generateLoginNotificationTemplate(
  context: LoginNotificationEmailContext,
  unsubscribeUrl?: string
): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #4a4a4a;">New Login to Your Account</h2>
      <p>Hello ${context.name || 'there'},</p>
      <p>We detected a new login to your Healthcare App account.</p>
      
      <div style="background-color: #f8f8f8; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #555;">Login Details:</h3>
        <p><strong>Time:</strong> ${context.time}</p>
        <p><strong>Device:</strong> ${context.device || 'Unknown'}</p>
        <p><strong>Browser:</strong> ${context.browser || 'Unknown'}</p>
        <p><strong>Operating System:</strong> ${context.operatingSystem || 'Unknown'}</p>
        <p><strong>IP Address:</strong> ${context.ipAddress || 'Unknown'}</p>
        <p><strong>Location:</strong> ${context.location || 'Unknown'}</p>
      </div>
      
      <p>If this was you, no further action is needed.</p>
      <p>If you don't recognize this login, please secure your account immediately by changing your password.</p>
      
      <p>Best regards,<br>The Healthcare App Security Team</p>
      ${unsubscribeUrl ? generateUnsubscribeFooter(unsubscribeUrl) : '<div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;"><p>This is an automated security notification. Please do not reply to this email.</p></div>'}
    </div>
  `;
}
