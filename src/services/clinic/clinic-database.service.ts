import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

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
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new database for a clinic
   * @param clinicId The ID of the clinic
   * @param clinicName The name of the clinic (used for database naming)
   * @returns The connection string for the new database
   */
  async createClinicDatabase(clinicId: string, clinicName: string): Promise<string> {
    // Sanitize clinic name for database name (remove spaces, special chars)
    const dbName = `clinic_${clinicName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${clinicId.substring(0, 8)}`;
    
    // Get the current database connection details
    const currentDbUrl = process.env.DATABASE_URL;
    const dbConfig = this.parseDatabaseUrl(currentDbUrl);
    
    // Create a new database connection string for the clinic
    const clinicDbUrl = this.buildDatabaseUrl({
      ...dbConfig,
      database: dbName,
    });

    try {
      // In Docker environment, we need to use the postgres container's service
      // Create the database using a direct connection to postgres
      const postgresDb = new PrismaClient({
        datasources: {
          db: {
            url: `postgresql://${dbConfig.username}:${dbConfig.password}@${dbConfig.hostname}:${dbConfig.port}/postgres`,
          },
        },
      });

      // Create the database if it doesn't exist
      try {
        await postgresDb.$executeRawUnsafe(`CREATE DATABASE ${dbName};`);
        console.log(`Created database ${dbName}`);
      } catch (error) {
        // If the database already exists, that's fine
        if (!error.message.includes('already exists')) {
          throw error;
        }
      }

      // Close the connection to postgres
      await postgresDb.$disconnect();
      
      // Initialize the database schema using Prisma
      await this.initializeClinicSchema(clinicDbUrl);
      
      return clinicDbUrl;
    } catch (error) {
      console.error(`Error creating clinic database: ${error.message}`);
      throw new Error(`Failed to create clinic database: ${error.message}`);
    }
  }

  /**
   * Get a clinic by its app name
   * @param appName The name of the clinic's mobile app
   * @returns The clinic data or null if not found
   */
  async getClinicByAppName(appName: string): Promise<ClinicRecord | null> {
    // Use raw query to avoid type issues
    const clinics = await this.prisma.$queryRaw<ClinicRecord[]>`
      SELECT * FROM "Clinic" WHERE "app_name" = ${appName} LIMIT 1
    `;
    
    return clinics.length > 0 ? clinics[0] : null;
  }

  /**
   * Get a clinic's database connection by app name
   * @param appName The name of the clinic's mobile app
   * @returns The database connection string or null if not found
   */
  async getClinicConnectionByAppName(appName: string): Promise<string | null> {
    // Use raw query to avoid type issues
    const clinics = await this.prisma.$queryRaw<ClinicConnectionRecord[]>`
      SELECT "db_connection_string" FROM "Clinic" WHERE "app_name" = ${appName} LIMIT 1
    `;
    
    return clinics.length > 0 ? clinics[0].db_connection_string : null;
  }

  /**
   * Parse a database URL into its components
   */
  private parseDatabaseUrl(url: string): any {
    // postgresql://username:password@hostname:port/database?schema=public
    const regex = /^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/;
    const match = url.match(regex);
    
    if (!match) {
      throw new Error('Invalid database URL format');
    }
    
    return {
      username: match[1],
      password: match[2],
      hostname: match[3],
      port: match[4],
      database: match[5],
    };
  }

  /**
   * Build a database URL from components
   */
  private buildDatabaseUrl(config: any): string {
    return `postgresql://${config.username}:${config.password}@${config.hostname}:${config.port}/${config.database}?schema=public`;
  }

  /**
   * Initialize the clinic database schema
   */
  private async initializeClinicSchema(dbUrl: string): Promise<void> {
    // Create a new PrismaClient instance for the clinic database
    const clinicPrisma = new PrismaClient({
      datasources: {
        db: {
          url: dbUrl,
        },
      },
    });

    try {
      // Initialize the schema by creating the necessary tables
      // This is a simplified approach - in a real-world scenario, you might want to use Prisma Migrate
      await clinicPrisma.$executeRawUnsafe(`
        -- Create Doctor table
        CREATE TABLE IF NOT EXISTS "Doctor" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "specialization" TEXT NOT NULL,
          "experience" INTEGER NOT NULL,
          "qualification" TEXT,
          "consultationFee" DOUBLE PRECISION,
          "rating" DOUBLE PRECISION DEFAULT 0.0,
          "isAvailable" BOOLEAN DEFAULT true,
          "workingHours" JSONB,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          
          CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "Doctor_userId_key" UNIQUE ("userId")
        );

        -- Create Patient table
        CREATE TABLE IF NOT EXISTS "Patient" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "prakriti" TEXT,
          "dosha" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          
          CONSTRAINT "Patient_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "Patient_userId_key" UNIQUE ("userId")
        );

        -- Create other necessary tables for the clinic
        -- Add more tables as needed
      `);
      
      console.log('Initialized clinic database schema');
    } catch (error) {
      console.error(`Error initializing clinic schema: ${error.message}`);
      throw error;
    } finally {
      // Close the connection
      await clinicPrisma.$disconnect();
    }
  }
} 