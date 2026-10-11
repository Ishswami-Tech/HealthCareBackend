import type {
  FhirCodeableConcept,
  FhirQuantity,
  FhirReference,
  FhirResourceType,
} from '@services/fhir/fhir.types';

export function reference(type: FhirResourceType, id: string, display?: string): FhirReference {
  return display ? { reference: `${type}/${id}`, display } : { reference: `${type}/${id}` };
}

export function quantity(
  value: number,
  units: { unit: string; code: string },
  system: string
): FhirQuantity {
  return { value, unit: units.unit, system, code: units.code };
}

export function textConcept(text: string): FhirCodeableConcept {
  return { text };
}

/** Trimmed string, or null when blank/absent. */
export function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** ISO-8601 instant for a Date or ISO string; undefined when absent or unparseable. */
export function toInstant(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** FHIR `date` (YYYY-MM-DD, UTC) for a Date or ISO string. */
export function toFhirDate(value: Date | string | null | undefined): string | undefined {
  const instant = toInstant(value);
  return instant ? instant.slice(0, 10) : undefined;
}

export function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
