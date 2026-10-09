import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@core/types/enums.types';
import { EHRService } from '@services/ehr/ehr.service';

const PATIENT_ROLE: string = Role.PATIENT;

export interface ComplianceActor {
  readonly userId: string;
  readonly role: string;
}

/**
 * Who may touch which patient, decided once for the compliance services.
 *
 * "Belongs to the clinic" is the definition the EHR already uses (primary clinic, clinic
 * membership, active role there, or an appointment there), so consent and identifiers cannot
 * disagree with the patient list about whose patient someone is.
 *  - Staff: the patient must belong to the caller's clinic.
 *  - A PATIENT caller: the record must be their own.
 */
@Injectable()
export class CompliancePatientAccess {
  constructor(private readonly ehr: EHRService) {}

  async require(
    patientId: string,
    clinicId: string,
    actor: ComplianceActor
  ): Promise<{ id: string; userId: string }> {
    const isPatientCaller = actor.role === PATIENT_ROLE;
    const patient = await this.ehr.resolvePatient(
      patientId,
      isPatientCaller ? undefined : clinicId
    );
    if (!patient) {
      throw new NotFoundException(`Patient ${patientId} not found`);
    }
    if (isPatientCaller && patient.userId !== actor.userId) {
      throw new ForbiddenException('Patients can only access their own record');
    }
    return patient;
  }
}
