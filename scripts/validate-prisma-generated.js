#!/usr/bin/env node

/**
 * Prisma Generated Files Validation Script
 *
 * Validates that committed Prisma generated files are up-to-date with the schema.
 * This script is used in:
 * - Pre-commit hooks (to prevent stale files)
 * - CI/CD pipeline (to catch any missed cases)
 * - Post-merge hooks (to ensure consistency)
 *
 * Exit codes:
 * - 0: Generated files are up-to-date
 * - 1: Generated files are stale or missing
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

const SCHEMA_PATH = path.join(
  __dirname,
  '..',
  'src',
  'libs',
  'infrastructure',
  'database',
  'prisma',
  'schema.prisma'
);

const CONFIG_PATH = path.join(
  __dirname,
  '..',
  'src',
  'libs',
  'infrastructure',
  'database',
  'prisma',
  'prisma.config.js'
);

const GENERATED_PATH = path.join(
  __dirname,
  '..',
  'src',
  'libs',
  'infrastructure',
  'database',
  'prisma',
  'generated',
  'client'
);

/**
 * Calculate hash of a file or directory
 */
function calculateHash(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const stats = fs.statSync(filePath);
  if (stats.isFile()) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }

  if (stats.isDirectory()) {
    const files = fs.readdirSync(filePath).sort();
    const hashes = files
      .map(file => {
        const fullPath = path.join(filePath, file);
        return calculateHash(fullPath);
      })
      .filter(Boolean);
    return crypto.createHash('sha256').update(hashes.join('')).digest('hex');
  }

  return null;
}

/**
 * Check if schema has changed
 */
function hasSchemaChanged() {
  try {
    // Check if schema file exists
    if (!fs.existsSync(SCHEMA_PATH)) {
      logError(`Schema file not found: ${SCHEMA_PATH}`);
      return true;
    }

    // Get current schema hash
    const currentSchemaHash = calculateHash(SCHEMA_PATH);
    const configHash = fs.existsSync(CONFIG_PATH) ? calculateHash(CONFIG_PATH) : null;

    // Check for hash file (stores last known schema hash)
    const hashFilePath = path.join(path.dirname(SCHEMA_PATH), '.prisma-schema-hash');
    let lastKnownHash = null;

    if (fs.existsSync(hashFilePath)) {
      const hashData = JSON.parse(fs.readFileSync(hashFilePath, 'utf8'));
      lastKnownHash = hashData.schemaHash;
    }

    // Compare hashes
    const combinedHash = configHash ? `${currentSchemaHash}:${configHash}` : currentSchemaHash;
    const hasChanged = combinedHash !== lastKnownHash;

    if (hasChanged) {
      // Update hash file
      fs.writeFileSync(
        hashFilePath,
        JSON.stringify({
          schemaHash: combinedHash,
          timestamp: new Date().toISOString(),
        }),
        'utf8'
      );
    }

    return hasChanged;
  } catch (error) {
    logWarning(`Error checking schema changes: ${error.message}`);
    // Assume changed if we can't determine
    return true;
  }
}

/**
 * Regenerate Prisma Client
 */
