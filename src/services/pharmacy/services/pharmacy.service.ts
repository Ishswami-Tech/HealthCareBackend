import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateMedicineDto,
  UpdateInventoryDto,
  CreatePrescriptionDto,
  PharmacyStatsDto,
  MedicineType,
  PrescriptionStatus,
} from '@dtos/pharmacy.dto';
import { v4 as uuidv4 } from 'uuid';

export interface Medicine extends CreateMedicineDto {
  id: string;
}

export interface Prescription extends CreatePrescriptionDto {
  id: string;
  key: string;
  status: PrescriptionStatus;
  createdAt: string;
}

@Injectable()
export class PharmacyService {
  // Mock Database
  private medicines: Medicine[] = [
    {
      id: 'med-1',
      name: 'Paracetamol',
      manufacturer: 'Pfizer',
      type: MedicineType.TABLET,
      quantity: 100,
      price: 5.0,
      expiryDate: '2025-12-31',
      description: 'Pain reliever',
      instructions: 'Take one or two tablets every 4 to 6 hours',
    },
    {
      id: 'med-2',
      name: 'Amoxicillin',
      manufacturer: 'GSK',
      type: MedicineType.CAPSULE,
      quantity: 50,
      price: 12.5,
      expiryDate: '2024-10-20',
      description: 'Antibiotic',
      instructions: 'Take one capsule every 8 hours',
    },
  ];

  private prescriptions: Prescription[] = [];

  async findAllMedicines(): Promise<Medicine[]> {
    return Promise.resolve(this.medicines);
  }

  async findMedicineById(id: string): Promise<Medicine> {
    const medicine = this.medicines.find(m => m.id === id);
    if (!medicine) throw new NotFoundException('Medicine not found');
    return Promise.resolve(medicine);
  }

  async addMedicine(dto: CreateMedicineDto): Promise<Medicine> {
    const newMedicine: Medicine = {
      id: uuidv4(),
      ...dto,
    };
    this.medicines.push(newMedicine);
    return Promise.resolve(newMedicine);
  }

  async updateInventory(id: string, dto: UpdateInventoryDto): Promise<Medicine> {
    const medicineIndex = this.medicines.findIndex(m => m.id === id);
    if (medicineIndex === -1) throw new NotFoundException('Medicine not found');

    const medicine = this.medicines[medicineIndex];
    if (!medicine) {
      throw new NotFoundException('Medicine not found');
    }

    if (dto.quantityChange) {
      medicine.quantity += dto.quantityChange;
    }
    if (dto.price) {
      medicine.price = dto.price;
    }

    this.medicines[medicineIndex] = medicine;
    return Promise.resolve(medicine);
  }

  async findAllPrescriptions(): Promise<Prescription[]> {
    return Promise.resolve(this.prescriptions);
  }

  async createPrescription(dto: CreatePrescriptionDto): Promise<Prescription> {
    const newPrescription: Prescription = {
      id: uuidv4(),
      key: `PRE-${Date.now()}`,
      status: PrescriptionStatus.PENDING,
      createdAt: new Date().toISOString(),
      ...dto,
    };
    this.prescriptions.push(newPrescription);
    return Promise.resolve(newPrescription);
  }

  async getStats(): Promise<PharmacyStatsDto> {
    return Promise.resolve({
      totalMedicines: this.medicines.length,
      lowStock: this.medicines.filter(m => m.quantity < 20).length,
      pendingPrescriptions: this.prescriptions.filter(p => p.status === PrescriptionStatus.PENDING)
        .length,
    });
  }
}
