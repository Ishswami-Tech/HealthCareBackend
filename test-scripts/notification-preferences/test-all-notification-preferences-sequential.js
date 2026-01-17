/**
 * Sequential Test Runner for Notification Preferences
 * Tests all notification preference endpoints for all roles
 *
 * Run with: node test-scripts/notification-preferences/test-all-notification-preferences-sequential.js
 */

const { spawn } = require('child_process');
const path = require('path');
const { logSection, log, logWarning, colors } = require('../_shared-utils');

const testFiles = [
  {
    role: 'PATIENT',
    script: 'test-scripts/notification-preferences/test-patient-notification-preferences.js',
  },
  {
    role: 'DOCTOR',
    script: 'test-scripts/notification-preferences/test-doctor-notification-preferences.js',
  },
  {
    role: 'RECEPTIONIST',
    script: 'test-scripts/notification-preferences/test-receptionist-notification-preferences.js',
  },
  {
    role: 'CLINIC_ADMIN',
    script: 'test-scripts/notification-preferences/test-clinic-admin-notification-preferences.js',
  },
];

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const relativePath = path.relative(path.resolve(__dirname, '..'), scriptPath);
    const child = spawn('node', [relativePath], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', code => {
      resolve(code);
    });

    child.on('error', err => {
      reject(err);
    });
  });
}

async function runAllNotificationPreferenceTests() {
  logSection('Running All Notification Preference Tests by Role');

  const results = {
    passed: [],
    failed: [],
  };

  for (const testFile of testFiles) {
    const scriptPath = path.join(__dirname, '..', testFile.script);
    const fs = require('fs');
    if (!fs.existsSync(scriptPath)) {
      log(`⚠ Test file not found: ${testFile.script} - SKIPPING`, 'yellow');
      continue;
    }

    log(`\nRunning ${testFile.role} tests...`, 'yellow');

    try {
      const exitCode = await runScript(scriptPath);
      if (exitCode === 0) {
        results.passed.push(testFile.role);
        log(`✓ ${testFile.role} tests PASSED`, 'green');
      } else {
        results.failed.push(testFile.role);
        log(`✗ ${testFile.role} tests FAILED`, 'red');
      }
    } catch (error) {
      results.failed.push(testFile.role);
      log(`✗ ${testFile.role} tests ERROR: ${error.message}`, 'red');
    }

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Final summary
  logSection('Notification Preference Test Summary');
  log(`Total Passed: ${results.passed.length}`, 'green');
  log(`Total Failed: ${results.failed.length}`, results.failed.length > 0 ? 'red' : 'green');

  if (results.passed.length > 0) {
    log(`\nPassed: ${results.passed.join(', ')}`, 'green');
  }
  if (results.failed.length > 0) {
    log(`Failed: ${results.failed.join(', ')}`, 'red');
  }

  log('='.repeat(60) + '\n', 'magenta');

  if (results.failed.length > 0) {
    process.exit(1);
  }
}

// Run all tests
runAllNotificationPreferenceTests().catch(error => {
  console.error('Notification preference test runner failed:', error);
  process.exit(1);
});
