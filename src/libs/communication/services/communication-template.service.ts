import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import {
  CreateCommunicationTemplateDto,
  UpdateCommunicationTemplateDto,
} from '@dtos/notification.dto';
import { PrismaTransactionClientWithDelegates, PrismaDelegateArgs } from '@core/types';

@Injectable()
export class CommunicationTemplateService {
  constructor(private readonly databaseService: DatabaseService) {}

  async createTemplate(dto: CreateCommunicationTemplateDto, userId: string, clinicId?: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          communicationTemplate: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.communicationTemplate.create({
          data: {
            ...dto,
            clinicId: dto.clinicId || clinicId,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId,
        userRole: 'CLINIC_ADMIN',
        clinicId: dto.clinicId || clinicId || 'system',
        operation: 'CREATE',
        resourceType: 'COMMUNICATION_TEMPLATE',
        details: dto as unknown as Record<string, unknown>,
      }
    );
  }

  async updateTemplate(
    id: string,
    dto: UpdateCommunicationTemplateDto,
    userId: string,
    clinicId: string
  ) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          communicationTemplate: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.communicationTemplate.update({
          where: { id } as PrismaDelegateArgs,
          data: dto as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId,
        userRole: 'CLINIC_ADMIN',
        clinicId,
        operation: 'UPDATE',
        resourceType: 'COMMUNICATION_TEMPLATE',
        resourceId: id,
        details: dto as unknown as Record<string, unknown>,
      }
    );
  }

  async getTemplates(clinicId?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        communicationTemplate: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };
      return await typedClient.communicationTemplate.findMany({
        where: clinicId ? { OR: [{ clinicId }, { clinicId: null }] } : {},
      } as PrismaDelegateArgs);
    });
  }

  async getTemplateById(id: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        communicationTemplate: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      return await typedClient.communicationTemplate.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async deleteTemplate(id: string, userId: string, clinicId: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          communicationTemplate: { delete: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.communicationTemplate.delete({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId,
        userRole: 'CLINIC_ADMIN',
        clinicId,
        operation: 'DELETE',
        resourceType: 'COMMUNICATION_TEMPLATE',
        resourceId: id,
      }
    );
  }
}
