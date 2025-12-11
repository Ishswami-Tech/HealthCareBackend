#!/usr/bin/env node

/**
 * Auto-fix security vulnerabilities
 * Attempts to update vulnerable packages to patched versions
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function runCommand(command, description) {
  try {
    log(`→ ${description}...`, 'cyan');
    execSync(command, {
      stdio: 'inherit',
      cwd: process.cwd(),
      shell: true,
    });
    log(`✅ ${description} completed`, 'green');
    return true;
  } catch (error) {
    log(`⚠️  ${description} failed (non-critical)`, 'yellow');
    return false;
  }
}

function main() {
  log('\n' + '='.repeat(60), 'cyan');
  log('Security Vulnerability Auto-Fix', 'cyan');
  log('='.repeat(60) + '\n', 'cyan');
  
  try {
    // Step 1: Run audit to identify vulnerabilities
    log('Step 1: Identifying vulnerabilities...', 'yellow');
    let auditOutput = '';
    try {
      auditOutput = execSync('pnpm audit --json', {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
    } catch (error) {
      // pnpm audit exits with non-zero if vulnerabilities found
      auditOutput = error.stdout || '';
    }
    
    const auditData = JSON.parse(auditOutput || '{}');
    const vulnerabilities = auditData.vulnerabilities || {};
    
    if (Object.keys(vulnerabilities).length === 0) {
      log('✅ No vulnerabilities found', 'green');
      return;
    }
    
    log(`Found ${Object.keys(vulnerabilities).length} vulnerable package(s)`, 'yellow');
    
    // Step 2: Try to fix with pnpm audit --fix
    log('\nStep 2: Attempting automatic fixes...', 'yellow');
    runCommand('pnpm audit --fix', 'Auto-fixing vulnerabilities');
    
    // Step 3: Force update vulnerable transitive dependencies via pnpm overrides
    log('\nStep 3: Ensuring pnpm overrides for vulnerable packages...', 'yellow');
    
    // Known vulnerable packages that need updates
    // jws@4.0.0 has vulnerability (GHSA-869p-cjfg-cm3x) - requires 4.0.1+
    const vulnerablePackages = [
      { name: 'jws', minVersion: '4.0.1', reason: 'HMAC signature verification vulnerability (GHSA-869p-cjfg-cm3x)' },
    ];
    
    // Check and update pnpm.overrides in package.json
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    
    if (!packageJson.pnpm) {
      packageJson.pnpm = {};
    }
    if (!packageJson.pnpm.overrides) {
      packageJson.pnpm.overrides = {};
    }
    
    let needsUpdate = false;
    vulnerablePackages.forEach(({ name, minVersion, reason }) => {
      const currentOverride = packageJson.pnpm.overrides[name];
      const requiredVersion = `>=${minVersion}`;
      
      if (currentOverride !== requiredVersion) {
        log(`Updating pnpm override for ${name}: ${currentOverride || 'none'} → ${requiredVersion}`, 'cyan');
        log(`  Reason: ${reason}`, 'yellow');
        packageJson.pnpm.overrides[name] = requiredVersion;
        needsUpdate = true;
      } else {
        log(`✅ ${name} already has correct override (${requiredVersion})`, 'green');
      }
    });
    
    if (needsUpdate) {
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
      log('Updated package.json with pnpm overrides', 'green');
      log('Reinstalling dependencies to apply overrides...', 'cyan');
      runCommand('pnpm install', 'Reinstall with overrides');
    }
    
    // Step 4: Verify fixes
    log('\nStep 4: Verifying fixes...', 'yellow');
    try {
      execSync('pnpm audit --audit-level=high', {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
      log('✅ High-severity vulnerabilities resolved', 'green');
    } catch (error) {
      log('⚠️  Some vulnerabilities may still exist', 'yellow');
      log('Please review and update manually if needed', 'yellow');
    }
    
    log('\n' + '='.repeat(60), 'green');
    log('Vulnerability fix process completed', 'green');
    log('='.repeat(60) + '\n', 'green');
    
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
    log('Please fix vulnerabilities manually', 'yellow');
    process.exit(1);
  }
}

main();

