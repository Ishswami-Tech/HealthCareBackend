import { Injectable } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { Role } from '@core/types/enums.types';

/**
 * Profile Completion Service
 * Handles role-based profile validation and completion logic
 */

export interface ProfileCompletionValidationResult {
  isComplete: boolean;
  missingFields: string[];
  errors: Array<{ field: string; message: string }>;
}

export interface RoleBasedRequirements {
  requiredFields: string[];
  conditionalFields: Record<string, string[]>;
}

@Injectable()
export class ProfileCompletionService {
  constructor(private readonly logging: LoggingService) {}

  /**
   * Role-based profile completion requirements
   * Each role has specific mandatory fields for profile completion
   */
  private readonly ROLE_REQUIREMENTS: Record<Role, RoleBasedRequirements> = {
    PATIENT: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    DOCTOR: {
      requiredFields: [
        'firstName',
        'lastName',
        'phone',
        'dateOfBirth',
        'gender',
        'address',
        'specialization',
        'experience',
      ],
      conditionalFields: {},
    },
    ASSISTANT_DOCTOR: {
      requiredFields: [
        'firstName',
        'lastName',
        'phone',
        'dateOfBirth',
        'gender',
        'address',
        'specialization',
        'experience',
      ],
      conditionalFields: {},
    },
    RECEPTIONIST: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    PHARMACIST: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    THERAPIST: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    LAB_TECHNICIAN: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    FINANCE_BILLING: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    SUPPORT_STAFF: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    NURSE: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    COUNSELOR: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    LOCATION_HEAD: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    CLINIC_ADMIN: {
      requiredFields: [
        'firstName',
        'lastName',
        'phone',
        'dateOfBirth',
        'gender',
        'address',
        'clinicName',
        'clinicAddress',
      ],
      conditionalFields: {},
    },
    SUPER_ADMIN: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
  };

  /**
   * Validate if a user's profile is complete based on their role
   */
  public validateProfileCompletion(
    profile: Record<string, unknown>,
    role: Role
  ): ProfileCompletionValidationResult {
    const requirements = this.ROLE_REQUIREMENTS[role];

    if (!requirements) {
      void this.logging.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Unknown role for profile validation: ${role}`,
        'ProfileCompletionService.validateProfileCompletion'
      );

      return {
        isComplete: false,
        missingFields: [],
        errors: [{ field: 'role', message: 'Invalid role specified' }],
      };
    }

    const missingFields: string[] = [];
    const errors: Array<{ field: string; message: string }> = [];

    // Check each required field
    for (const field of requirements.requiredFields) {
      const value = profile[field];

      if (this.isFieldEmpty(value)) {
        missingFields.push(field);
        errors.push({
          field,
          message: `${this.formatFieldName(field)} is required for ${role} users`,
        });
      }
    }

    // Validate field formats
    this.validateFieldFormats(profile, role, errors);

    const isComplete = missingFields.length === 0 && errors.length === 0;

    if (!isComplete) {
      void this.logging.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `Profile incomplete for ${role}: missing ${missingFields.join(', ')}`,
        'ProfileCompletionService.validateProfileCompletion',
        { role, missingFields, errorCount: errors.length }
      );
    }

    return {
      isComplete,
      missingFields,
      errors,
    };
  }

  /**
   * Check if a field is empty (null, undefined, empty string, etc.)
   */
  private isFieldEmpty(value: unknown): boolean {
    if (value === null || value === undefined) {
      return true;
    }

    if (typeof value === 'string') {
      return value.trim().length === 0;
    }

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    return false;
  }

  /**
   * Validate field formats (email, phone, dates, etc.)
   */
  private validateFieldFormats(
    profile: Record<string, unknown>,
    role: Role,
    errors: Array<{ field: string; message: string }>
  ): void {
    // Validate phone format if present
    const phone = profile['phone'] as string | undefined;
    if (phone && phone.trim()) {
      const phoneRegex = /^\+?[1-9]\d{1,14}$/;
      if (!phoneRegex.test(phone.trim())) {
        errors.push({
          field: 'phone',
          message: 'Phone number format is invalid',
        });
      }
    }

    // Validate date of birth if present
    const dateOfBirth = profile['dateOfBirth'] as string | Date | undefined;
    if (dateOfBirth) {
      const dob = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;

      if (isNaN(dob.getTime())) {
        errors.push({
          field: 'dateOfBirth',
          message: 'Invalid date of birth format',
        });
      } else {
        // Check age is reasonable (12-120 years)
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();

        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
          age--;
        }

        if (age < 12) {
          errors.push({
            field: 'dateOfBirth',
            message: 'You must be at least 12 years old',
          });
        } else if (age > 120) {
          errors.push({
            field: 'dateOfBirth',
            message: 'Invalid date of birth',
          });
        }
      }
    }

    // Validate experience for medical staff
    if (role === Role.DOCTOR || role === Role.ASSISTANT_DOCTOR) {
      const experience = profile['experience'] as number | string | undefined;
      if (experience !== undefined && experience !== '') {
        const expValue = typeof experience === 'string' ? parseInt(experience, 10) : experience;

        if (isNaN(expValue) || expValue < 0 || expValue > 60) {
          errors.push({
            field: 'experience',
            message: 'Experience must be between 0 and 60 years',
          });
        }
      }
    }

    // Validate gender value if present
    const gender = profile['gender'] as string | undefined;
    if (gender && gender.trim()) {
      const validGenders = ['MALE', 'FEMALE', 'OTHER'];
      if (!validGenders.includes(gender.toUpperCase())) {
        errors.push({
          field: 'gender',
          message: 'Invalid gender value',
        });
      }
    }
  }

  /**
   * Format field name for display (camelCase to Title Case)
   */
  private formatFieldName(fieldName: string): string {
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .replace(/[A-Z]/g, ' $&')
      .trim()
      .replace(/ /g, ' ');
  }

  /**
   * Get required fields for a specific role
   */
  public getRequiredFieldsForRole(role: Role): string[] {
    const requirements = this.ROLE_REQUIREMENTS[role];
    return requirements?.requiredFields || [];
  }

  /**
   * Check if profile should be considered complete (server-side logic)
   * This is the single source of truth for profile completion status
   */
  public isProfileComplete(profile: Record<string, unknown>, role: Role): boolean {
    const result = this.validateProfileCompletion(profile, role);
    return result.isComplete;
  }

  /**
   * Get profile completion percentage
   */
  public getCompletionPercentage(profile: Record<string, unknown>, role: Role): number {
    const requirements = this.ROLE_REQUIREMENTS[role];

    if (!requirements || requirements.requiredFields.length === 0) {
      return 0;
    }

    const completedFields = requirements.requiredFields.filter(
      field => !this.isFieldEmpty(profile[field])
    ).length;

    return Math.round((completedFields / requirements.requiredFields.length) * 100);
  }

  /**
   * Check if emergency contact is complete
   */
  public isEmergencyContactComplete(
    emergencyContact: Record<string, unknown> | null | undefined
  ): boolean {
    if (!emergencyContact) {
      return false;
    }

    const contact = emergencyContact as {
      name?: string;
      phone?: string;
      relationship?: string;
    };

    return !!(contact.name?.trim() && contact.phone?.trim() && contact.relationship?.trim());
  }
}
