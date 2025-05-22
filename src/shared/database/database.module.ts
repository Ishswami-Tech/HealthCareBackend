import { Module, Global, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaModule } from './prisma/prisma.module';
import { initDatabase } from './scripts/init-db';

@Global()
@Module({
  imports: [PrismaModule, ConfigModule],
  exports: [PrismaModule],
})
export class DatabaseModule implements OnModuleInit {
  private readonly logger = new Logger(DatabaseModule.name);
  
  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      // Determine environment
      const isProduction = process.env.NODE_ENV === 'production';
      const isDocker = fs.existsSync('/.dockerenv');
      const isWindows = process.platform === 'win32';
      
      // Get schema path from environment
      const originalSchemaPath = this.configService.get<string>('PRISMA_SCHEMA_PATH');
      let resolvedSchemaPath = originalSchemaPath;
      
      this.logger.log(`Original schema path: ${originalSchemaPath}`);
      this.logger.log(`Environment: ${isProduction ? 'Production' : 'Development'}, Docker: ${isDocker}, Windows: ${isWindows}`);
      
      // Handle different path formats based on environment
      if (originalSchemaPath) {
        if (originalSchemaPath.startsWith('./')) {
          // Relative path - resolve from current working directory
          resolvedSchemaPath = path.resolve(process.cwd(), originalSchemaPath.substring(2));
        } else if (originalSchemaPath.startsWith('/app/') && isWindows && !isDocker) {
          // Docker path on Windows local development
          resolvedSchemaPath = path.resolve(process.cwd(), originalSchemaPath.replace('/app/', ''));
        } else if (originalSchemaPath.includes('C:/Program Files/Git/app/')) {
          // Incorrectly resolved Git path on Windows
          resolvedSchemaPath = path.resolve(process.cwd(), 
              originalSchemaPath.replace('C:/Program Files/Git/app/', ''));
        }
      } else {
        // Default fallback paths
        if (isDocker) {
          resolvedSchemaPath = '/app/src/shared/database/prisma/schema.prisma';
        } else {
          resolvedSchemaPath = path.resolve(process.cwd(), 'src/shared/database/prisma/schema.prisma');
        }
      }
      
      // Make sure the path actually exists
      if (!fs.existsSync(resolvedSchemaPath)) {
        this.logger.warn(`Resolved schema path ${resolvedSchemaPath} does not exist, trying to find alternatives...`);
        
        // Try some alternative paths
        const alternatives = [
          path.resolve(process.cwd(), 'src/shared/database/prisma/schema.prisma'),
          path.resolve(process.cwd(), 'dist/shared/database/prisma/schema.prisma'),
          path.resolve(__dirname, '../prisma/schema.prisma'),
          isDocker ? '/app/src/shared/database/prisma/schema.prisma' : null,
          isDocker ? '/app/dist/shared/database/prisma/schema.prisma' : null
        ].filter(Boolean);
        
        for (const alt of alternatives) {
          if (fs.existsSync(alt)) {
            resolvedSchemaPath = alt;
            this.logger.log(`Found alternative schema path: ${alt}`);
            break;
          }
        }
      }
      
      this.logger.log(`Using schema path: ${resolvedSchemaPath}`);
      
      // Update environment variable for other services to use
      process.env.PRISMA_SCHEMA_PATH = resolvedSchemaPath;
      
      // Initialize the database
      await initDatabase();
      this.logger.log('Database initialization completed successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize database module: ${error.message}`, error.stack);
      throw error;
    }
  }
} 