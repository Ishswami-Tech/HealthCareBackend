/**
 * Master Test Runner - All API Endpoints by Role
 * Runs all service test suites for each role
 *
 * Run with: node test-scripts/test-all-apis.js
 */

const { spawn } = require('child_process');
const path = require('path');
const { logSection, log, logWarning, colors } = require('./_shared-utils');

// All service test suites organized by service
const serviceTests = [
  { name: 'Health', path: 'health', roles: ['ALL'] }, // Health checks don't require auth - run first
  { name: 'Auth', path: 'auth', roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'] },
  { name: 'Users', path: 'users', roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'] },
  { name: 'Clinic', path: 'clinic', roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'] },
  {
    name: 'Appointments',
    path: 'appointments',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  },
  {
    name: 'Billing',
    path: 'billing',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  },
  { name: 'EHR', path: 'ehr', roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'] },
  { name: 'Video', path: 'video', roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'] },
  {
    name: 'Notification',
    path: 'notification',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
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

async function runAllAPITests() {
  logSection('Running All API Endpoint Tests by Role');

  const results = {
    services: {},
    totalPassed: 0,
    totalFailed: 0,
  };

  for (const service of serviceTests) {
    log(`\n${'='.repeat(60)}`, 'cyan');
    log(`Testing ${service.name} Service`, 'cyan');
    log('='.repeat(60), 'cyan');

    results.services[service.name] = {
      passed: [],
      failed: [],
    };

    // Check if service has role-based tests or a single test file
    const testFiles = [];
    if (service.roles.includes('ALL')) {
      // Single test file for all roles
      testFiles.push({
        role: 'ALL',
        script: `test-scripts/${service.path}/test-${service.path.toLowerCase()}.js`,
      });
    } else {
      // Role-based test files
      for (const role of service.roles) {
        testFiles.push({
          role,
          script: `test-scripts/${service.path}/test-${role.toLowerCase()}-${service.path.toLowerCase()}.js`,
        });
      }
    }

    // Skip if no test files found
    if (testFiles.length === 0) {
      logWarning(`No test files found for ${service.name} - SKIPPING`);
      continue;
    }

    for (const testFile of testFiles) {
      const scriptPath = path.join(__dirname, '..', testFile.script);
      const fs = require('fs');
      if (!fs.existsSync(scriptPath)) {
        log(`⚠ Test file not found: ${testFile.script} - SKIPPING`, 'yellow');
        continue;
      }

      log(`\nRunning ${testFile.role} tests for ${service.name}...`, 'yellow');

      try {
        const exitCode = await runScript(scriptPath);
        if (exitCode === 0) {
          results.services[service.name].passed.push(testFile.role);
          results.totalPassed++;
          log(`✓ ${testFile.role} ${service.name} tests PASSED`, 'green');
        } else {
          results.services[service.name].failed.push(testFile.role);
          results.totalFailed++;
          log(`✗ ${testFile.role} ${service.name} tests FAILED`, 'red');
        }
      } catch (error) {
        results.services[service.name].failed.push(testFile.role);
        results.totalFailed++;
        log(`✗ ${testFile.role} ${service.name} tests ERROR: ${error.message}`, 'red');
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Final summary
  logSection('Overall Test Summary');
  log(`Total Passed: ${results.totalPassed}`, 'green');
  log(`Total Failed: ${results.totalFailed}`, results.totalFailed > 0 ? 'red' : 'green');

  log('\nService-wise Results:', 'cyan');
  for (const [serviceName, serviceResults] of Object.entries(results.services)) {
    if (serviceResults.passed.length > 0 || serviceResults.failed.length > 0) {
      log(`\n${serviceName}:`, 'cyan');
      if (serviceResults.passed.length > 0) {
        log(`  ✓ Passed: ${serviceResults.passed.join(', ')}`, 'green');
      }
      if (serviceResults.failed.length > 0) {
        log(`  ✗ Failed: ${serviceResults.failed.join(', ')}`, 'red');
      }
    }
  }

  log('='.repeat(60) + '\n', 'magenta');

  if (results.totalFailed > 0) {
    process.exit(1);
  }
}

// Run all tests
runAllAPITests().catch(error => {
  console.error('Master test runner failed:', error);
  process.exit(1);
});










