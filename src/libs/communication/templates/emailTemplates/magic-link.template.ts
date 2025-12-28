/**
 * Magic Link Template
 * @module EmailTemplates
 */

import type { MagicLinkEmailContext } from '@core/types';

/**
 * Generates magic link template
 * @param context - Magic link email context
 * @returns HTML email template
 */
export function generateMagicLinkTemplate(context: MagicLinkEmailContext): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #4a4a4a;">Login to ${context['appName'] || 'Healthcare App'}</h2>
      <p>Hello ${context.name},</p>
      <p>You requested a magic link to sign in to your ${context['appName'] || 'Healthcare App'} account. Click the button below to login:</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${context.loginUrl}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Login to Your Account
        </a>
      </div>
      
      <div style="background-color: #f8f8f8; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p><strong>Note:</strong> This link will expire in ${context.expiryTime}.</p>
      </div>
      
      <p>If you didn't request this link, you can safely ignore this email.</p>
      
      <p>Best regards,<br>The ${context['appName'] || 'Healthcare App'} Team</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
        <p>This is an automated message, please do not reply to this email.</p>
      </div>
    </div>
  `;
}
