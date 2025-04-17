import { Logger } from '@nestjs/common';
import { exec } from 'child_process';
import * as path from 'path';
import * as util from 'util';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load environment variables
dotenv.config();

const execPromise = util.promisify(exec);
const logger = new Logger('TenantSchemaUpdate');

/**
 * Simple script to update the tenant database schema for a specific database
 * This avoids the complexity of NestJS dependency injection and database querying
 */
async function updateTenantSchema() {
  logger.log('Starting tenant database schema update...');

  try {
    // Get tenant schema path
    const tenantSchemaPath = path.join(__dirname, './tenant.schema.prisma');
    
    // Make sure the tenant schema file exists
    if (!fs.existsSync(tenantSchemaPath)) {
      logger.error(`Tenant schema file not found at ${tenantSchemaPath}`);
      return;
    }

    // Get database URL from environment or use a default test DB
    const databaseUrl = process.env.TENANT_DATABASE_URL || 
                       process.env.TEST_TENANT_DATABASE_URL || 
                       'postgresql://postgres:postgres@localhost:5432/test_tenant_db';
    
    logger.log('Using database URL from environment variables');
    
    // Set environment variable for Prisma to use this connection string
    process.env.TENANT_DATABASE_URL = databaseUrl;
    
    // Run prisma db push to update the schema without migrations history
    logger.log('Updating tenant database schema...');
    
    // First verify the schema is valid
    logger.log('Verifying schema...');
    await execPromise(`npx prisma validate --schema="${tenantSchemaPath}"`);
    logger.log('Schema validation successful');
    
    // Then push the schema to the database
    logger.log('Pushing schema to database...');
    const result = await execPromise(`npx prisma db push --schema="${tenantSchemaPath}" --skip-generate`);
    logger.log(result.stdout);
    
    logger.log('Tenant database schema updated successfully');
  } catch (error) {
    logger.error(`Failed to update tenant database schema: ${error.message}`);
    process.exit(1);
  }
}

// Run the function
updateTenantSchema()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Unhandled error', error);
    process.exit(1);
  }); 