/**
 * Sequential Test Runner - All Appointment Endpoints by Role
 * Runs role-specific appointment test suites in order:
 * 1. RECEPTIONIST (creates appointments)
 * 2. PATIENT (uses own appointments)
 * 3. DOCTOR (uses appointments from RECEPTIONIST)
 * 4. CLINIC_ADMIN (uses existing appointments)
 *
 * Run with: node test-scripts/appointments/test-all-appointments-sequential.js
 */

const { spawn } = require('child_process');
const path = require('path');
const { logSection, log, colors } = require('./_shared-utils');

const roleTests = [
  { name: 'RECEPTIONIST', script: 'test-receptionist-appointments.js', createsAppointments: true },
  { name: 'PATIENT', script: 'test-patient-appointments.js', createsAppointments: true },
  { name: 'DOCTOR', script: 'test-doctor-appointments.js', createsAppointments: false },
  { name: 'CLINIC_ADMIN', script: 'test-clinic-admin-appointments.js', createsAppointments: false },
];

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    // Use relative path from project root
    const relativePath = path.relative(path.resolve(__dirname, '../..'), scriptPath);
    const child = spawn('node', [relativePath], {
      cwd: path.resolve(__dirname, '../..'),
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

async function runAllTestsSequentially() {
  logSection('Running All Appointment Endpoint Tests by Role (Sequential)');

  const results = {
    passed: [],
    failed: [],
    summaries: {},
  };

  for (const roleTest of roleTests) {
    const scriptPath = path.join(__dirname, roleTest.script);
    log(`\n${'='.repeat(60)}`, 'cyan');
    log(`Running ${roleTest.name} tests...`, 'cyan');
    if (roleTest.createsAppointments) {
      log(`(This role creates appointments for other roles to use)`, 'yellow');
    }
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

    // Delay between role tests to allow appointments to be created/available
    if (roleTest.createsAppointments) {
      log('Waiting 2 seconds for appointments to be available...', 'yellow');
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
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
runAllTestsSequentially().catch(error => {
  console.error('Master test runner failed:', error);
  process.exit(1);
});


