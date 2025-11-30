/**
 * Combined Test Script for Auth and Appointments Endpoints
 * Tests both authentication and appointment endpoints
 * Run with: node test-all-endpoints.js
 */

const { spawn } = require('child_process');
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runTest(scriptName, description) {
  return new Promise((resolve) => {
    log(`\n${'='.repeat(60)}`, 'cyan');
    log(`  ${description}`, 'cyan');
    log(`${'='.repeat(60)}\n`, 'cyan');

    const testProcess = spawn('node', [scriptName], {
      stdio: 'inherit',
      shell: true,
    });

    testProcess.on('close', (code) => {
      log(`\n${description} completed with exit code: ${code}`, code === 0 ? 'green' : 'yellow');
      resolve(code === 0);
    });

    testProcess.on('error', (error) => {
      log(`\nError running ${description}: ${error.message}`, 'red');
      resolve(false);
    });
  });
}

async function main() {
  log('\n' + '='.repeat(60), 'blue');
  log('  Combined Endpoint Test Suite', 'blue');
  log('  Testing Auth and Appointments Endpoints', 'blue');
  log('='.repeat(60) + '\n', 'blue');

  const results = {
    auth: false,
    appointments: false,
  };

  // Run Auth Tests
  results.auth = await runTest('test-auth-endpoints.js', 'Auth Endpoints Test');

  // Wait a bit between test suites
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Run Appointment Tests
  results.appointments = await runTest('test-appointment-endpoints.js', 'Appointment Endpoints Test');

  // Summary
  log('\n' + '='.repeat(60), 'blue');
  log('  Test Summary', 'blue');
  log('='.repeat(60), 'blue');
  log(`Auth Endpoints:        ${results.auth ? '✓ PASSED' : '✗ FAILED'}`, results.auth ? 'green' : 'red');
  log(`Appointment Endpoints:  ${results.appointments ? '✓ PASSED' : '✗ FAILED'}`, results.appointments ? 'green' : 'red');
  log('='.repeat(60) + '\n', 'blue');

  process.exit(results.auth && results.appointments ? 0 : 1);
}

main().catch((error) => {
  log(`\nFatal error: ${error.message}`, 'red');
  process.exit(1);
});