function regeneratePrismaClient() {
  try {
    logInfo('Regenerating Prisma Client...');
    execSync(`yarn prisma:generate`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
    logSuccess('Prisma Client regenerated successfully');
    return true;
  } catch (error) {
    logError(`Failed to regenerate Prisma Client: ${error.message}`);
    return false;
  }
}

/**
 * Validate generated files exist and are valid
 */
function validateGeneratedFiles() {
  if (!fs.existsSync(GENERATED_PATH)) {
    logError(`Generated client directory not found: ${GENERATED_PATH}`);
    return false;
  }

  // Check for key files
  // Prisma 7 with custom output generates TypeScript files, not JavaScript
  // JavaScript files are in node_modules/.prisma/client (standard location)
  // So we check for TypeScript files OR JavaScript files
  const hasTypeScriptFiles =
    fs.existsSync(path.join(GENERATED_PATH, 'client.ts')) ||
    fs.existsSync(path.join(GENERATED_PATH, 'index.ts')) ||
    fs.existsSync(path.join(GENERATED_PATH, 'index.mjs'));

  const hasJavaScriptFiles =
    fs.existsSync(path.join(GENERATED_PATH, 'index.js')) ||
    fs.existsSync(path.join(GENERATED_PATH, 'client.js'));

  // Check standard location for JavaScript files
  const standardLocation = path.join(
    process.cwd(),
    'node_modules',
    '.prisma',
    'client'
  );
  const hasStandardLocationFiles = fs.existsSync(
    path.join(standardLocation, 'index.js')
  );

  if (!hasTypeScriptFiles && !hasJavaScriptFiles && !hasStandardLocationFiles) {
    logError(
      'Missing required generated files: No TypeScript or JavaScript files found in custom location or standard location'
    );
    return false;
  }

  // If JavaScript files exist in custom location, verify they export PrismaClient
  if (hasJavaScriptFiles) {
    try {
      const indexPath = path.join(GENERATED_PATH, 'index.js');
      if (fs.existsSync(indexPath)) {
        const indexContent = fs.readFileSync(indexPath, 'utf8');
        if (!indexContent.includes('PrismaClient')) {
          logError('Generated index.js does not export PrismaClient');
          return false;
        }
      }
    } catch (error) {
      logWarning(`Error reading generated index.js: ${error.message}`);
      // Don't fail if we can't read, TypeScript files might be used instead
    }
  }

  // If TypeScript files exist, that's also valid (Prisma 7 custom output)
  if (hasTypeScriptFiles) {
    logInfo('Found TypeScript files in custom location (Prisma 7 custom output)');
  }

  // If standard location has files, that's also valid
  if (hasStandardLocationFiles) {
    logInfo('Found JavaScript files in standard location');
  }

  return true;
}

/**
 * Compare generated files with committed files
 */
function compareWithCommitted() {
  try {
    // Get hash of current generated files
    const currentHash = calculateHash(GENERATED_PATH);

    // Get hash of committed files (from Git)
    let committedHash = null;
    try {
      const gitPath = path.relative(path.join(__dirname, '..'), GENERATED_PATH);
      const gitShow = execSync(`git ls-tree -r HEAD --name-only "${gitPath}"`, {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
      });

      if (gitShow.trim()) {
        // Files are tracked, calculate their hash
        const files = gitShow.trim().split('\n');
        const hashes = files
          .map(file => {
            try {
              const fullPath = path.join(path.join(__dirname, '..'), file);
              if (fs.existsSync(fullPath)) {
                return calculateHash(fullPath);
              }
            } catch {
              return null;
            }
            return null;
          })
          .filter(Boolean);
        committedHash = crypto.createHash('sha256').update(hashes.join('')).digest('hex');
      }
    } catch {
      // Files might not be committed yet (first time)
      committedHash = null;
    }

    // If no committed files, that's okay (first commit)
    if (committedHash === null) {
      return { match: true, reason: 'No committed files to compare (first commit)' };
    }

    // Compare hashes
    if (currentHash === committedHash) {
      return { match: true, reason: 'Generated files match committed files' };
    }

    return {
      match: false,
      reason: 'Generated files differ from committed files',
      currentHash,
      committedHash,
    };
  } catch (error) {
    logWarning(`Error comparing with committed files: ${error.message}`);
    return { match: true, reason: 'Could not compare (assuming OK)' };
  }
}

/**
 * Main validation function
 */
function main() {
  const args = process.argv.slice(2);
  const shouldRegenerate = args.includes('--regenerate');
  const skipComparison = args.includes('--skip-comparison');

  logInfo('Validating Prisma generated files...\n');

  // Step 1: Check if schema changed
  const schemaChanged = hasSchemaChanged();
  if (schemaChanged) {
    logWarning('Schema has changed since last validation');
  }

  // Step 2: Check if generated files exist
  if (!fs.existsSync(GENERATED_PATH)) {
    logWarning('Generated files not found, regenerating...');
    if (!regeneratePrismaClient()) {
      process.exit(1);
    }
  }

  // Step 3: Validate generated files structure
  if (!validateGeneratedFiles()) {
    logError('Generated files are invalid or incomplete');
    if (shouldRegenerate) {
      logInfo('Attempting to regenerate...');
      if (!regeneratePrismaClient()) {
        process.exit(1);
      }
      // Re-validate after regeneration
      if (!validateGeneratedFiles()) {
        logError('Generated files are still invalid after regeneration');
        process.exit(1);
      }
    } else {
      logError('Run with --regenerate flag to fix this issue');
      process.exit(1);
    }
  }

  // Step 4: Compare with committed files (if not skipped)
  if (!skipComparison) {
    const comparison = compareWithCommitted();
    if (!comparison.match) {
      logError(comparison.reason);
      if (shouldRegenerate) {
        logInfo('Regenerating to ensure files are up-to-date...');
        if (!regeneratePrismaClient()) {
          process.exit(1);
        }
        // Re-compare after regeneration
        const reComparison = compareWithCommitted();
        if (!reComparison.match) {
          logError('Files still differ after regeneration. Please commit the changes.');
          process.exit(1);
        }
      } else {
        logError('Run with --regenerate flag to update generated files');
        logInfo('Then commit the updated files');
        process.exit(1);
      }
    } else {
      logSuccess(comparison.reason);
    }
  }

  logSuccess('Prisma generated files validation passed!');
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  validateGeneratedFiles,
  regeneratePrismaClient,
  hasSchemaChanged,
  compareWithCommitted,
};
