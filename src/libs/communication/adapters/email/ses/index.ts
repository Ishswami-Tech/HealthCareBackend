/**
 * AWS SES Module Exports
 * ======================
 * Centralized exports for all AWS SES-related services and adapters
 *
 * @module SES
 * @description AWS SES email provider module
 */

// Adapter
export * from './ses-email.adapter';

// Webhooks
export * from './webhooks/ses-webhook.service';
export * from './webhooks/ses-webhook.controller';
