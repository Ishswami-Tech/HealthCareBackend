/**
 * What makes two medicines of one clinic "the same" for the duplicate check on create / edit:
 * the name (the strength is part of it, e.g. "Paracetamol 500mg") compared case-insensitively
 * with surrounding / repeated spaces ignored, plus the dosage form (`category`: TABLET, SYRUP ...).
 */

/** Trims and collapses inner whitespace: "  Paracetamol   500mg " -> "Paracetamol 500mg". */
export function normalizeMedicineName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** The dosage form for comparison: upper-cased and trimmed, null when not given. */
export function normalizeMedicineForm(form: string | null | undefined): string | null {
  const value = typeof form === 'string' ? form.trim().toUpperCase() : '';
  return value ? value : null;
}

export function duplicateMedicineMessage(name: string, form: string | null): string {
  const label = form
    ? `${normalizeMedicineName(name)} (${form.toLowerCase()})`
    : normalizeMedicineName(name);
  return `A medicine named "${label}" already exists in this clinic. Edit that medicine or its stock instead.`;
}
