/**
 * WhatsApp Suppression Database Types
 * Strict type definitions for Prisma WhatsApp suppression operations
 * Replaces unsafe `as unknown as` assertions with proper types
 */

import type { PrismaTransactionClient } from './database.types';

/**
 * WhatsAppSuppressionList database model structure
 */
export interface WhatsAppSuppressionDbModel {
  id: string;
  phoneNumber: string;
  reason: 'BOUNCE' | 'COMPLAINT' | 'UNSUBSCRIBE' | 'MANUAL';
  source: 'SES' | 'ZEPTOMAIL' | 'USER_ACTION' | 'ADMIN' | 'SYSTEM';
  userId: string | null;
  clinicId: string | null;
  messageId: string | null;
  description: string | null;
  metadata: unknown;
  suppressedAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * WhatsApp Suppression Delegate Interface
 */
export interface WhatsAppSuppressionDelegate {
  findFirst: (args: {
    where: {
      phoneNumber: string;
      isActive?: boolean;
      clinicId?: string | null;
      reason?: 'BOUNCE' | 'COMPLAINT' | 'UNSUBSCRIBE' | 'MANUAL';
      OR?: Array<{ expiresAt: null } | { expiresAt: { gt: Date } }>;
    };
  }) => Promise<WhatsAppSuppressionDbModel | null>;
  update: (args: {
    where: { id: string };
    data: {
      isActive: boolean;
      suppressedAt: Date;
      messageId?: string | null;
      description?: string | null;
      metadata?: unknown;
      updatedAt: Date;
    };
  }) => Promise<WhatsAppSuppressionDbModel>;
  create: (args: {
    data: {
      phoneNumber: string;
      reason: 'BOUNCE' | 'COMPLAINT' | 'UNSUBSCRIBE' | 'MANUAL';
      source: 'SES' | 'ZEPTOMAIL' | 'USER_ACTION' | 'ADMIN' | 'SYSTEM';
      userId: string | null;
      clinicId: string | null;
      messageId: string | null;
      description: string | null;
      metadata?: unknown;
      isActive: boolean;
    };
  }) => Promise<WhatsAppSuppressionDbModel>;
  updateMany: (args: {
    where: {
      phoneNumber: string;
      clinicId: string | null;
      isActive: boolean;
    };
    data: {
      isActive: boolean;
      updatedAt: Date;
    };
  }) => Promise<{ count: number }>;
}

/**
 * Type-safe accessor for whatsappSuppressionList delegate
 * Prisma guarantees this delegate exists at runtime
 */
export function getWhatsAppSuppressionDelegate(
  client: PrismaTransactionClient
): WhatsAppSuppressionDelegate {
  if (
    typeof client !== 'object' ||
    client === null ||
    !('whatsappSuppressionList' in client) ||
    typeof (client as { whatsappSuppressionList: unknown }).whatsappSuppressionList !== 'object'
  ) {
    throw new Error('Prisma client does not have whatsappSuppressionList delegate');
  }
  return (
    client as unknown as {
      whatsappSuppressionList: WhatsAppSuppressionDelegate;
    }
  ).whatsappSuppressionList;
}
