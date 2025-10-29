// Type definitions for clinic location operations

export interface ClinicLocationBase {
  id: string;
  locationId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  phone: string;
  email: string;
  timezone: string;
  workingHours: string;
  isActive: boolean;
  clinicId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClinicLocationWithDoctors extends ClinicLocationBase {
  doctorClinic: Array<{
    id: string;
    doctorId: string;
    clinicId: string;
    doctor: {
      id: string;
      user: {
        id: string;
        name: string;
        email: string;
      };
    };
  }>;
}

export interface ClinicLocationCreateInput {
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  phone: string;
  email: string;
  timezone: string;
  workingHours?: string;
  isActive?: boolean;
  clinicId: string;
  locationId: string;
}

export interface ClinicLocationUpdateInput {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  phone?: string;
  email?: string;
  timezone?: string;
  workingHours?: string;
  isActive?: boolean;
  updatedAt?: Date;
}

export interface ClinicLocationWhereInput {
  id?: string;
  clinicId?: string;
  name?: string;
  isActive?: boolean;
}

export interface ClinicLocationResponseDto {
  id: string;
  locationId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  phone: string;
  email: string;
  timezone: string;
  workingHours: string;
  isActive: boolean;
  clinicId: string;
  createdAt: Date;
  updatedAt: Date;
}
