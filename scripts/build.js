#!/usr/bin/env node

/**
 * Comprehensive Build Script
 * Performs all validation checks before building and shows completion message
 * 
 * Build Process:
 * - Uses SWC compiler (20x faster than TypeScript compiler)
 * - Type checking runs in parallel with SWC compilation
 * - Configuration: nest-cli.json (SWC builder enabled)
 * - Enforces strict TypeScript rules (no @ts-ignore, no eslint-disable)
 * - Auto-fixes security vulnerabilities
 */

const { execSync } = require('child_process');
const fs = require('fs');
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
  log(`[OK] ${message}`, 'green');
}

function logWarning(message) {
  log(`[WARN] ${message}`, 'yellow');
}

function logError(message) {
  log(`[ERROR] ${message}`, 'red');
}

function runCommand(command, description, continueOnError = false) {
  const stepStartTime = Date.now();
  try {
    logStep('→', description);
    // Use yarn run for npm scripts to ensure local node_modules are used
    const fullCommand =
      command.startsWith('yarn run') || command.startsWith('yarn') || command.startsWith('cross-env') || command.startsWith('node')
        ? command
        : `yarn run ${command}`;

    execSync(fullCommand, {
      stdio: 'inherit',
      cwd: process.cwd(),
      shell: true,
    });
    const stepTime = ((Date.now() - stepStartTime) / 1000).toFixed(2);
    logSuccess(`${description} completed (${stepTime}s)`);
    return { success: true, time: parseFloat(stepTime) };
  } catch (error) {
    const stepTime = ((Date.now() - stepStartTime) / 1000).toFixed(2);
    if (continueOnError) {
      logWarning(`${description} failed but continuing... (${stepTime}s)`);
      return { success: false, time: parseFloat(stepTime) };
    } else {
      logError(`${description} failed (${stepTime}s)`);
      throw error;
    }
  }
}

function getBuildSize() {
  try {
    const distPath = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(distPath)) {
      return 'N/A';
    }
    
    // Calculate directory size
    let totalSize = 0;
    function calculateSize(dir) {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          calculateSize(filePath);
        } else {
          totalSize += stat.size;
        }
      });
    }
    calculateSize(distPath);
    
    // Format size
    if (totalSize < 1024) {
      return `${totalSize} B`;
    } else if (totalSize < 1024 * 1024) {
      return `${(totalSize / 1024).toFixed(2)} KB`;
    } else {
      return `${(totalSize / (1024 * 1024)).toFixed(2)} MB`;
    }
  } catch (error) {
    return 'N/A';
  }
}

function verifyBuildArtifacts() {
  const requiredFiles = [
    'main.js',
    'app.module.js',
  ];
  
  const missingFiles = [];
  requiredFiles.forEach((file) => {
    const filePath = path.join(process.cwd(), 'dist', file);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(file);
    }
  });
  
  if (missingFiles.length > 0) {
    throw new Error(`Missing build artifacts: ${missingFiles.join(', ')}`);
  }
  
  logSuccess(`Build artifacts verified (${requiredFiles.length} files)`);
}

