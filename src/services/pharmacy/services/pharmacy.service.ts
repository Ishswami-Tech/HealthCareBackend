import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import {
  CreateMedicineDto,
  UpdateInventoryDto,
  CreatePrescriptionDto,
  PrescriptionStatus,
  CreateSupplierDto,
  UpdateSupplierDto,
} from '@dtos/pharmacy.dto';
import { PrismaDelegateArgs, PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';

@Injectable()
export class PharmacyService {
  constructor(private readonly databaseService: DatabaseService) {}

  async findAllMedicines(clinicId?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const where: Record<string, unknown> = {};
      if (clinicId) where['clinicId'] = clinicId;

      return await typedClient.medicine.findMany({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async findMedicineById(id: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.medicine.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async addMedicine(dto: CreateMedicineDto, clinicId?: string) {
    if (!clinicId) throw new BadRequestException('Clinic ID is required to add medicine');

    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        // Mapping DTO to Schema
        // Schema has: name, ingredients?, properties?, dosage?, manufacturer?, type, clinicId
        // DTO has: name, manufacturer, description, type, quantity, price, expiryDate, instructions
        // WE LOST: quantity, price, expiryDate
        return await typedClient.medicine.create({
          data: {
            name: dto.name,
            manufacturer: dto.manufacturer,
            type: dto.type,
            properties: dto.description, // Mapping description to properties
            dosage: dto.instructions, // Mapping instructions to dosage provided generic usage
            stock: dto.quantity, // Mapping quantity to stock
            price: dto.price,
            expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
            minStockThreshold: dto.minStockThreshold ?? 10,
            supplierId: dto.supplierId,
            clinicId: clinicId,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId: clinicId,
        resourceType: 'MEDICINE',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: 'system',
        details: { name: dto.name },
      }
    );
  }

  async updateInventory(id: string, dto: UpdateInventoryDto, clinicId?: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

        const existing = await typedClient.medicine.findUnique({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        if (!existing) {
          throw new BadRequestException('Medicine not found');
        }

        return await typedClient.medicine.update({
          where: { id } as PrismaDelegateArgs,
          data: {
            ...(dto.quantityChange !== undefined && {
              stock: { increment: dto.quantityChange },
            }),
            ...(dto.price !== undefined && { price: dto.price }),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId: clinicId || 'unknown',
        resourceType: 'MEDICINE',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: { quantityChange: dto.quantityChange, price: dto.price },
      }
    );
  }

  async findAllPrescriptions(clinicId?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const where: Record<string, unknown> = {};
      if (clinicId) where['clinicId'] = clinicId;

      return await typedClient.prescription.findMany({
        where: where as PrismaDelegateArgs,
        include: { items: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async findPrescriptionsByPatient(userId: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

      return await typedClient.prescription.findMany({
        where: { patientId: userId } as PrismaDelegateArgs,
        include: {
          items: true,
          doctor: {
            select: {
              specialization: true,
              user: { select: { name: true } },
            },
          },
        } as PrismaDelegateArgs,
        orderBy: { date: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async createPrescription(dto: CreatePrescriptionDto, clinicId?: string) {
    if (!clinicId) throw new BadRequestException('Clinic ID is required');

    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

        return await typedClient.prescription.create({
          data: {
            patientId: dto.patientId,
            doctorId: dto.doctorId,
            clinicId: clinicId,
            notes: dto.notes,
            items: {
              create: dto.items.map(item => ({
                medicineId: item.medicineId,
                quantity: item.quantity,
                dosage: item.dosage,
                clinicId: clinicId,
              })),
            },
          } as PrismaDelegateArgs,
          include: { items: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: dto.doctorId,
        clinicId: clinicId,
        resourceType: 'PRESCRIPTION',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: 'system',
        details: { patientId: dto.patientId },
      }
    );
  }

  /**
   * Update prescription status (dispense/cancel). Enforces immutability:
   * prescriptions with status FILLED cannot be modified.
   */
  async updatePrescriptionStatus(
    prescriptionId: string,
    status: PrescriptionStatus,
    clinicId?: string
  ) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

        const existing = await typedClient.prescription.findUnique({
          where: { id: prescriptionId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        if (!existing) {
          throw new BadRequestException('Prescription not found');
        }

        if (clinicId && existing.clinicId !== clinicId) {
          throw new BadRequestException('Prescription does not belong to this clinic');
        }

        // Immutability: reject updates when already FILLED
        if (existing.status === 'FILLED') {
          throw new BadRequestException(
            'Cannot modify a prescription that has already been dispensed'
          );
        }

        if (existing.status === 'CANCELLED' && status !== PrescriptionStatus.CANCELLED) {
          throw new BadRequestException('Cannot update a cancelled prescription');
        }

        const updatedPrescription = await typedClient.prescription.update({
          where: { id: prescriptionId } as PrismaDelegateArgs,
          data: { status } as PrismaDelegateArgs,
          include: { items: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        if (status === PrescriptionStatus.FILLED && updatedPrescription.items) {
          for (const item of updatedPrescription.items) {
            if (item.medicineId) {
              await typedClient.medicine.update({
                where: { id: item.medicineId } as PrismaDelegateArgs,
                data: {
                  stock: { decrement: item.quantity || 1 },
                } as PrismaDelegateArgs,
              });
            }
          }
        }

        return updatedPrescription;
      },
      {
        userId: 'system',
        clinicId: clinicId ?? 'unknown',
        resourceType: 'PRESCRIPTION',
        operation: 'UPDATE',
        resourceId: prescriptionId,
        userRole: 'system',
        details: { status },
      }
    );
  }

  async getStats(clinicId?: string) {
    // Simple count stats
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

      const where: Record<string, unknown> = {};
      if (clinicId) where['clinicId'] = clinicId;

      const totalMedicines = await typedClient.medicine.count({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      const totalPrescriptions = await typedClient.prescription.count({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      // Fetch medicine stock levels to calculate low stock
      const medicines = await typedClient.medicine.findMany({
        where: where as PrismaDelegateArgs,
        select: { stock: true, minStockThreshold: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      const lowStockCount = medicines.filter(
        m => (m.stock ?? 0) <= (m.minStockThreshold ?? 0)
      ).length;

      return {
        totalMedicines,
        lowStock: lowStockCount,
        pendingPrescriptions: totalPrescriptions,
      };
    });
  }

  // ============ Supplier Management ============

  async findAllSuppliers(clinicId?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        supplier: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };
      const where: Record<string, unknown> = { isActive: true };
      if (clinicId) where['clinicId'] = clinicId;

      return await typedClient.supplier.findMany({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async addSupplier(dto: CreateSupplierDto, clinicId: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          supplier: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.supplier.create({
          data: {
            ...(dto as unknown as Record<string, unknown>),
            clinicId,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'SUPPLIER',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: 'system',
        details: { name: (dto as unknown as Record<string, unknown>)['name'] },
      }
    );
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto, clinicId: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          supplier: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.supplier.update({
          where: { id } as PrismaDelegateArgs,
          data: dto as unknown as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'SUPPLIER',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: dto as unknown as Record<string, unknown>,
      }
    );
  }

  async findLowStock(clinicId?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const where: Record<string, unknown> = {};
      if (clinicId) where['clinicId'] = clinicId;

      // Note: Prisma doesn't support comparing two columns directly in findMany filter easily without raw/computed
      // For simplicity in this mock-style implementation, we'll fetch and filter if needed or use a raw query
      // but here we will fetch all and filter for now as it's a small dataset usually.
      // In production, we'd use a raw query or stock < minStockThreshold.
      const medicines = await typedClient.medicine.findMany({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      return medicines.filter(m => (m.stock ?? 0) <= (m.minStockThreshold ?? 0));
    });
  }
}
