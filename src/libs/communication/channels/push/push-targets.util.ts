/**
 * Which device tokens a push for one user goes to, and how the per-device results fold into one
 * result (pure, no Nest imports).
 *
 * Callers of CommunicationService usually know only the recipient's user id. The push channel
 * used to require an explicit device token, so queue call-in, prescription and billing pushes
 * failed with "No device token provided" even when the patient's phone had registered a token.
 */

import type { PushNotificationResult } from '@core/types/notification.types';

/** Reason recorded when the user has no active device to push to. Not a provider failure. */
export const NO_REGISTERED_DEVICE = 'no registered device';

export interface PushTargetToken {
  readonly token: string;
  readonly isActive: boolean;
}

/** The user's active tokens to send to, without repeats or blanks. */
export function resolvePushTargets(userTokens: readonly PushTargetToken[]): string[] {
  const candidates = userTokens.filter(token => token.isActive).map(token => token.token.trim());
  return Array.from(new Set(candidates.filter(Boolean)));
}

/** True when a push result means "nothing to send to", which callers record as SKIPPED. */
export function isNoDeviceResult(result: PushNotificationResult): boolean {
  return !result.success && result.error === NO_REGISTERED_DEVICE;
}

/** Fold per-device results: delivered when any device accepted it. */
export function summarizePushResults(
  results: readonly PushNotificationResult[]
): PushNotificationResult {
  if (results.length === 0) {
    return { success: false, error: NO_REGISTERED_DEVICE, successCount: 0, failureCount: 0 };
  }

  const successCount = results.filter(result => result.success).length;
  const failureCount = results.length - successCount;
  const providers = Array.from(
    new Set(
      results.map(result => result.provider).filter((provider): provider is string => !!provider)
    )
  );
  const firstMessageId = results.find(result => result.success && result.messageId)?.messageId;
  const firstError = results.find(result => !result.success && result.error)?.error;

  return {
    success: successCount > 0,
    successCount,
    failureCount,
    ...(firstMessageId ? { messageId: firstMessageId } : {}),
    ...(successCount === 0 ? { error: firstError || 'Push delivery failed' } : {}),
    ...(providers.length > 0 ? { provider: providers.join(',') } : {}),
    usedFallback: results.some(result => result.usedFallback === true),
    results: results.map(result => ({
      success: result.success,
      ...(result.messageId ? { messageId: result.messageId } : {}),
      ...(result.error ? { error: result.error } : {}),
    })),
  };
}
