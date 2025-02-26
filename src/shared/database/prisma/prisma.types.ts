import { PrismaClient } from '@prisma/client'
import { Role } from '@prisma/client'

// Export all models
export type {
  User,
  Product,
  Appointment,
  Payment,
} from '@prisma/client'

// Export enums
export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER'
}

export enum AppointmentStatus {
  PENDING = 'PENDING',
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW'
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED'
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  UPI = 'UPI',
  NET_BANKING = 'NET_BANKING'
}

export enum AppointmentType {
  IN_PERSON = 'IN_PERSON',
  VIDEO_CALL = 'VIDEO_CALL',
  HOME_VISIT = 'HOME_VISIT'
}

export enum Prakriti {
  VATA = 'VATA',
  PITTA = 'PITTA',
  KAPHA = 'KAPHA',
  VATA_PITTA = 'VATA_PITTA',
  PITTA_KAPHA = 'PITTA_KAPHA',
  VATA_KAPHA = 'VATA_KAPHA',
  TRIDOSHA = 'TRIDOSHA'
}

// Export Prisma namespace for input types
export { Prisma } from '@prisma/client'

// Export the Role enum from Prisma
export { Role }

// Singleton pattern for PrismaClient with lazy initialization
let prisma: PrismaClient | undefined

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'],
    })
  }
  return prisma
}

// Initialize on first import
export default getPrismaClient() 