/**
 * Pure helpers of the in-person queue maintenance cron (InPersonQueueMaintenanceService).
 */

/**
 * Clinic ids of the day's live doctor lists, read from their cache keys
 * (`[prefix:]queue:clinic:<clinicId>:<doctorId>:<day>`). The cron also reconciles a clinic that
 * has a list but no live arrival in the database any more: that is exactly the clinic whose list
 * holds orphans (an entry whose appointment was deleted or closed) that must be dropped.
 */
export function clinicIdsFromQueueKeys(keys: readonly string[], day: string): string[] {
  const clinicIds = new Set<string>();
  for (const key of keys) {
    const parts = key.split(':');
    const at = parts.indexOf('queue');
    if (at < 0 || parts[at + 1] !== 'clinic' || parts.length !== at + 5) continue;
    if (parts[at + 4] !== day) continue;
    const clinicId = parts[at + 2];
    if (clinicId) clinicIds.add(clinicId);
  }
  return [...clinicIds];
}
