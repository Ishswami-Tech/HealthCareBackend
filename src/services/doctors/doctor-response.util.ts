/**
 * Prisma `select` allowlists for doctor profile reads.
 *
 * `getDoctorProfile` / `getAllDoctors` used to `include` the full `User` row (password
 * hash, OAuth ids, last-login IP/device, ...) and, worse, the full nested `Clinic` row
 * through `doctor.clinics[].clinic` (db_connection_string, databaseName, databaseStatus).
 * Both leaked straight into `GET /doctors` and `GET /doctors/:id` — and into the `profile`
 * field of the `PATCH /doctors/:id` response, which reuses the same read — for every role
 * that can call them, including PATIENT. These `select` allowlists are the only fields a
 * doctor-profile response may carry; a new column must be added here (and to the matching
 * DTO) before it can ever reach a doctor-profile response.
 */

/** Safe `Clinic` fields for a doctor's own clinic-affiliation list. No infrastructure/secret columns. */
export const DOCTOR_PROFILE_CLINIC_SELECT = {
  id: true,
  clinicId: true,
  name: true,
  address: true,
  phone: true,
  email: true,
  app_name: true,
  whatsappName: true,
  isActive: true,
  subdomain: true,
  logo: true,
  website: true,
  description: true,
  timezone: true,
  currency: true,
  language: true,
  abdmHipId: true,
} as const;

/** Safe `Doctor` fields, including the clinic affiliations with the sanitised clinic shape above. */
export const DOCTOR_PROFILE_DOCTOR_SELECT = {
  id: true,
  userId: true,
  specialization: true,
  experience: true,
  qualification: true,
  consultationFee: true,
  rating: true,
  isAvailable: true,
  workingHours: true,
  videoConsultationFee: true,
  slotDurationMinutes: true,
  videoConsultationEnabled: true,
  inPersonConsultationEnabled: true,
  licenseNumber: true,
  languages: true,
  education: true,
  certifications: true,
  localizedProfile: true,
  createdAt: true,
  abdmHprId: true,
  clinics: {
    select: {
      doctorId: true,
      clinicId: true,
      startTime: true,
      endTime: true,
      locationId: true,
      videoDoctorFee: true,
      inPersonDoctorFee: true,
      clinic: { select: DOCTOR_PROFILE_CLINIC_SELECT },
    },
  },
} as const;

/** Safe `User` fields for a doctor profile read. Never `password` or any other auth/device field. */
export const DOCTOR_PROFILE_USER_SELECT = {
  id: true,
  userid: true,
  firstName: true,
  lastName: true,
  name: true,
  email: true,
  phone: true,
  phoneVerified: true,
  profilePicture: true,
  role: true,
  gender: true,
  dateOfBirth: true,
  address: true,
  city: true,
  state: true,
  country: true,
  zipCode: true,
  isVerified: true,
  isActive: true,
  isProfileComplete: true,
  primaryClinicId: true,
  createdAt: true,
  updatedAt: true,
  doctor: { select: DOCTOR_PROFILE_DOCTOR_SELECT },
} as const;
