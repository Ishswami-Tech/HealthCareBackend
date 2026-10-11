import { CASE_SHEET_OPTION_CODES } from './case-sheet-codes.generated';

/**
 * Stable codes for the Ayurvedic case-sheet exam options.
 *
 * Findings are stored with the option's display label (see classical_exam_findings.selectedOptions),
 * which changes whenever a label is corrected or translated. These codes give every option an
 * identifier that does not, for exchange formats such as FHIR. Codes are derived, not stored: the
 * stored label is looked up here at read time, so no data migration is needed.
 *
 * This is the clinic's own CodeSystem. It is deliberately not presented as NAMASTE, ICD-11 TM2 or
 * SNOMED CT: mapping these options to those licensed code tables is a separate, reviewed step.
 */
export const CASE_SHEET_CODE_SYSTEM = 'urn:ishswami-healthcare:codesystem:case-sheet';

const has = (table: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(table, key);

/** Code of an exam category (its stable key), or null when the category is not in the catalog. */
export function categoryCode(examType: string, categoryKey: string): string | null {
  if (!has(CASE_SHEET_OPTION_CODES, examType)) return null;
  const categories = CASE_SHEET_OPTION_CODES[examType] ?? {};
  return has(categories, categoryKey) ? categoryKey : null;
}

/** Code of a stored option within its category, or null for text that is not a catalog option. */
export function optionCode(
  examType: string,
  categoryKey: string,
  storedOption: string
): string | null {
  if (!has(CASE_SHEET_OPTION_CODES, examType)) return null;
  const categories = CASE_SHEET_OPTION_CODES[examType] ?? {};
  if (!has(categories, categoryKey)) return null;
  const options = categories[categoryKey] ?? {};
  return has(options, storedOption) ? (options[storedOption] ?? null) : null;
}
