/**
 * Sequential Test Runner - All Users Endpoints by Role
 * Runs all role-specific users test suites
 *
 * Run with: node test-scripts/users/test-all-users-sequential.js
 */

const { spawn } = require('child_process');
const path = require('path');
const { logSection, log } = require('../_shared-utils');

const roleTests = [
  { name: 'PATIENT', script: 'test-patient-users.js' },
  { name: 'DOCTOR', script: 'test-doctor-users.js' },
  { name: 'RECEPTIONIST', script: 'test-receptionist-users.js' },
  { name: 'CLINIC_ADMIN', script: 'test-clinic-admin-users.js' },
];

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
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

async function runAllUsersTests() {
  logSection('Running All Users Endpoint Tests by Role');

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

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

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

runAllUsersTests().catch(error => {
  console.error('Master test runner failed:', error);
  process.exit(1);
});































