import { Logger } from '@nestjs/common';
import { exec } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);
const logger = new Logger('DatabaseInit');

/**
 * Initialize the database with the schema
 */
export async function initDatabase() {
  try {
    logger.log('Initializing database...');
    
    // Use the PRISMA_SCHEMA_PATH environment variable directly (already resolved in DatabaseModule)
    let schemaPath = process.env.PRISMA_SCHEMA_PATH;
    
    // Final validation to ensure schema exists
    if (!schemaPath || !fs.existsSync(schemaPath)) {
      logger.warn(`Schema path ${schemaPath} not valid or does not exist, falling back to search`);
      
      // If not set or doesn't exist, try to find it
      const isDocker = fs.existsSync('/.dockerenv');
      const isProduction = process.env.NODE_ENV === 'production';
      const isWindows = process.platform === 'win32';
      
      // Find the first path that exists
      const possiblePaths = [
        path.resolve(process.cwd(), 'src/shared/database/prisma/schema.prisma'),
        path.resolve(process.cwd(), 'dist/shared/database/prisma/schema.prisma'),
        path.resolve(__dirname, '../prisma/schema.prisma'),
        isDocker ? '/app/src/shared/database/prisma/schema.prisma' : null,
        isDocker ? '/app/dist/shared/database/prisma/schema.prisma' : null
      ].filter(Boolean);
      
      for (const potentialPath of possiblePaths) {
        try {
          if (fs.existsSync(potentialPath)) {
            schemaPath = potentialPath;
            logger.log(`Found Prisma schema at: ${schemaPath}`);
            break;
          }
        } catch (err) {
          // Continue to next path
        }
      }
    }
    
    if (!schemaPath) {
      throw new Error('Could not find valid Prisma schema file. Check application configuration.');
    }
    
    // Log platform info for debugging
    logger.log(`Platform: ${process.platform}, Docker: ${fs.existsSync('/.dockerenv')}`);
    logger.log(`Working directory: ${process.cwd()}`);
    logger.log(`Schema path: ${schemaPath}`);
    
    // On Windows, handle paths with spaces
    const schemaPathForCommand = process.platform === 'win32' 
      ? `"${schemaPath}"` 
      : `"${schemaPath}"`; // Use double quotes for all platforms for consistency
    
    // Run Prisma generate to ensure client is up-to-date
    logger.log(`Generating Prisma client with schema: ${schemaPath}...`);
    try {
      // Check if Prisma client already exists
      const clientPath = path.join(process.cwd(), 'node_modules', '.prisma', 'client');
      const clientExists = fs.existsSync(clientPath);
      
      if (clientExists) {
        logger.log('Prisma client already exists, skipping generation');
      } else {
        const { stdout, stderr } = await execAsync(`npx prisma generate --schema=${schemaPathForCommand}`);
        logger.log('Prisma client generation output: ' + stdout);
        if (stderr) logger.warn('Prisma client generation warnings: ' + stderr);
      }
    } catch (error) {
      logger.error(`Failed to generate Prisma client: ${error.message}`);
      logger.error(`Command output: ${error.stdout || 'No output'}`);
      logger.error(`Command error: ${error.stderr || 'No error details'}`);
      throw error;
    }
    
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      logger.error('DATABASE_URL is not set');
      throw new Error('DATABASE_URL environment variable is not set. Database connection cannot be established.');
    }
    
    // Run Prisma migrate to apply any pending migrations
    logger.log('Applying database migrations...');
    try {
      const { stdout, stderr } = await execAsync(`npx prisma migrate deploy --schema=${schemaPathForCommand}`);
      logger.log('Migration output: ' + stdout);
      if (stderr) logger.warn('Migration warnings: ' + stderr);
    } catch (error) {
      logger.warn(`Migration failed, falling back to prisma db push: ${error.message}`);
      // If migration fails, try db push as a fallback (useful for development)
      try {
        const { stdout, stderr } = await execAsync(`npx prisma db push --schema=${schemaPathForCommand}`);
        logger.log('DB Push output: ' + stdout);
        if (stderr) logger.warn('DB Push warnings: ' + stderr);
      } catch (pushError) {
        logger.error(`DB Push also failed: ${pushError.message}`);
        logger.error(`Command output: ${pushError.stdout || 'No output'}`);
        logger.error(`Command error: ${pushError.stderr || 'No error details'}`);
        throw pushError;
      }
    }
    
    logger.log('Database initialization complete!');
    
    return true;
  } catch (error) {
    logger.error(`Database initialization failed: ${error.message}`, error.stack);
    throw error;
  }
}

// Allow running directly
if (require.main === module) {
  initDatabase()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      // No need to disconnect as the process will exit
    });
}

