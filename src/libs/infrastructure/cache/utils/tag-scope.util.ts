/**
 * Clinic scoping for COLLECTION tags.
 *
 * A collection tag is a bare word such as `appointments` or `prescriptions` (no `:`); it names
 * "every list of that kind", not one entity. Invalidating it globally meant one clinic's write
 * flushed every clinic's cached lists, so the hit rate collapsed as soon as several clinics were
 * busy. Entity tags (`appointment:<id>`, `user:<id>`, `clinic:<id>`) are already narrow and are
 * left alone.
 *
 * Registration (read side): an entry tagged `appointments` is ALSO indexed under
 *   - `clinic:<clinicId>:appointments` when the entry belongs to a clinic (the HTTP interceptor
 *     passes the validated clinic; service-level entries are scoped by their own `clinic:<id>`
 *     tag), or
 *   - `noclinic:appointments` when it belongs to none.
 * The bare tag is still registered, so existing global invalidations keep working.
 *
 * Invalidation (write side): a write that knows its clinic invalidates
 * `clinic:<clinicId>:<tag>` + `noclinic:<tag>` instead of the bare tag; without a clinic the
 * bare (global) tag is used, exactly as before.
 */

const CLINIC_TAG_PATTERN = /^clinic:([^:]+)$/;
export const NO_CLINIC_TAG_PREFIX = 'noclinic:';

export function isCollectionTag(tag: string): boolean {
  return tag.length > 0 && !tag.includes(':');
}

export function clinicCollectionTag(clinicId: string, tag: string): string {
  return `clinic:${clinicId}:${tag}`;
}

export function noClinicCollectionTag(tag: string): string {
  return `${NO_CLINIC_TAG_PREFIX}${tag}`;
}

/** The clinic named by an exact `clinic:<id>` tag in the list, if any. */
export function clinicFromTags(tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    const match = CLINIC_TAG_PATTERN.exec(tag);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** Tags an entry is indexed under (read side). De-duplicated, original order first. */
export function expandRegistrationTags(
  tags: readonly string[],
  clinicId: string | undefined = clinicFromTags(tags)
): string[] {
  const expanded = new Set<string>();
  for (const tag of tags) {
    if (!tag) continue;
    expanded.add(tag);
    if (isCollectionTag(tag)) {
      expanded.add(clinicId ? clinicCollectionTag(clinicId, tag) : noClinicCollectionTag(tag));
    }
  }
  return [...expanded];
}

/** Tags a write invalidates (write side). De-duplicated. */
export function scopeInvalidationTags(
  tags: readonly string[],
  clinicId: string | undefined
): string[] {
  const scoped = new Set<string>();
  for (const tag of tags) {
    if (!tag) continue;
    if (clinicId && isCollectionTag(tag)) {
      scoped.add(clinicCollectionTag(clinicId, tag));
      scoped.add(noClinicCollectionTag(tag));
    } else {
      scoped.add(tag);
    }
  }
  return [...scoped];
}

const SCOPED_COLLECTION_TAG = /^(?:clinic:[^:]+|noclinic):([^:]+)$/;

/**
 * Other index sets that hold the same members as `tag` (see expandRegistrationTags), so deleted
 * members can be dropped from them too. Without this, the bare set of a tag that is now only
 * invalidated per clinic would collect dead members forever (its TTL is refreshed on every
 * registration). Per-clinic sets cannot be enumerated from a bare tag; they shed dead members
 * on their own next invalidation.
 */
export function companionIndexTags(tag: string): string[] {
  const scoped = SCOPED_COLLECTION_TAG.exec(tag);
  if (scoped?.[1]) return [scoped[1]];
  return isCollectionTag(tag) ? [noClinicCollectionTag(tag)] : [];
}
