/**
 * Legacy Test Runner - Redirects to New Role-Based Test Structure
 *
 * This file has been updated to use the new comprehensive test structure.
 * The old test files have been archived to test-scripts/archive/
 *
 * For better organization and role-based testing, use:
 * - node test-scripts/test-all-apis.js (all services)
 * - node test-scripts/auth/test-all-auth-sequential.js (auth only)
 * - node test-scripts/appointments/test-all-appointments-sequential.js (appointments only)
 *
 * Run with: node test-all-endpoints.js
 */

const { spawn } = require('child_process');
const path = require('path');
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

async function runTest(scriptPath, description) {
  return new Promise(resolve => {
    log(`\n${'='.repeat(60)}`, 'cyan');
    log(`  ${description}`, 'cyan');
    log(`${'='.repeat(60)}\n`, 'cyan');

    const testProcess = spawn('node', [scriptPath], {
      stdio: 'inherit',
      shell: true,
      cwd: path.resolve(__dirname),
    });

    testProcess.on('close', code => {
      log(`\n${description} completed with exit code: ${code}`, code === 0 ? 'green' : 'yellow');
      resolve(code === 0);
    });

    testProcess.on('error', error => {
      log(`\nError running ${description}: ${error.message}`, 'red');
      resolve(false);
    });
  });
}

async function main() {
  log('\n' + '='.repeat(60), 'blue');
  log('  Combined Endpoint Test Suite', 'blue');
  log('  Using New Role-Based Test Structure', 'blue');
  log('='.repeat(60) + '\n', 'blue');

  logWarning('Note: This script now uses the new role-based test structure.');
  logWarning('Old test files have been archived to test-scripts/archive/');
  log('');

  const results = {
    auth: false,
    appointments: false,
  };

  // Run Auth Tests using new structure
  results.auth = await runTest(
    'test-scripts/auth/test-all-auth-sequential.js',
    'Auth Endpoints Test (All Roles)'
  );

  // Wait a bit between test suites
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Run Appointment Tests using new structure
  results.appointments = await runTest(
    'test-scripts/appointments/test-all-appointments-sequential.js',
    'Appointment Endpoints Test (All Roles)'
  );

  // Summary
  log('\n' + '='.repeat(60), 'blue');
  log('  Test Summary', 'blue');
  log('='.repeat(60), 'blue');
  log(
    `Auth Endpoints:        ${results.auth ? '✓ PASSED' : '✗ FAILED'}`,
    results.auth ? 'green' : 'red'
  );
  log(
    `Appointment Endpoints:  ${results.appointments ? '✓ PASSED' : '✗ FAILED'}`,
    results.appointments ? 'green' : 'red'
  );
  log('='.repeat(60) + '\n', 'blue');

  log('\n💡 Tip: For comprehensive testing of all services, use:');
  log('   node test-scripts/test-all-apis.js\n', 'cyan');

  process.exit(results.auth && results.appointments ? 0 : 1);
}

main().catch(error => {
  log(`\nFatal error: ${error.message}`, 'red');
  process.exit(1);
});
