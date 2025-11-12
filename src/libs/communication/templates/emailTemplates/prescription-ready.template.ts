/**
 * Prescription Ready Email Template
 * @module EmailTemplates
 */

import type { PrescriptionTemplateData } from '@communication/channels/email/email-templates.service';

/**
 * Generates prescription ready email template
 * @param data - Prescription template data
 * @returns HTML email template
 */
export function generatePrescriptionReadyTemplate(data: PrescriptionTemplateData): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Prescription Ready</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%); padding: 30px; text-align: center; color: white; border-radius: 10px 10px 0 0;">
        <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Prescription Ready</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Your prescription is ready for pickup</p>
      </div>

      <div style="background: white; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="font-size: 18px; color: #333; margin: 0 0 30px 0;">Dear ${data.patientName},</p>

        <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">
          Great news! Your prescription is ready for pickup at ${data.pharmacyName || 'our pharmacy'}.
        </p>

        <div style="background: #fff3e0; padding: 25px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #FF9800;">
          <h3 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 20px;">Prescription Details</h3>
          <div style="margin-bottom: 15px;">
            <strong style="color: #2c3e50;">Prescription ID:</strong> <span style="color: #555;">${data.prescriptionId}</span>
          </div>
          <div style="margin-bottom: 20px;">
            <strong style="color: #2c3e50;">Prescribed by:</strong> <span style="color: #555;">${data.doctorName}</span>
          </div>

          <div style="margin-bottom: 10px;">
            <strong style="color: #2c3e50;">Medications:</strong>
          </div>
          <ul style="margin: 5px 0 0 20px; padding: 0; color: #555;">
            ${data.medications.map(medication => `<li style="margin-bottom: 5px; padding: 5px 0; border-bottom: 1px solid #eee;">${medication}</li>`).join('')}
          </ul>
        </div>

        ${
          data.pharmacyName || data.pharmacyAddress
            ? `
        <div style="background: #e8f5e9; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #4CAF50;">
          <h4 style="margin: 0 0 15px 0; color: #2e7d32;">Pickup Location</h4>
          ${data.pharmacyName ? `<div style="margin-bottom: 8px;"><strong>Pharmacy:</strong> ${data.pharmacyName}</div>` : ''}
          ${data.pharmacyAddress ? `<div><strong>Address:</strong> ${data.pharmacyAddress}</div>` : ''}
        </div>
        `
            : ''
        }

        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #2196F3;">
          <h4 style="margin: 0 0 10px 0; color: #1976d2;">Pickup Requirements</h4>
          <ul style="margin: 0; padding-left: 20px; color: #1976d2;">
            <li style="margin-bottom: 8px;">Please bring a valid photo ID</li>
            <li style="margin-bottom: 8px;">Insurance card (if applicable)</li>
            <li>Payment method for any copay or deductible</li>
          </ul>
          ${data.pickupInstructions ? `<p style="margin: 15px 0 0 0; color: #1976d2;"><strong>Special Instructions:</strong> ${data.pickupInstructions}</p>` : ''}
        </div>

        <div style="text-align: center; margin: 40px 0;">
          <div style="background: #f44336; color: white; padding: 15px; border-radius: 5px; display: inline-block;">
            <strong>⏰ Please pickup within 10 days</strong>
          </div>
        </div>

        <p style="font-size: 16px; color: #555; margin: 30px 0 0 0;">
          If you have any questions about your medications or the pickup process, please don't hesitate to contact us.
        </p>
      </div>

      <div style="background: #f8f9fc; padding: 25px 30px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="margin: 0 0 10px 0; font-size: 16px; color: #333; font-weight: bold;">Best regards,</p>
        <p style="margin: 0 0 20px 0; font-size: 16px; color: #FF9800; font-weight: bold;">${data.clinicName || 'Healthcare Pharmacy Team'}</p>
        <p style="margin: 0; font-size: 12px; color: #888;">This is an automated notification. Please do not reply to this email.</p>
      </div>
    </body>
    </html>
  `;
}
