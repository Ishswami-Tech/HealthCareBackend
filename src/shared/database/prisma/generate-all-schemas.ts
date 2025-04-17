import { exec } from 'child_process';
import * as path from 'path';
import * as util from 'util';
import { Logger } from '@nestjs/common';

const execPromise = util.promisify(exec);
const logger = new Logger('PrismaSchemaGenerator');

/**
 * Script to generate Prisma schemas for both main and tenant databases
 * This should be run after any changes to either schema.prisma or tenant.schema.prisma
 */
async function generateAllSchemas() {
  try {
    logger.log('Starting Prisma schema generation...');
    
    // Get absolute paths to Prisma schema files
    const mainSchemaPath = path.resolve(__dirname, './schema.prisma');
    const tenantSchemaPath = path.resolve(__dirname, './tenant.schema.prisma');
    
    // Step 1: Generate main database client
    logger.log('Generating main database client...');
    await execPromise(`npx prisma generate --schema="${mainSchemaPath}"`);
    logger.log('✅ Main database client generated successfully');
    
    // Step 2: Generate tenant database client
    logger.log('Generating tenant database client...');
    
    // The tenant schema uses a different output path in the generator block
    // If TENANT_DATABASE_URL is not set, we use a placeholder for generation only
    if (!process.env.TENANT_DATABASE_URL) {
      process.env.TENANT_DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder_db';
      logger.log('Using placeholder database URL for tenant schema generation');
    }
    
    await execPromise(`npx prisma generate --schema="${tenantSchemaPath}"`);
    logger.log('✅ Tenant database client generated successfully');
    
    logger.log('All Prisma schemas generated successfully!');
    logger.log('');
    logger.log('To update schema for existing tenant databases run:');
    logger.log('npm run tenant:update-schema');
    
    return 0;
  } catch (error) {
    logger.error('Failed to generate Prisma schemas', error.stack);
    return 1;
  }
}

// Run the function and exit with appropriate code
generateAllSchemas()
  .then((exitCode) => process.exit(exitCode))
  .catch(() => process.exit(1)); 