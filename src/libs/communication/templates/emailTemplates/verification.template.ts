/**
 * Email Verification Template
 * @module EmailTemplates
 */

import type { VerificationEmailContext } from '@core/types/common.types';

/**
 * Generates email verification template
 * @param context - Verification email context
 * @returns HTML email template
 */
export function generateVerificationTemplate(context: VerificationEmailContext): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #4a4a4a;">Welcome to Healthcare App!</h2>
      <p>Thank you for signing up. Please verify your email address to complete your registration.</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${context.verificationUrl}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Verify Email Address
        </a>
      </div>
      
      <div style="background-color: #f8f8f8; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p><strong>Note:</strong> This verification link will expire in 24 hours.</p>
      </div>
      
      <p>If you did not create an account with us, please ignore this email.</p>
      
      <p>Best regards,<br>The Healthcare App Team</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
        <p>This is an automated message, please do not reply to this email.</p>
      </div>
    </div>
  `;
}
