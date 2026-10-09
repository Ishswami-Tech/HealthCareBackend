import type {
  FhirBundle,
  FhirBundleEntry,
  FhirClinicalResource,
  FhirOperationOutcome,
  FhirOutcomeEntry,
} from '@services/fhir/fhir.types';

function toEntry<R extends FhirClinicalResource>(resource: R, mode?: 'match'): FhirBundleEntry<R> {
  return {
    fullUrl: `${resource.resourceType}/${resource.id}`,
    resource,
    ...(mode ? { search: { mode } } : {}),
  };
}

/**
 * `$everything`: an unordered collection of everything we hold for one patient. When
 * `truncation` is given (visits were capped) the warning OperationOutcome is appended as an
 * entry and `total` is set to the number of resource entries (the outcome is not counted).
 */
export function buildCollectionBundle(
  resources: readonly FhirClinicalResource[],
  timestamp: Date,
  truncation?: FhirOperationOutcome
): FhirBundle {
  const outcome: FhirOutcomeEntry[] = truncation ? [{ resource: truncation }] : [];
  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: timestamp.toISOString(),
    ...(truncation ? { total: resources.length } : {}),
    entry: [...resources.map(resource => toEntry(resource)), ...outcome],
  };
}

/**
 * Result of a type-level search: `total` is the number of matches (resource entries). A
 * truncation warning is appended as an entry with `search.mode` 'outcome' and is not counted.
 */
export function buildSearchsetBundle<R extends FhirClinicalResource>(
  resources: readonly R[],
  timestamp: Date,
  truncation?: FhirOperationOutcome
): FhirBundle<R> {
  const outcome: FhirOutcomeEntry[] = truncation
    ? [{ resource: truncation, search: { mode: 'outcome' } }]
    : [];
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    timestamp: timestamp.toISOString(),
    total: resources.length,
    entry: [...resources.map(resource => toEntry(resource, 'match')), ...outcome],
  };
}
