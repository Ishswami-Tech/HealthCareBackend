/**
 * Unsubscribe Footer Helper
 * ===========================
 * Generates unsubscribe footer for email templates
 * Follows AWS SES best practices for unsubscribe links
 *
 * @module UnsubscribeFooter
 * @description Unsubscribe footer generator
 */

/**
 * Generate unsubscribe footer HTML
 * @param unsubscribeUrl - Unsubscribe URL
 * @returns HTML footer with unsubscribe link
 */
export function generateUnsubscribeFooter(unsubscribeUrl: string): string {
  return `
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777; text-align: center;">
      <p style="margin: 0 0 10px 0;">
        <a href="${unsubscribeUrl}" style="color: #777; text-decoration: underline;">
          Unsubscribe from these emails
        </a>
      </p>
      <p style="margin: 0;">
        This is an automated message, please do not reply to this email.
      </p>
    </div>
  `;
}

/**
 * Generate unsubscribe footer with custom message
 * @param unsubscribeUrl - Unsubscribe URL
 * @param message - Custom message (optional)
 * @returns HTML footer with unsubscribe link
 */
export function generateUnsubscribeFooterWithMessage(
  unsubscribeUrl: string,
  message?: string
): string {
  const defaultMessage = 'This is an automated message, please do not reply to this email.';
  return `
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #777; text-align: center;">
      <p style="margin: 0 0 10px 0;">
        <a href="${unsubscribeUrl}" style="color: #777; text-decoration: underline;">
          Unsubscribe from these emails
        </a>
      </p>
      <p style="margin: 0;">
        ${message || defaultMessage}
      </p>
    </div>
  `;
}
