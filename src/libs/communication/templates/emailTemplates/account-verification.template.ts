/**
 * Account Verification Email Template
 * @module EmailTemplates
 */

import type { AccountVerificationTemplateData } from '@communication/channels/email/email-templates.service';

/**
 * Generates account verification email template
 * @param data - Account verification template data
 * @returns HTML email template
 */
export function generateAccountVerificationTemplate(data: AccountVerificationTemplateData): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Account Verification</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; color: white; border-radius: 10px 10px 0 0;">
        <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Welcome!</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Verify your account to get started</p>
      </div>

      <div style="background: white; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="font-size: 18px; color: #333; margin: 0 0 30px 0;">Dear ${data.patientName},</p>

        <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">
          Welcome to our healthcare platform! Please verify your email address to activate your account.
        </p>

        <div style="text-align: center; margin: 40px 0;">
          <a href="${data.verificationUrl}" style="display: inline-block; background: #4CAF50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Verify Account</a>
        </div>

        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #2196F3;">
          <h4 style="margin: 0 0 15px 0; color: #1976d2;">Verification Code</h4>
          <p style="margin: 0; color: #1976d2;">If the button doesn't work, use this code:</p>
          <div style="background: white; padding: 15px; margin: 10px 0; border-radius: 5px; text-align: center; font-family: monospace; font-size: 24px; font-weight: bold; letter-spacing: 3px; color: #1976d2;">${data.verificationCode}</div>
        </div>

        <p style="font-size: 14px; color: #888; margin: 30px 0 0 0;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${data.verificationUrl}" style="color: #4CAF50; word-break: break-all;">${data.verificationUrl}</a>
        </p>
      </div>

      <div style="background: #f8f9fc; padding: 25px 30px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="margin: 0 0 10px 0; font-size: 16px; color: #333; font-weight: bold;">Best regards,</p>
        <p style="margin: 0 0 20px 0; font-size: 16px; color: #4CAF50; font-weight: bold;">${data.clinicName || 'Healthcare Team'}</p>
        <p style="margin: 0; font-size: 12px; color: #888;">This is an automated verification email. Please do not reply.</p>
      </div>
    </body>
    </html>
  `;
}
