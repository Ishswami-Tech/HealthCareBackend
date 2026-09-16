/**
 * IPD Nurse Station Service
 * @module Nurse Station Service
 * @description Thin orchestrator for nursing notes, vitals, and medications
 */

import { Injectable } from '@nestjs/common';
import { NurseStationClinicalService } from './nurse-station-clinical.service';

/**
 * Service for nurse station operations.
 *
 * Delegates to NurseStationClinicalService for:
 * - Nursing note creation and retrieval
 * - Vitals flowsheet recording and trending
 * - Bedside medication administration
 *
 * @public
 */
@Injectable()
export class NurseStationService {
  constructor(private readonly clinical: NurseStationClinicalService) {}

  // ============ Nursing Notes ============

  /**
   * Creates a new nursing note.
   * @param dto - Nursing note data
   * @param clinicId - Clinic context
   * @returns Created note
   */
  async createNursingNote(
    dto: import('@services/ipd/dto').CreateNursingNoteDto,
    clinicId: string
  ): Promise<import('@services/ipd/dto').NursingNoteResponseDto> {
    return this.clinical.createNursingNote(dto, clinicId);
  }

  /**
   * Retrieves nursing notes with optional filtering.
   * @param clinicId - Clinic context
   * @param query - Filter parameters
   * @returns Paginated notes
   */
  async getNursingNotes(
    clinicId: string,
    query: import('@services/ipd/dto').NursingNotesQueryDto
  ): Promise<{
    data: import('@services/ipd/dto').NursingNoteResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.clinical.getNursingNotes(clinicId, query);
  }

  /**
   * Marks a nursing note as acknowledged.
   * @param noteId - Note ID
   * @param doctorId - Doctor user ID
   * @param clinicId - Clinic context
   * @returns Updated note
   */
  async acknowledgeNursingNote(
    noteId: string,
    doctorId: string,
    clinicId: string
  ): Promise<import('@services/ipd/dto').NursingNoteResponseDto> {
    return this.clinical.acknowledgeNursingNote(noteId, doctorId, clinicId);
  }

  // ============ Vitals ============

  /**
   * Records patient vitals.
   * @param dto - Vitals data
   * @param clinicId - Clinic context
   * @returns Recorded vitals
   */
  async recordVitals(
    dto: import('@services/ipd/dto').RecordVitalsDto,
    clinicId: string
  ): Promise<import('@services/ipd/dto').VitalsResponseDto> {
    return this.clinical.recordVitals(dto, clinicId);
  }

  /**
   * Retrieves vitals history for an admission.
   * @param admissionId - Admission ID
   * @param clinicId - Clinic context
   * @returns Vitals history
   */
  async getVitalsHistory(
    admissionId: string,
    clinicId: string
  ): Promise<import('@services/ipd/dto').VitalsResponseDto[]> {
    return this.clinical.getVitalsHistory(admissionId, clinicId);
  }

  // ============ Medications ============

  /**
   * Administers bedside medication.
   * @param dto - Medication administration data
   * @param clinicId - Clinic context
   * @returns Medication administration record
   */
  async administerMedication(
    dto: import('@services/ipd/dto').AdministerMedicationDto,
    clinicId: string
  ): Promise<import('@services/ipd/dto').BedsideMedicationResponseDto> {
    return this.clinical.administerMedication(dto, clinicId);
  }

  /**
   * Retrieves medication history.
   * @param admissionId - Admission ID
   * @param clinicId - Clinic context
   * @returns Medication history
   */
  async getMedications(
    admissionId: string,
    clinicId: string
  ): Promise<import('@services/ipd/dto').BedsideMedicationResponseDto[]> {
    return this.clinical.getMedicationHistory(admissionId, clinicId);
  }
}
