/**
 * Password Reset Email Template
 * @module EmailTemplates
 */

import type { PasswordResetTemplateData } from '@communication/channels/email/email-templates.service';

/**
 * Generates password reset email template
 * @param data - Password reset template data
 * @returns HTML email template
 */
export function generatePasswordResetTemplate(data: PasswordResetTemplateData): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white; border-radius: 10px 10px 0 0;">
        <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Password Reset</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Reset your account password</p>
      </div>

      <div style="background: white; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="font-size: 18px; color: #333; margin: 0 0 30px 0;">Dear ${data.patientName},</p>

        <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">
          We received a request to reset your password. Click the button below to create a new password.
        </p>

        <div style="text-align: center; margin: 40px 0;">
          <a href="${data.resetUrl}" style="display: inline-block; background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Reset Password</a>
        </div>

        <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #ffc107;">
          <h4 style="margin: 0 0 10px 0; color: #856404;">Security Notice</h4>
          <ul style="margin: 0; padding-left: 20px; color: #856404;">
            <li style="margin-bottom: 8px;">This link expires in ${data.expiryTime}</li>
            <li style="margin-bottom: 8px;">If you didn't request this reset, please ignore this email</li>
            <li>For security, this link can only be used once</li>
          </ul>
        </div>

        <p style="font-size: 14px; color: #888; margin: 30px 0 0 0;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${data.resetUrl}" style="color: #667eea; word-break: break-all;">${data.resetUrl}</a>
        </p>
      </div>

      <div style="background: #f8f9fc; padding: 25px 30px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="margin: 0 0 10px 0; font-size: 16px; color: #333; font-weight: bold;">Best regards,</p>
        <p style="margin: 0 0 20px 0; font-size: 16px; color: #667eea; font-weight: bold;">${data.clinicName || 'Healthcare Team'}</p>
        <p style="margin: 0; font-size: 12px; color: #888;">This is an automated security email. Please do not reply.</p>
      </div>
    </body>
    </html>
  `;
}
