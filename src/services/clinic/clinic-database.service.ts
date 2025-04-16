import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { LoggingService } from '../../shared/logging/logging.service';
import { EventService } from '../../shared/events/event.service';
import { LogLevel, LogType } from '../../shared/logging/types/logging.types';

// Define interfaces for raw query results
interface ClinicRecord {
  id: string;
  name: string;
  address: string;
  phone: string;
  app_name: string;
  db_connection_string: string;
  createdAt: Date;
}

interface ClinicConnectionRecord {
  db_connection_string: string;
}

@Injectable()
export class ClinicDatabaseService {
  constructor(
    private prisma: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
  ) {}

  /**
   * Create a new database for a clinic
   * @param clinicId The ID of the clinic
   * @param appName The name of the clinic's mobile app
   * @returns The connection string for the new database
   */
  async createClinicDatabase(clinicId: string, appName: string): Promise<string> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Creating clinic database',
        'ClinicDatabaseService',
        { clinicId, appName }
      );

      const connectionString = await this.generateConnectionString(appName);
      
      await this.prisma.clinic.update({
        where: { id: clinicId },
        data: { db_connection_string: connectionString },
      });

      await this.initializeClinicSchema(connectionString);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic database created successfully',
        'ClinicDatabaseService',
        { clinicId, appName }
      );

      await this.eventService.emit('clinic.database.created', {
        clinicId,
        appName,
        connectionString
      });

      return connectionString;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create clinic database',
        'ClinicDatabaseService',
        { error: error.message, clinicId, appName }
      );
      throw new InternalServerErrorException('Failed to create clinic database');
    }
  }

  /**
   * Get a clinic by its app name
   * @param appName The name of the clinic's mobile app
   * @returns The clinic data or null if not found
   */
  async getClinicByAppName(appName: string): Promise<ClinicRecord | null> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Fetching clinic by app name',
        'ClinicDatabaseService',
        { appName }
      );

      const clinic = await this.prisma.clinic.findUnique({
        where: { app_name: appName },
      });

      if (!clinic) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Clinic not found by app name',
          'ClinicDatabaseService',
          { appName }
        );
        throw new NotFoundException('Clinic not found');
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic found by app name',
        'ClinicDatabaseService',
        { clinicId: clinic.id, appName }
      );

      return clinic;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to fetch clinic by app name',
        'ClinicDatabaseService',
        { error: error.message, appName }
      );
      throw error;
    }
  }

  /**
   * Get a clinic's database connection by app name
   * @param appName The name of the clinic's mobile app
   * @returns The database connection string or null if not found
   */
  async getClinicConnectionByAppName(appName: string): Promise<string | null> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Fetching clinic connection by app name',
        'ClinicDatabaseService',
        { appName }
      );

      const clinic = await this.prisma.clinic.findUnique({
        where: { app_name: appName },
        select: { db_connection_string: true },
      });

      if (!clinic) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Clinic connection not found by app name',
          'ClinicDatabaseService',
          { appName }
        );
        throw new NotFoundException('Clinic not found');
      }

      if (!clinic.db_connection_string) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Clinic connection string not found',
          'ClinicDatabaseService',
          { appName }
        );
        throw new NotFoundException('Clinic database connection not found');
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic connection found by app name',
        'ClinicDatabaseService',
        { appName }
      );

      return clinic.db_connection_string;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to fetch clinic connection by app name',
        'ClinicDatabaseService',
        { error: error.message, appName }
      );
      throw error;
    }
  }

  private async generateConnectionString(appName: string): Promise<string> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Generating connection string',
        'ClinicDatabaseService',
        { appName }
      );

      // Generate a unique database name based on the app name
      const dbName = `clinic_${appName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      
      // Create the connection string
      const connectionString = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${dbName}`;

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Connection string generated successfully',
        'ClinicDatabaseService',
        { appName, dbName }
      );

      return connectionString;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to generate connection string',
        'ClinicDatabaseService',
        { error: error.message, appName }
      );
      throw new InternalServerErrorException('Failed to generate connection string');
    }
  }

  /**
   * Initialize the clinic database schema
   */
  private async initializeClinicSchema(connectionString: string): Promise<void> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Initializing clinic schema',
        'ClinicDatabaseService',
        { connectionString: connectionString.substring(0, 20) + '...' }
      );

      // Here you would execute the SQL commands to create the necessary tables
      // This is a placeholder for the actual schema initialization
      const schema = `
        CREATE TABLE IF NOT EXISTS patients (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          phone VARCHAR(20),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS appointments (
          id SERIAL PRIMARY KEY,
          patient_id INTEGER REFERENCES patients(id),
          doctor_id INTEGER,
          date TIMESTAMP NOT NULL,
          status VARCHAR(20) DEFAULT 'scheduled',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

      // Execute the schema initialization
      // This would typically use a database client to execute the SQL
      // For now, we'll just log that it would be executed
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic schema initialized successfully',
        'ClinicDatabaseService',
        { connectionString: connectionString.substring(0, 20) + '...' }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to initialize clinic schema',
        'ClinicDatabaseService',
        { error: error.message, connectionString: connectionString.substring(0, 20) + '...' }
      );
      throw new InternalServerErrorException('Failed to initialize clinic schema');
    }
  }
} 