function main() {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const environment = args[0] || 'development';
  const stepTimes = {};
  let validationCount = 0;
  let warningCount = 0;

  log('\n' + '='.repeat(60), 'bright');
  log('Healthcare Backend - Build Process', 'bright');
  log('='.repeat(60) + '\n', 'bright');

  try {
    // Pre-build validation steps
    log('Pre-Build Validation', 'blue');
    log('-'.repeat(60), 'blue');

    // Critical validations (must pass)
    const prismaResult = runCommand('yarn run prisma:validate', 'Prisma schema validation');
    stepTimes['Prisma Validation'] = prismaResult.time;
    validationCount++;

    // Generate Prisma Client before type checking to ensure types are available
    logStep('→', 'Generating Prisma Client (required for type checking)');
    const prismaGenerateResult = runCommand('yarn run prisma:generate', 'Prisma Client generation', true);
    stepTimes['Prisma Generate'] = prismaGenerateResult.time;
    if (!prismaGenerateResult.success) {
      logWarning('Prisma Client generation had issues, but continuing...');
      warningCount++;
    }

    const envResult = runCommand('yarn run env:validate', 'Environment variables validation');
    stepTimes['Environment Validation'] = envResult.time;
    validationCount++;

    // Check for forbidden comments and code quality (consolidated validation)
    logStep('→', 'Validating code quality (forbidden comments, TODOs, outdated deps)');
    const codeValidationResult = runCommand('node scripts/validate-code.js', 'Code validation check');
    stepTimes['Code Validation'] = codeValidationResult.time;
    validationCount++;

    const typeCheckResult = runCommand('yarn run type-check', 'TypeScript type checking');
    stepTimes['TypeScript Check'] = typeCheckResult.time;
    validationCount++;

    const lintResult = runCommand('yarn run lint', 'ESLint code quality check and fix');
    stepTimes['ESLint Fix'] = lintResult.time;
    validationCount++;

    const formatResult = runCommand('yarn run format', 'Prettier formatting check and fix');
    stepTimes['Prettier Format'] = formatResult.time;
    validationCount++;

    // Verify fixes were successful
    const lintCheckResult = runCommand('yarn run lint:check', 'ESLint verification (after fixes)');
    stepTimes['ESLint Verification'] = lintCheckResult.time;
    validationCount++;

    const formatCheckResult = runCommand('yarn run format:check', 'Prettier verification (after fixes)');
    stepTimes['Prettier Verification'] = formatCheckResult.time;
    validationCount++;

    // Security and dependency checks
    log('\nSecurity & Dependency Checks', 'blue');
    log('-'.repeat(60), 'blue');
    
    // Auto-fix vulnerabilities first
    logStep('→', 'Auto-fixing security vulnerabilities');
    const vulnFixResult = runCommand('node scripts/fix-vulnerabilities.js', 'Vulnerability auto-fix', true);
    stepTimes['Vulnerability Fix'] = vulnFixResult.time;
    if (!vulnFixResult.success) warningCount++;

    // Security audit - fail for production, warn for others
    if (environment === 'production') {
      const auditResult = runCommand('yarn run security:audit', 'Security audit (production - strict)');
      stepTimes['Security Audit'] = auditResult.time;
      validationCount++;
    } else {
      const auditResult = runCommand('yarn run security:audit', 'Security audit', true);
      stepTimes['Security Audit'] = auditResult.time;
      if (!auditResult.success) warningCount++;
    }

    const depsResult = runCommand('yarn run deps:check', 'Dependency check', true);
    stepTimes['Dependency Check'] = depsResult.time;
    if (!depsResult.success) warningCount++;

    const outdatedResult = runCommand('yarn run outdated:check', 'Outdated dependencies check', true);
    stepTimes['Outdated Check'] = outdatedResult.time;
    if (!outdatedResult.success) warningCount++;

    const todoResult = runCommand('yarn run todo:check', 'TODO/FIXME check', true);
    stepTimes['TODO Check'] = todoResult.time;
    if (!todoResult.success) warningCount++;

    // Build step
    log('\nBuilding Application', 'blue');
    log('-'.repeat(60), 'blue');

    // Set environment variable and run nest build
    // Note: nest build uses SWC compiler (configured in nest-cli.json)
    // SWC provides 20x faster compilation than TypeScript compiler
    // Type checking runs in parallel with SWC compilation
    const envPrefix =
      environment === 'production'
        ? 'cross-env NODE_ENV=production'
        : environment === 'staging'
          ? 'cross-env NODE_ENV=staging'
          : 'cross-env NODE_ENV=development';

    const buildResult = runCommand(`${envPrefix} nest build`, `Building for ${environment} environment (using SWC compiler)`);
    stepTimes['SWC Compilation'] = buildResult.time;
    validationCount++;

    // Post-build verification
    log('\nPost-Build Verification', 'blue');
    log('-'.repeat(60), 'blue');
    
    verifyBuildArtifacts();
    const buildSize = getBuildSize();
    stepTimes['Artifact Verification'] = 0.1; // Minimal time

    // Calculate build time
    const buildTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Success message with detailed summary
    log('\n' + '='.repeat(60), 'green');
    log(`BUILD COMPLETE!`, 'green');
    log('='.repeat(60), 'green');
    
    log('\n📊 Build Summary:', 'bright');
    log(`  ✅ Validations: ${validationCount} passed`, 'green');
    if (warningCount > 0) {
      log(`  ⚠️  Warnings: ${warningCount}`, 'yellow');
    }
    log(`  📦 Build size: ${buildSize}`, 'cyan');
    log(`  ⏱️  Total time: ${buildTime}s`, 'cyan');
    log(`  📁 Output directory: dist/`, 'cyan');
    log(`  🌍 Environment: ${environment}`, 'cyan');
    
    // Show step timing breakdown
    log('\n⏱️  Step Timing Breakdown:', 'bright');
    Object.entries(stepTimes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([step, time]) => {
        log(`  ${step}: ${time}s`, 'cyan');
      });
    
    log('\nReady for deployment!\n', 'bright');

    process.exit(0);
  } catch (error) {
    const buildTime = ((Date.now() - startTime) / 1000).toFixed(2);

    log('\n' + '='.repeat(60), 'red');
    log('BUILD FAILED', 'red');
    log('='.repeat(60), 'red');
    log(`\nBuild failed after ${buildTime}s`, 'red');
    log(`Please fix the errors above and try again.\n`, 'yellow');

    process.exit(1);
  }
}

main();
