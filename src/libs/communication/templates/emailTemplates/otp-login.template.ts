/**
 * OTP Login Template
 * @module EmailTemplates
 */

import type { OTPEmailContext } from '@core/types';

/**
 * Generates OTP login template
 * @param context - OTP email context
 * @returns HTML email template
 */
export function generateOTPLoginTemplate(context: OTPEmailContext): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #4a4a4a;">Login Verification Code</h2>
      <p>Hello ${context.name || 'there'},</p>
      <p>Your one-time password (OTP) for login is:</p>
      
      <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #f5f5f5; border-radius: 4px;">
        <h1 style="font-size: 32px; letter-spacing: 5px; color: #333; margin: 0;">${context.otp}</h1>
      </div>
      
      <div style="background-color: #e3f2fd; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #2196F3;">
        <p><strong>Important:</strong> This code will expire in 5 minutes.</p>
        <p>If you didn't request this code, please ignore this email and secure your account.</p>
      </div>
      
      <p>Best regards,<br>The ${context['appName'] || 'Healthcare App'} Security Team</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777;">
        <p>This is an automated security message, please do not reply to this email.</p>
      </div>
    </div>
  `;
}
