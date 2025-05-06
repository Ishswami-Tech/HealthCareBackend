import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { LoggingService } from '../../shared/logging/logging.service';
import { EventService } from '../../shared/events/event.service';
import { LogLevel, LogType } from '../../shared/logging/types/logging.types';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

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
  private readonly logger = new Logger(ClinicDatabaseService.name);

  constructor(
    private prisma: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Create a new database for a clinic
   * @param subdomain The subdomain of the clinic
   * @returns The connection string for the new database
   */
  async createClinicDatabase(subdomain: string): Promise<{ connectionString: string; databaseName: string }> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Creating clinic database',
        'ClinicDatabaseService',
        { subdomain }
      );

      const databaseName = `clinic_${subdomain.toLowerCase()}_db`;
      const connectionString = this.generateConnectionString(databaseName);

      // Create the database using Postgres command 
      await this.executeCommand(
        `psql -U ${this.configService.get('POSTGRES_USER')} -h ${this.configService.get('POSTGRES_HOST')} -c "CREATE DATABASE ${databaseName};"`
      );
      
      // Initialize the database schema using Prisma
      await this.initializeClinicDatabaseWithPrisma(connectionString);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic database created successfully',
        'ClinicDatabaseService',
        { databaseName }
      );

      await this.eventService.emit('clinic.database.created', {
        subdomain,
        connectionString,
        databaseName
      });

      return { connectionString, databaseName };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create clinic database',
        'ClinicDatabaseService',
        { error: error.message, subdomain }
      );
      throw error;
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

  /**
   * Initialize a clinic's database with Prisma schema and migrations
   * @param connectionString The connection string for the clinic's database
   */
  private async initializeClinicDatabaseWithPrisma(connectionString: string): Promise<void> {
    try {
      // Generate tenant schema by copying the Prisma schema for tenant databases
      const tenantSchemaPath = path.join(__dirname, '../../shared/database/prisma/tenant.schema.prisma');
      const tempMigrationsDir = path.join(__dirname, '../../../temp-migrations');
      
      // Ensure migrations directory exists
      await fs.promises.mkdir(tempMigrationsDir, { recursive: true });
      
      // Set environment variable for Prisma to use this connection string
      process.env.TENANT_DATABASE_URL = connectionString;
      
      try {
        // Run prisma migrate command to generate and apply migrations
        this.logger.log('Generating and applying Prisma migrations for tenant database...');
        
        // First run prisma db push to create the schema without migrations history
        await this.executeCommand(`npx prisma db push --schema="${tenantSchemaPath}" --skip-generate`);
        
        // Create a new Prisma client for the clinic's database
        const prismaClient = new PrismaClient({
          datasources: {
            db: {
              url: connectionString,
            },
          },
        });
        
        // Run any custom initialization queries if needed
        await prismaClient.$connect();
        await prismaClient.$executeRaw`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
        await prismaClient.$disconnect();
        
        this.logger.log(`Successfully initialized clinic database schema with Prisma`);
      } finally {
        // Clean up
        delete process.env.TENANT_DATABASE_URL;
      }
    } catch (error) {
      this.logger.error('Failed to initialize clinic database schema with Prisma', error);
      throw new Error(`Failed to initialize clinic database schema: ${error.message}`);
    }
  }

  /**
   * Generates a connection string for a clinic's database
   * @param databaseName The name of the database
   * @returns The connection string
   */
  private generateConnectionString(databaseName: string): string {
    const user = this.configService.get('POSTGRES_USER');
    const password = this.configService.get('POSTGRES_PASSWORD');
    const host = this.configService.get('POSTGRES_HOST');
    const port = this.configService.get('POSTGRES_PORT');

    // Add connection pool settings
    const poolConfig = {
      connection_limit: 5,  // Lower limit for tenant databases
      pool_timeout: 30,
      statement_timeout: 60000,  // 60 seconds
      idle_in_transaction_session_timeout: 60000  // 60 seconds
    };

    const poolParams = Object.entries(poolConfig)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    return `postgresql://${user}:${password}@${host}:${port}/${databaseName}?${poolParams}`;
  }

  /**
   * Delete a clinic's database
   * @param databaseName The name of the database to delete
   */
  async deleteClinicDatabase(databaseName: string): Promise<void> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Deleting clinic database',
        'ClinicDatabaseService',
        { databaseName }
      );

      // Check if the database exists
      const exists = await this.checkDatabaseExists(databaseName);
      if (!exists) {
        this.logger.warn(`Database ${databaseName} does not exist, skipping deletion`);
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Database does not exist, skipping deletion',
          'ClinicDatabaseService',
          { databaseName }
        );
        return;
      }

      // Delete the database using Postgres command
      await this.executeCommand(
        `psql -U ${this.configService.get('POSTGRES_USER')} -h ${this.configService.get('POSTGRES_HOST')} -c "DROP DATABASE ${databaseName};"`
      );

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic database deleted successfully',
        'ClinicDatabaseService',
        { databaseName }
      );

      await this.eventService.emit('clinic.database.deleted', {
        databaseName
      });
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to delete clinic database',
        'ClinicDatabaseService',
        { error: error.message, databaseName }
      );
      throw error;
    }
  }

  /**
   * Checks if a clinic's database exists
   * @param databaseName The name of the database to check
   * @returns boolean indicating if the database exists
   */
  async checkDatabaseExists(databaseName: string): Promise<boolean> {
    try {
      const result = await this.executeCommand(`
        psql -U ${this.configService.get('POSTGRES_USER')} -h ${this.configService.get('POSTGRES_HOST')} -t -c "
        SELECT 1 FROM pg_database WHERE datname = '${databaseName}';"
      `);
      
      return result.trim() === '1';
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to check database existence',
        'ClinicDatabaseService',
        { error: error.message, databaseName }
      );
      throw error;
    }
  }

  /**
   * Backup a clinic's database to a file
   * @param databaseName The name of the database to backup
   * @returns The path to the backup file
   */
  async backupClinicDatabase(databaseName: string): Promise<string> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Backing up clinic database',
        'ClinicDatabaseService',
        { databaseName }
      );

      // Check if the database exists
      const exists = await this.checkDatabaseExists(databaseName);
      if (!exists) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Database does not exist, cannot backup',
          'ClinicDatabaseService',
          { databaseName }
        );
        throw new NotFoundException(`Database ${databaseName} does not exist`);
      }

      // Create backup directory if it doesn't exist
      const backupDir = path.join(process.cwd(), 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // Create backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `${databaseName}_${timestamp}.sql`);

      // Execute pg_dump to create the backup
      await this.executeCommand(
        `pg_dump -U ${this.configService.get('POSTGRES_USER')} -h ${this.configService.get('POSTGRES_HOST')} -d ${databaseName} -f ${backupPath}`
      );

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic database backup created successfully',
        'ClinicDatabaseService',
        { databaseName, backupPath }
      );

      await this.eventService.emit('clinic.database.backup.created', {
        databaseName,
        backupPath
      });

      return backupPath;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to backup clinic database',
        'ClinicDatabaseService',
        { error: error.message, databaseName }
      );
      throw error;
    }
  }

  /**
   * Restore a clinic's database from a backup file
   * @param databaseName The name of the database to restore
   * @param backupPath The path to the backup file
   */
  async restoreClinicDatabase(databaseName: string, backupPath: string): Promise<void> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Restoring clinic database from backup',
        'ClinicDatabaseService',
        { databaseName, backupPath }
      );

      // Check if the backup file exists
      if (!fs.existsSync(backupPath)) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          'Backup file does not exist',
          'ClinicDatabaseService',
          { backupPath }
        );
        throw new NotFoundException('Backup file not found');
      }

      // Check if the database exists
      const exists = await this.checkDatabaseExists(databaseName);
      if (!exists) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Database does not exist, creating it before restore',
          'ClinicDatabaseService',
          { databaseName }
        );
        
        // Create the database first
        await this.executeCommand(
          `psql -U ${this.configService.get('POSTGRES_USER')} -h ${this.configService.get('POSTGRES_HOST')} -c "CREATE DATABASE ${databaseName};"`
        );
      } else {
        // Drop all connections to the database
        await this.executeCommand(
          `psql -U ${this.configService.get('POSTGRES_USER')} -h ${this.configService.get('POSTGRES_HOST')} -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${databaseName}' AND pid != pg_backend_pid();"`
        );
      }

      // Restore from backup
      await this.executeCommand(
        `psql -U ${this.configService.get('POSTGRES_USER')} -h ${this.configService.get('POSTGRES_HOST')} -d ${databaseName} -f "${backupPath}"`
      );

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic database restored successfully',
        'ClinicDatabaseService',
        { databaseName, backupPath }
      );

      await this.eventService.emit('clinic.database.restored', {
        databaseName,
        backupPath
      });
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to restore clinic database',
        'ClinicDatabaseService',
        { error: error.message, databaseName, backupPath }
      );
      throw error;
    }
  }

  /**
   * Executes a shell command
   * @param command The command to execute
   * @returns The command output
   */
  private async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`Command execution failed: ${error.message}`);
          this.logger.error(`Error: ${stderr}`);
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Updates all tenant databases to match the current schema
   * Call this method when you update the tenant.schema.prisma file
   * @returns A list of updated database names
   */
  async updateAllTenantDatabases(): Promise<string[]> {
    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Updating all tenant databases with new schema',
        'ClinicDatabaseService',
        {}
      );

      // Get all clinics
      const clinics = await this.prisma.clinic.findMany({
        select: {
          id: true,
          name: true,
          app_name: true,
          db_connection_string: true,
        }
      });

      const updatedDatabases: string[] = [];

      // For each clinic, update its database schema
      for (const clinic of clinics) {
        try {
          // Get the database name from app_name since databaseName field isn't available
          const dbName = `clinic_${clinic.app_name.toLowerCase()}_db`;
          
          // Check if database exists
          const exists = await this.checkDatabaseExists(dbName);
          if (!exists) {
            this.logger.warn(`Database ${dbName} does not exist, skipping update`);
            continue;
          }

          // Set environment variable for Prisma to use this connection string
          process.env.TENANT_DATABASE_URL = clinic.db_connection_string;
          
          // Get tenant schema path
          const tenantSchemaPath = path.join(__dirname, '../../shared/database/prisma/tenant.schema.prisma');
          
          // Run prisma db push to update the schema without migrations history
          this.logger.log(`Updating database schema for ${clinic.name} (${dbName})...`);
          await this.executeCommand(`npx prisma db push --schema="${tenantSchemaPath}" --skip-generate`);
          
          updatedDatabases.push(dbName);
          
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Successfully updated tenant database schema',
            'ClinicDatabaseService',
            { clinicId: clinic.id, clinicName: clinic.name, databaseName: dbName }
          );
        } catch (error) {
          this.logger.error(`Failed to update schema for ${clinic.app_name}`, error);
          await this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'Failed to update tenant database schema',
            'ClinicDatabaseService',
            { 
              error: error.message, 
              clinicId: clinic.id, 
              clinicName: clinic.name, 
              appName: clinic.app_name,
              dbName: `clinic_${clinic.app_name.toLowerCase()}_db`
            }
          );
    } finally {
          // Clean up
          delete process.env.TENANT_DATABASE_URL;
        }
      }

      return updatedDatabases;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to update all tenant databases',
        'ClinicDatabaseService',
        { error: error.message }
      );
      throw error;
    }
  }
} 