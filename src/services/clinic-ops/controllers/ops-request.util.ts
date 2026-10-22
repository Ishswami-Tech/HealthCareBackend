import { BadRequestException } from '@nestjs/common';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { Role } from '@core/types/enums.types';
import type { OpsActor } from '../services/ops-db.service';

/** Tenant isolation: the clinic always comes from the guard, never from the body. */
export function clinicIdOf(req: ClinicAuthenticatedRequest): string {
  const clinicId = req.clinicContext?.clinicId;
  if (!clinicId) throw new BadRequestException('Clinic context is required');
  return clinicId;
}

export function actorOf(req: ClinicAuthenticatedRequest): OpsActor {
  return {
    userId: String(req.user?.sub ?? req.user?.id ?? ''),
    role: String(req.user?.role ?? ''),
  };
}

/** Everybody who works at the clinic (no patients). */
export const ALL_STAFF_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.PHARMACIST,
  Role.NURSE,
  Role.THERAPIST,
  Role.COUNSELOR,
  Role.LAB_TECHNICIAN,
  Role.NUTRITIONIST,
  Role.FINANCE_BILLING,
  Role.SUPPORT_STAFF,
  Role.CLINIC_LOCATION_HEAD,
  Role.CLINIC_ADMIN,
];

export const ADMIN_ROLES: Role[] = [Role.CLINIC_ADMIN, Role.SUPER_ADMIN];
