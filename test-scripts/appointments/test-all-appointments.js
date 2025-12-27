/**
 * Master Test Runner - All Appointment Endpoints by Role
 * Runs all role-specific appointment test suites
 *
 * Run with: node test-scripts/appointments/test-all-appointments.js
 */

const { spawn } = require('child_process');
const path = require('path');
const { logSection, log, colors } = require('./_shared-utils');

const roleTests = [
  { name: 'PATIENT', script: 'test-patient-appointments.js' },
  { name: 'DOCTOR', script: 'test-doctor-appointments.js' },
  { name: 'RECEPTIONIST', script: 'test-receptionist-appointments.js' },
  { name: 'CLINIC_ADMIN', script: 'test-clinic-admin-appointments.js' },
];

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    // Use absolute path and run from project root
    const absolutePath = path.resolve(scriptPath);
    const child = spawn('node', [absolutePath], {
      cwd: path.resolve(__dirname, '../..'), // Project root
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

async function runAllTests() {
  logSection('Running All Appointment Endpoint Tests by Role');

  const results = {
    passed: [],
    failed: [],
  };

  for (const roleTest of roleTests) {
    const scriptPath = path.join(__dirname, roleTest.script);
    log(`\n${'='.repeat(60)}`, 'cyan');
    log(`Running ${roleTest.name} tests...`, 'cyan');
    log('='.repeat(60), 'cyan');

    try {
      const exitCode = await runScript(scriptPath);
      if (exitCode === 0) {
        results.passed.push(roleTest.name);
        log(`\n✓ ${roleTest.name} tests PASSED`, 'green');
      } else {
        results.failed.push(roleTest.name);
        log(`\n✗ ${roleTest.name} tests FAILED`, 'red');
      }
    } catch (error) {
      results.failed.push(roleTest.name);
      log(`\n✗ ${roleTest.name} tests ERROR: ${error.message}`, 'red');
    }

    // Small delay between role tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Final summary
  logSection('Overall Test Summary');
  log(`Passed: ${results.passed.length}/${roleTests.length}`, 'green');
  if (results.passed.length > 0) {
    log(`  - ${results.passed.join(', ')}`, 'green');
  }
  if (results.failed.length > 0) {
    log(`Failed: ${results.failed.length}/${roleTests.length}`, 'red');
    log(`  - ${results.failed.join(', ')}`, 'red');
  }
  log('='.repeat(60) + '\n', 'magenta');

  if (results.failed.length > 0) {
    process.exit(1);
  }
}

// Run all tests
runAllTests().catch(error => {
  console.error('Master test runner failed:', error);
  process.exit(1);
});


























