/**
 * Appointment Confirmation Email Template
 * @module EmailTemplates
 */

import { generateUnsubscribeFooter } from './unsubscribe-footer';
import type { AppointmentTemplateData } from '@core/types/communication.types';

function safeText(value: string | undefined, fallback: string): string {
  return value && value.trim() ? value.trim() : fallback;
}

/**
 * Generates appointment confirmation email template
 * @param data - Appointment template data
 * @param unsubscribeUrl - Optional unsubscribe URL (will be added automatically if not provided)
 * @returns HTML email template
 */
export function generateAppointmentConfirmationTemplate(
  data: AppointmentTemplateData,
  unsubscribeUrl?: string
): string {
  const appointmentType = safeText(data.appointmentType, 'appointment');
  const patientName = safeText(data.patientName, 'there');
  const doctorName = safeText(data.doctorName, 'Doctor');
  const clinicName = safeText(data.clinicName, 'Healthcare Clinic');
  const location = safeText(data.location, clinicName);

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Appointment Confirmed</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #2f855a 0%, #48bb78 100%); padding: 30px; text-align: center; color: white; border-radius: 10px 10px 0 0;">
        <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Appointment Confirmed</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Your visit is booked and ready</p>
      </div>

      <div style="background: white; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="font-size: 18px; color: #333; margin: 0 0 30px 0;">Hello ${patientName},</p>

        <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">
          Your ${appointmentType} appointment with ${doctorName} has been confirmed.
        </p>

        <div style="background: #f8f9fc; padding: 25px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #2f855a;">
          <h3 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 20px;">Appointment Details</h3>
          <div style="display: grid; gap: 12px;">
            <div><strong style="color: #2c3e50;">Type:</strong> <span style="color: #555;">${appointmentType}</span></div>
            <div><strong style="color: #2c3e50;">Doctor:</strong> <span style="color: #555;">${doctorName}</span></div>
            <div><strong style="color: #2c3e50;">Date:</strong> <span style="color: #555;">${data.appointmentDate}</span></div>
            <div><strong style="color: #2c3e50;">Time:</strong> <span style="color: #555;">${data.appointmentTime}</span></div>
            <div><strong style="color: #2c3e50;">Location:</strong> <span style="color: #555;">${location}</span></div>
            ${data.appointmentId ? `<div><strong style="color: #2c3e50;">Appointment ID:</strong> <span style="color: #555;">${data.appointmentId}</span></div>` : ''}
          </div>
        </div>

        ${
          data.detailsUrl
            ? `
        <div style="text-align: center; margin: 40px 0;">
          <a href="${data.detailsUrl}" style="display: inline-block; background: #2f855a; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Appointment Details</a>
        </div>
        `
            : ''
        }

        <p style="font-size: 16px; color: #555; margin: 30px 0 0 0;">
          Please open your appointment details in the app for location or join link.
        </p>
      </div>

      <div style="background: #f8f9fc; padding: 25px 30px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="margin: 0 0 10px 0; font-size: 16px; color: #333; font-weight: bold;">Best regards,</p>
        <p style="margin: 0 0 20px 0; font-size: 16px; color: #2f855a; font-weight: bold;">${clinicName}</p>
        ${unsubscribeUrl ? generateUnsubscribeFooter(unsubscribeUrl) : '<p style="margin: 0; font-size: 12px; color: #888;">This is an automated confirmation. Please do not reply to this email.</p>'}
      </div>
    </body>
    </html>
  `;
}
