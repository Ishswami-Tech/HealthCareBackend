/**
 * Welcome Email Template
 * @module EmailTemplates
 */

import type { WelcomeEmailContext } from '@core/types/common.types';

/**
 * Generates welcome email template
 * @param context - Welcome email context
 * @returns HTML email template
 */
export function generateWelcomeTemplate(context: WelcomeEmailContext): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #4a4a4a;">Welcome to Healthcare App!</h2>
      <p>Hello ${context.name || 'there'},</p>
      <p>Thank you for joining Healthcare App. We're excited to have you on board as a ${context.role || 'user'}!</p>
      
      ${
        context.isGoogleAccount
          ? `<p>Your account has been created using Google Sign-In. You can continue to use Google to log in to your account.</p>`
          : `<p>You can now log in to your account using your email and password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${context.loginUrl}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
            Login to Your Account
          </a>
        </div>`
      }
      
      <p>Access your dashboard to get started:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${context.dashboardUrl}" style="background-color: #2196F3; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Go to Dashboard
        </a>
      </div>
      
      <p>If you have any questions or need assistance, please contact our support team at ${context.supportEmail || 'support@healthcareapp.com'}.</p>
      
      <p>Best regards,<br>The Healthcare App Team</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
        <p>This is an automated message, please do not reply to this email.</p>
      </div>
    </div>
  `;
}
