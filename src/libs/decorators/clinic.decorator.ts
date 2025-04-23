import { SetMetadata } from '@nestjs/common';

export const CLINIC_KEY = 'clinic';
export const Clinic = () => SetMetadata(CLINIC_KEY, true); 