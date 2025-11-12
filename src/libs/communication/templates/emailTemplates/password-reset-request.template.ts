/**
 * Password Reset Request Template
 * @module EmailTemplates
 */

import type { PasswordResetEmailContext } from '@core/types/common.types';

/**
 * Generates password reset request template
 * @param context - Password reset email context
 * @returns HTML email template
 */
export function generatePasswordResetRequestTemplate(context: PasswordResetEmailContext): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #4a4a4a;">Reset Your Password</h2>
      <p>Hello ${context.name || 'there'},</p>
      <p>You requested to reset your password. Please click the button below to set a new password:</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${context.resetUrl}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Reset Password
        </a>
      </div>
      
      <div style="background-color: #f8f8f8; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p><strong>Note:</strong> This link will expire in ${context.expiryTime || '60 minutes'}.</p>
      </div>
      
      <p>If you didn't request this, please ignore this email or contact support if you have concerns.</p>
      
      <p>Best regards,<br>The Healthcare App Security Team</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
        <p>This is an automated security message, please do not reply to this email.</p>
      </div>
    </div>
  `;
}
