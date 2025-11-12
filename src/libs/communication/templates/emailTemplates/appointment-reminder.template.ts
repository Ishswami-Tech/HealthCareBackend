/**
 * Appointment Reminder Email Template
 * @module EmailTemplates
 */

import type { AppointmentTemplateData } from '@communication/channels/email/email-templates.service';

/**
 * Generates appointment reminder email template
 * @param data - Appointment template data
 * @returns HTML email template
 */
export function generateAppointmentReminderTemplate(data: AppointmentTemplateData): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Appointment Reminder</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white; border-radius: 10px 10px 0 0;">
        <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Appointment Reminder</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Your healthcare appointment is coming up</p>
      </div>

      <div style="background: white; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="font-size: 18px; color: #333; margin: 0 0 30px 0;">Dear ${data.patientName},</p>

        <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">
          This is a friendly reminder about your upcoming appointment with our healthcare team.
        </p>

        <div style="background: #f8f9fc; padding: 25px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #4CAF50;">
          <h3 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 20px;">Appointment Details</h3>
          <div style="display: grid; gap: 12px;">
            <div><strong style="color: #2c3e50;">Doctor:</strong> <span style="color: #555;">${data.doctorName}</span></div>
            <div><strong style="color: #2c3e50;">Date:</strong> <span style="color: #555;">${data.appointmentDate}</span></div>
            <div><strong style="color: #2c3e50;">Time:</strong> <span style="color: #555;">${data.appointmentTime}</span></div>
            <div><strong style="color: #2c3e50;">Location:</strong> <span style="color: #555;">${data.location}</span></div>
            ${data.appointmentId ? `<div><strong style="color: #2c3e50;">Appointment ID:</strong> <span style="color: #555;">${data.appointmentId}</span></div>` : ''}
          </div>
        </div>

        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #2196F3;">
          <h4 style="margin: 0 0 10px 0; color: #1976d2;">Important Reminders</h4>
          <ul style="margin: 0; padding-left: 20px; color: #1976d2;">
            <li style="margin-bottom: 8px;">Please arrive 15 minutes early for check-in</li>
            <li style="margin-bottom: 8px;">Bring a valid photo ID and insurance card</li>
            <li style="margin-bottom: 8px;">Bring a list of current medications</li>
            <li>If you need to reschedule, please contact us as soon as possible</li>
          </ul>
        </div>

        ${
          data.rescheduleUrl || data.cancelUrl
            ? `
        <div style="text-align: center; margin: 40px 0;">
          ${data.rescheduleUrl ? `<a href="${data.rescheduleUrl}" style="display: inline-block; background: #4CAF50; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin: 0 10px 10px 0; font-weight: bold;">Reschedule Appointment</a>` : ''}
          ${data.cancelUrl ? `<a href="${data.cancelUrl}" style="display: inline-block; background: #f44336; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin: 0 10px 10px 0; font-weight: bold;">Cancel Appointment</a>` : ''}
        </div>
        `
            : ''
        }

        <p style="font-size: 16px; color: #555; margin: 30px 0 0 0;">
          If you have any questions or concerns, please don't hesitate to contact us. We look forward to seeing you!
        </p>
      </div>

      <div style="background: #f8f9fc; padding: 25px 30px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="margin: 0 0 10px 0; font-size: 16px; color: #333; font-weight: bold;">Best regards,</p>
        <p style="margin: 0 0 20px 0; font-size: 16px; color: #4CAF50; font-weight: bold;">${data.clinicName || 'Healthcare Team'}</p>
        <p style="margin: 0; font-size: 12px; color: #888;">This is an automated reminder. Please do not reply to this email.</p>
      </div>
    </body>
    </html>
  `;
}
