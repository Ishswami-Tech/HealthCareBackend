// Type definitions for clinic operations

export interface ClinicBase {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  subdomain: string;
  app_name: string;
  logo?: string;
  website?: string;
  description?: string;
  timezone: string;
  currency: string;
  language: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClinicWithLocation extends ClinicBase {
  mainLocation: {
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
  };
}

export interface ClinicCreateInput {
  name: string;
  address: string;
  phone: string;
  email: string;
  subdomain: string;
  app_name: string;
  logo?: string;
  website?: string;
  description?: string;
  timezone: string;
  currency: string;
  language: string;
  isActive?: boolean;
  createdBy: string;
}

export interface ClinicUpdateInput {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  subdomain?: string;
  app_name?: string;
  logo?: string;
  website?: string;
  description?: string;
  timezone?: string;
  currency?: string;
  language?: string;
  isActive?: boolean;
  updatedAt?: Date;
}

export interface ClinicWhereInput {
  id?: string;
  name?: string;
  subdomain?: string;
  isActive?: boolean;
}

export interface ClinicResponseDto {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  subdomain: string;
  app_name: string;
  logo?: string;
  website?: string;
  description?: string;
  timezone: string;
  currency: string;
  language: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  mainLocation?: {
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
  };
}
