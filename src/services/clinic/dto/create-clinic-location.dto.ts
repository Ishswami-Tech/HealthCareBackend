// Simple DTO without decorators to avoid TypeScript compatibility issues

export class CreateClinicLocationDto {
  name!: string;
  address!: string;
  city!: string;
  state!: string;
  country!: string;
  zipCode!: string;
  phone!: string;
  email!: string;
  timezone!: string;
  isActive?: boolean;
  latitude?: number;
  longitude?: number;
  workingHours?: Record<string, { start: string; end: string } | null>;
  settings?: Record<string, unknown>;
}
