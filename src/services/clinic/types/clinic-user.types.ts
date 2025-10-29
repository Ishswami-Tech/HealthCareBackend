// Type definitions for clinic user operations

export interface ClinicUserBase {
  id: string;
  userId: string;
  clinicId: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClinicUserWithUser extends ClinicUserBase {
  user: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    isActive: boolean;
  };
}

export interface ClinicUserCreateInput {
  userId: string;
  clinicId: string;
  role: string;
  isActive?: boolean;
}

export interface ClinicUserUpdateInput {
  role?: string;
  isActive?: boolean;
  updatedAt?: Date;
}

export interface ClinicUserWhereInput {
  id?: string;
  userId?: string;
  clinicId?: string;
  role?: string;
  isActive?: boolean;
}

export interface ClinicUserResponseDto {
  id: string;
  userId: string;
  clinicId: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    isActive: boolean;
  };
}
