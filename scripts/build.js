#!/usr/bin/env node

/**
 * Comprehensive Build Script
 * Performs all validation checks before building and shows completion message
 */

const { execSync } = require('child_process');
const path = require('path');

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

function logStep(step, message) {
  log(`\n${step} ${message}`, 'cyan');
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function runCommand(command, description, continueOnError = false) {
  try {
    logStep('→', description);
    // Use pnpm run for npm scripts to ensure local node_modules are used
    const fullCommand =
      command.startsWith('pnpm run') || command.startsWith('cross-env')
        ? command
        : `pnpm run ${command}`;

    execSync(fullCommand, {
      stdio: 'inherit',
      cwd: process.cwd(),
      shell: true,
    });
    logSuccess(`${description} completed`);
    return true;
  } catch (error) {
    if (continueOnError) {
      logWarning(`${description} failed but continuing...`);
      return false;
    } else {
      logError(`${description} failed`);
      throw error;
    }
  }
}

function main() {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const environment = args[0] || 'development';
  const buildCommand =
    environment === 'production'
      ? 'pnpm run build:production'
      : environment === 'staging'
        ? 'pnpm run build:staging'
        : 'pnpm run build:dev';

  log('\n' + '='.repeat(60), 'bright');
  log('🚀 Healthcare Backend - Build Process', 'bright');
  log('='.repeat(60) + '\n', 'bright');

  try {
    // Pre-build validation steps
    log('📋 Pre-Build Validation', 'blue');
    log('-'.repeat(60), 'blue');

    // Critical validations (must pass)
    runCommand('pnpm run prisma:validate', 'Prisma schema validation');
    runCommand('pnpm run env:validate', 'Environment variables validation');
    runCommand('pnpm run type-check', 'TypeScript type checking');
    runCommand('pnpm run lint', 'ESLint code quality check and fix');
    runCommand('pnpm run format', 'Prettier formatting check and fix');
    // Verify fixes were successful
    runCommand('pnpm run lint:check', 'ESLint verification (after fixes)');
    runCommand('pnpm run format:check', 'Prettier verification (after fixes)');

    // Security and dependency checks (warnings only)
    log('\n🔒 Security & Dependency Checks', 'blue');
    log('-'.repeat(60), 'blue');
    runCommand('pnpm run security:audit', 'Security audit', true);
    runCommand('pnpm run deps:check', 'Dependency check', true);
    runCommand('pnpm run outdated:check', 'Outdated dependencies check', true);
    runCommand('pnpm run todo:check', 'TODO/FIXME check', true);

    // Build step
    log('\n🔨 Building Application', 'blue');
    log('-'.repeat(60), 'blue');

    // Set environment variable and run nest build
    const envPrefix =
      environment === 'production'
        ? 'cross-env NODE_ENV=production'
        : environment === 'staging'
          ? 'cross-env NODE_ENV=staging'
          : 'cross-env NODE_ENV=development';

    runCommand(`${envPrefix} nest build`, `Building for ${environment} environment`);

    // Calculate build time
    const buildTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Success message
    log('\n' + '='.repeat(60), 'green');
    log(`✅ BUILD COMPLETE!`, 'green');
    log('='.repeat(60), 'green');
    log(`\n✨ Build completed successfully in ${buildTime}s`, 'green');
    log(`📦 Output directory: dist/`, 'green');
    log(`🌍 Environment: ${environment}`, 'green');
    log('\n🎉 Ready for deployment!\n', 'bright');

    process.exit(0);
  } catch (error) {
    const buildTime = ((Date.now() - startTime) / 1000).toFixed(2);

    log('\n' + '='.repeat(60), 'red');
    log('❌ BUILD FAILED', 'red');
    log('='.repeat(60), 'red');
    log(`\n⏱️  Build failed after ${buildTime}s`, 'red');
    log(`💡 Please fix the errors above and try again.\n`, 'yellow');

    process.exit(1);
  }
}

main();
