/**
 * WhatsApp Template Helpers
 * @module WhatsAppTemplates
 * @description Helper functions for formatting WhatsApp template messages
 *
 * Note: WhatsApp Business API uses pre-approved templates managed in Meta Business Manager.
 * These helpers format the parameters that are sent to the approved templates.
 */

/**
 * Formats OTP template parameters for WhatsApp
 * @param otp - OTP code
 * @param expiryMinutes - OTP expiry time in minutes
 * @returns Template components array
 */
export function formatOTPTemplateParams(
  otp: string,
  expiryMinutes: number
): Array<{
  type: string;
  parameters: Array<{ type: string; text: string }>;
}> {
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: otp },
        { type: 'text', text: `${expiryMinutes}` },
      ],
    },
  ];
}

type WhatsAppTemplateComponent = {
  type: string;
  parameters: Array<{ type: string; text: string }>;
  sub_type?: string;
  index?: string;
};

function buildDetailsButton(detailsUrl?: string): WhatsAppTemplateComponent[] {
  if (!detailsUrl) {
    return [];
  }

  return [
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: detailsUrl }],
    },
  ];
}

/**
 * Formats appointment confirmation template parameters for WhatsApp
 * @param patientName - Patient name
 * @param appointmentType - Appointment type label
 * @param doctorName - Doctor name
 * @param appointmentDate - Appointment date
 * @param appointmentTime - Appointment time
 * @param detailsUrl - Dynamic details URL for the CTA button
 * @returns Template components array
 */
export function formatAppointmentConfirmationTemplateParams(
  patientName: string,
  appointmentType: string,
  doctorName: string,
  appointmentDate: string,
  appointmentTime: string,
  detailsUrl?: string
): WhatsAppTemplateComponent[] {
  const components: WhatsAppTemplateComponent[] = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: patientName },
        { type: 'text', text: appointmentType },
        { type: 'text', text: doctorName },
        { type: 'text', text: appointmentDate },
        { type: 'text', text: appointmentTime },
      ],
    },
  ];

  components.push(...buildDetailsButton(detailsUrl));
  return components;
}

/**
 * Formats appointment reminder template parameters for WhatsApp
 * @param patientName - Patient name
 * @param appointmentType - Appointment type label
 * @param doctorName - Doctor name
 * @param appointmentDateTime - Combined appointment date/time
 * @param detailsUrl - Dynamic details URL for the CTA button
 * @returns Template components array
 */
export function formatAppointmentReminderTemplateParams(
  patientName: string,
  appointmentType: string,
  doctorName: string,
  appointmentDateTime: string,
  detailsUrl?: string
): WhatsAppTemplateComponent[] {
  const components: WhatsAppTemplateComponent[] = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: patientName },
        { type: 'text', text: appointmentType },
        { type: 'text', text: doctorName },
        { type: 'text', text: appointmentDateTime },
      ],
    },
  ];

  components.push(...buildDetailsButton(detailsUrl));
  return components;
}

/**
 * Formats prescription notification template parameters for WhatsApp
 * @param patientName - Patient name
 * @param doctorName - Doctor name
 * @param medicationDetails - Medication details
 * @param prescriptionUrl - Optional prescription URL
 * @returns Template components array
 */
export function formatPrescriptionNotificationTemplateParams(
  patientName: string,
  doctorName: string,
  medicationDetails: string,
  prescriptionUrl?: string
): Array<{
  type: string;
  parameters: Array<{ type: string; text: string }>;
}> {
  const components: Array<{
    type: string;
    parameters: Array<{ type: string; text: string }>;
  }> = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: patientName },
        { type: 'text', text: doctorName },
        { type: 'text', text: medicationDetails },
      ],
    },
  ];

  if (prescriptionUrl) {
    components.push({
      type: 'button',
      parameters: [{ type: 'text', text: prescriptionUrl }],
    });
  }

  return components;
}

/**
 * Example WhatsApp template structure documentation
 *
 * OTP Template Example:
 * Template Name: otp_verification
 * Template Body: "Your OTP code is {{1}} and is valid for {{2}} minutes. Please do not share this code with anyone."
 *
 * Appointment Confirmation Template Example:
 * Template Name: appointment_confirmation
 * Template Body: "Your {{2}} appointment with {{3}} is confirmed for {{4}} at {{5}}"
 * Button: "View details" -> {{1}}
 *
 * Appointment Reminder Template Example:
 * Template Name: appointment_reminder_2
 * Template Body: "Hello {{1}}, this is a reminder about your {{2}} appointment with Dr. {{3}} at {{4}}"
 * Button: "View details" -> {{1}}
 *
 * Prescription Notification Template Example:
 * Template Name: prescription_notification
 * Template Body: "Hello {{1}}, your prescription from Dr. {{2}} is ready. Medications: {{3}}"
 * Button: "View Prescription" -> {{1}}
 */
