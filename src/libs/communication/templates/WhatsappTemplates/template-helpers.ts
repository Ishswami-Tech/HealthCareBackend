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
 * Matches the approved 5-parameter authentication template:
 * "This OTP code is for {{1}} {{2}} at {{3}}. OTP: {{4}}. Do not share it with anyone, even to {{5}}."
 * @param purpose - OTP purpose label, such as verifying, resetting, or creating
 * @param targetLabel - Target being verified, such as phone no, account, or password
 * @param merchantName - Clinic or merchant name
 * @param otp - OTP code
 * @param supportLabel - Support label used in the warning sentence
 * @returns Template components array
 */
export function formatOTPTemplateParams(
  purpose: string,
  targetLabel: string,
  merchantName: string,
  otp: string,
  supportLabel: string = 'Support',
  buttonUrlSuffix?: string
): WhatsAppTemplateComponent[] {
  const components: WhatsAppTemplateComponent[] = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: normalizeTemplateText(purpose, 'verifying') },
        { type: 'text', text: normalizeTemplateText(targetLabel, 'phone no') },
        {
          type: 'text',
          text: sanitizeTemplateText(merchantName, 'Clinic'),
        },
        { type: 'text', text: normalizeTemplateText(otp, '000000') },
        { type: 'text', text: normalizeTemplateText(supportLabel, 'Support') },
      ],
    },
  ];

  components.push(...buildDetailsButton(buttonUrlSuffix));
  return components;
}

type WhatsAppTemplateComponent = {
  type: string;
  parameters: Array<{ type: string; text: string }>;
  sub_type?: string;
  index?: number;
};

function normalizeTemplateText(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return fallback;
}

function sanitizeTemplateText(value: unknown, fallback: string): string {
  const normalized = normalizeTemplateText(value, fallback);
  const withoutUrlLikeCharacters = normalized
    .replace(/[./\\?%#:]+/g, ' ')
    .replace(/@/g, ' ')
    .replace(/\bhttps?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return withoutUrlLikeCharacters || fallback;
}

function normalizeUrlButtonValue(detailsUrl?: string): string | undefined {
  if (!detailsUrl) {
    return undefined;
  }

  const trimmed = detailsUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = `${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/^\/+/, '');
    return normalizedPath || undefined;
  } catch {
    return (
      trimmed
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/^\/+/, '')
        .trim() || undefined
    );
  }
}

function buildDetailsButton(detailsUrl?: string): WhatsAppTemplateComponent[] {
  const normalizedUrl = normalizeUrlButtonValue(detailsUrl);
  if (!normalizedUrl) {
    return [];
  }

  return [
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: normalizedUrl }],
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
        { type: 'text', text: normalizeTemplateText(patientName, 'Patient') },
        { type: 'text', text: normalizeTemplateText(appointmentType, 'in-person') },
        { type: 'text', text: normalizeTemplateText(doctorName, 'Doctor') },
        { type: 'text', text: normalizeTemplateText(appointmentDate, 'TBD') },
        { type: 'text', text: normalizeTemplateText(appointmentTime, 'TBD') },
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
        { type: 'text', text: normalizeTemplateText(patientName, 'Patient') },
        { type: 'text', text: normalizeTemplateText(appointmentType, 'in-person') },
        { type: 'text', text: normalizeTemplateText(doctorName, 'Doctor') },
        { type: 'text', text: normalizeTemplateText(appointmentDateTime, 'TBD') },
      ],
    },
  ];

  components.push(...buildDetailsButton(detailsUrl));
  return components;
}

/**
 * Formats payment receipt template parameters for WhatsApp
 * @param recipientName - Recipient name
 * @param receiptNumber - Receipt number
 * @param amount - Receipt amount
 * @param paymentDate - Paid on / payment date
 * @param detailsUrl - Dynamic details URL for the CTA button
 * @returns Template components array
 */
export function formatPaymentReceiptTemplateParams(
  recipientName: string,
  receiptNumber: string,
  amount: string,
  paymentDate: string,
  detailsUrl?: string
): WhatsAppTemplateComponent[] {
  const components: WhatsAppTemplateComponent[] = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: normalizeTemplateText(recipientName, 'Patient') },
        { type: 'text', text: normalizeTemplateText(receiptNumber, 'Receipt') },
        { type: 'text', text: normalizeTemplateText(amount, '0') },
        { type: 'text', text: normalizeTemplateText(paymentDate, 'TBD') },
      ],
    },
  ];

  components.push(...buildDetailsButton(detailsUrl));
  return components;
}

/**
 * Example WhatsApp template structure documentation
 *
 * OTP Template Example:
 * Template Name: verify_account
 * Template Body: "This OTP code is for {{1}} {{2}} at {{3}}. OTP: {{4}}. Do not share it with anyone, even to {{5}}, or they'll be able to access your account."
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
 * Payment Receipt Template Example:
 * Template Name: payment_receipt
 * Template Body: "Hello {{1}}, your receipt {{2}} for {{3}} has been generated. Paid On: {{4}}"
 * Button: "View details" -> {{1}}
 *
 */
