/**
 * Password Reset Confirmation Template
 * @module EmailTemplates
 */

import type { PasswordResetEmailContext } from '@core/types';

/**
 * Generates password reset confirmation template
 * @param context - Password reset email context
 * @param loginUrl - Login URL (optional)
 * @returns HTML email template
 */
export function generatePasswordResetConfirmationTemplate(
  context: PasswordResetEmailContext,
  loginUrl?: string
): string {
  const fallbackLoginUrl = loginUrl || 'https://app.healthcare/login';
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #4a4a4a;">Password Reset Successful</h2>
      <p>Hello ${context.name || 'there'},</p>
      <p>Your password has been successfully reset.</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${fallbackLoginUrl}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Login to Your Account
        </a>
      </div>
      
      <div style="background-color: #e8f5e9; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #4CAF50;">
        <p><strong>Security Notice:</strong> If you did not reset your password, please contact our support team immediately.</p>
      </div>
      
      <p>Best regards,<br>The Healthcare App Security Team</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
        <p>This is an automated security message, please do not reply to this email.</p>
      </div>
    </div>
  `;
}
