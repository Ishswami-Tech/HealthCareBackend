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
      auditOutput = execSync('yarn audit --json', {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
    } catch (error) {
      // yarn audit exits with non-zero if vulnerabilities found
      auditOutput = error.stdout || '';
    }

    // yarn audit --json outputs multiple JSON objects (one per line)
    // We need to parse each line separately
    let vulnerabilities = {};
    let hasVulnerabilities = false;

    if (auditOutput.trim()) {
      const lines = auditOutput.trim().split('\n');
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'auditSummary' && parsed.data) {
            vulnerabilities = parsed.data.vulnerabilities || {};
            hasVulnerabilities = Object.keys(vulnerabilities).length > 0;
            break;
          }
        } catch (e) {
          // Skip invalid JSON lines
          continue;
        }
      }
    }

    if (!hasVulnerabilities) {
      log('✅ No vulnerabilities found', 'green');
      return;
    }

    log(`Found vulnerabilities in audit`, 'yellow');

    // Step 2: Try to fix with yarn audit (yarn doesn't have --fix, so we use resolutions)
    log('\nStep 2: Attempting automatic fixes via yarn resolutions...', 'yellow');

    // Step 3: Force update vulnerable transitive dependencies via yarn resolutions
    log('\nStep 3: Ensuring yarn resolutions for vulnerable packages...', 'yellow');

    // Known vulnerable packages that need updates
    const vulnerablePackages = [
      {
        name: 'jws',
        minVersion: '4.0.1',
        reason: 'HMAC signature verification (GHSA-869p-cjfg-cm3x)',
      },
      {
        name: 'webpack',
        minVersion: '5.104.1',
        reason: 'buildHttp SSRF bypass (npm advisory 1113041/1113042)',
      },
      {
        name: 'diff',
        minVersion: '4.0.4',
        reason: 'Denial of Service in parsePatch/applyPatch (npm advisory 1112704)',
      },
      { name: 'qs', minVersion: '6.14.2', reason: 'arrayLimit bypass DoS (npm advisory 1113159)' },
    ];

    // Check and update yarn.resolutions in package.json
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    if (!packageJson.resolutions) {
      packageJson.resolutions = {};
    }

    let needsUpdate = false;
    vulnerablePackages.forEach(({ name, minVersion, reason }) => {
      const currentResolution = packageJson.resolutions[name];
      const requiredVersion = `>=${minVersion}`;

      if (currentResolution !== requiredVersion) {
        log(
          `Updating yarn resolution for ${name}: ${currentResolution || 'none'} → ${requiredVersion}`,
          'cyan'
        );
        log(`  Reason: ${reason}`, 'yellow');
        packageJson.resolutions[name] = requiredVersion;
        needsUpdate = true;
      } else {
        log(`✅ ${name} already has correct resolution (${requiredVersion})`, 'green');
      }
    });

    if (needsUpdate) {
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
      log('Updated package.json with yarn resolutions', 'green');
      log('Reinstalling dependencies to apply resolutions...', 'cyan');
      runCommand('yarn install', 'Reinstall with resolutions');
    }

    // Step 4: Verify fixes
    log('\nStep 4: Verifying fixes...', 'yellow');
    try {
      execSync('yarn audit --level moderate', {
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
