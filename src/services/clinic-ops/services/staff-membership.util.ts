/**
 * Who counts as staff of a clinic (staff directory, staff detail). Pure, framework-free.
 *
 * A staff user is linked to a clinic in several places, depending on how the account was made:
 * the `_UserClinics` join, the role table of the role (Doctor -> DoctorClinic, Receptionist ->
 * clinicId / _ReceptionistsAtClinic, Pharmacist, ClinicAdmin, Nurse, Therapist -> clinicId), an
 * active assistant-doctor coverage row, an active RBAC `UserRole` scoped to the clinic, or the
 * user's `primaryClinicId`. Listing only `_UserClinics` left doctors and pharmacists out.
 */

/** The `User` where-clause matching every user linked to `clinicId` by any of the paths above. */
export function staffMembershipWhere(clinicId: string): Record<string, unknown> {
  return {
    OR: [
      { clinics: { some: { id: clinicId } } },
      { primaryClinicId: clinicId },
      { doctor: { is: { clinics: { some: { clinicId } } } } },
      {
        doctor: {
          is: { assistantCoverageAssignments: { some: { clinicId, isActive: true } } },
        },
      },
      {
        receptionists: {
          is: {
            OR: [{ clinicId }, { ReceptionistsAtClinic: { some: { A: clinicId } } }],
          },
        },
      },
      { pharmacist: { is: { clinicId } } },
      { clinicAdmins: { is: { clinicId } } },
      { nurse: { is: { clinicId } } },
      { therapist: { is: { clinicId } } },
      { userRoles: { some: { clinicId, isActive: true } } },
    ],
  };
}

/**
 * The staff directory query: clinic membership, a role (one, or any staff role) and an optional
 * name search, combined with AND so the membership OR never widens the role or search filter.
 */
export function staffDirectoryWhere(
  clinicId: string,
  staffRoles: readonly string[],
  filter: { role?: string; q?: string } = {}
): Record<string, unknown> {
  const role = filter.role?.toUpperCase();
  const and: Record<string, unknown>[] = [
    staffMembershipWhere(clinicId),
    { role: role ? role : { in: [...staffRoles] } },
  ];
  const q = filter.q?.trim();
  if (q) and.push({ name: { contains: q, mode: 'insensitive' } });
  return { AND: and };
}

/** Keeps the first row of each user id (order kept): a user linked twice is listed once. */
export function dedupeByUserId<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}

/**
 * The spellings a phone may be stored under (`+919876543210`, `919876543210`, `9876543210`), so a
 * typed number finds the existing account whichever form either side used. India (+91) default.
 */
export function phoneLookupVariants(phone: string): string[] {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return [];
  const variants = new Set<string>([trimmed, digits, `+${digits}`]);
  if (digits.length === 10) {
    variants.add(`91${digits}`);
    variants.add(`+91${digits}`);
  }
  if (digits.length === 12 && digits.startsWith('91')) variants.add(digits.slice(2));
  return [...variants];
}
