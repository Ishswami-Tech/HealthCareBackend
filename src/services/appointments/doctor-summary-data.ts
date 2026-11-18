/**
 * Loads what doctor-summary-schedule.util.ts needs for one IST day: each doctor-clinic pair
 * with its stored schedule layers (doctor hours, location hours, clinic settings) and the day's
 * active doctor_day_availability overrides. Shared by the per-minute summary scheduler and the
 * booking listener, so both read the hours the same way.
 */

import type { DatabaseService } from '@infrastructure/database';
import { IST_TIMEZONE } from '@utils/date-time.util';
import type { Prisma } from '@infrastructure/database/prisma/generated/client';
import type {
  DoctorSummaryOverride,
  DoctorSummaryPair,
} from '@services/appointments/doctor-summary-schedule.util';

const istHhMm = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** DoctorClinic.startTime / endTime (a time on 1970-01-01) as HH:MM IST, like the slot grid. */
function legacyTime(value: Date | null): string | null {
  return value && !Number.isNaN(value.getTime()) ? istHhMm.format(value) : null;
}

export async function loadDoctorSummaryInputs(
  database: Pick<DatabaseService, 'executeHealthcareRead'>,
  dateKey: string,
  scope: { doctorId?: string; clinicId?: string } = {}
): Promise<{ pairs: DoctorSummaryPair[]; overrides: DoctorSummaryOverride[] }> {
  const where = {
    ...(scope.doctorId ? { doctorId: scope.doctorId } : {}),
    ...(scope.clinicId ? { clinicId: scope.clinicId } : {}),
  };
  return await database.executeHealthcareRead(async client => {
    const prisma = client as unknown as Prisma.TransactionClient;
    const associations = await prisma.doctorClinic.findMany({
      where: { ...where, clinic: { isActive: true, deletedAt: null } },
      select: {
        doctorId: true,
        clinicId: true,
        locationId: true,
        startTime: true,
        endTime: true,
        doctor: { select: { userId: true, workingHours: true } },
        location: { select: { workingHours: true } },
        clinic: {
          select: {
            settings: true,
            locations: { where: { isActive: true, deletedAt: null }, select: { id: true } },
          },
        },
      },
    });
    // `date` is a DATE column: the IST day key compared on its UTC calendar date.
    const overrides = await prisma.doctorDayAvailability.findMany({
      where: { ...where, date: new Date(`${dateKey}T00:00:00.000Z`), deletedAt: null },
      select: { doctorId: true, clinicId: true, locationId: true, sessions: true },
    });
    return {
      pairs: associations.map(a => ({
        doctorId: a.doctorId,
        doctorUserId: a.doctor.userId,
        clinicId: a.clinicId,
        locationId: a.locationId,
        doctorWorkingHours: a.doctor.workingHours,
        locationWorkingHours: a.location?.workingHours ?? null,
        clinicSettings: a.clinic.settings,
        legacyStart: legacyTime(a.startTime),
        legacyEnd: legacyTime(a.endTime),
        clinicLocationIds: a.clinic.locations.map(location => location.id),
      })),
      overrides,
    };
  });
}
