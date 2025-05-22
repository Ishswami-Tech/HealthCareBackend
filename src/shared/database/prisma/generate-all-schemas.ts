import { exec } from 'child_process';
import * as path from 'path';
import * as util from 'util';
import { Logger } from '@nestjs/common';

const execPromise = util.promisify(exec);
const logger = new Logger('PrismaSchemaGenerator');

/**
 * Script to generate Prisma schema
 * This should be run after any changes to schema.prisma
 */
async function generateSchema() {
  try {
    logger.log('Starting Prisma schema generation...');
    
    // Get absolute path to Prisma schema file
    const schemaPath = path.resolve(__dirname, './schema.prisma');
    
    // Generate database client
    logger.log('Generating database client...');
    await execPromise(`npx prisma generate --schema="${schemaPath}"`);
    logger.log('✅ Database client generated successfully');
    
    logger.log('Prisma schema generated successfully!');
    logger.log('');
    logger.log('To apply schema changes to the database run:');
    logger.log('npx prisma migrate dev --schema=./src/shared/database/prisma/schema.prisma');
    
    return 0;
  } catch (error) {
    logger.error('Failed to generate Prisma schema', error.stack);
    return 1;
  }
}

// Run the function and exit with appropriate code
generateSchema()
  .then((exitCode) => process.exit(exitCode))
  .catch(() => process.exit(1)); 