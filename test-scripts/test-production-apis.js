#!/usr/bin/env node

/**
 * Production API Test Runner
 *
 * Comprehensive test runner that uses existing test scripts with production configuration.
 * Supports multiple environments (dev, staging, prod) and comprehensive reporting.
 *
 * Usage:
 *   node test-scripts/test-production-apis.js [options]
 *
 * Options:
 *   --env <env>          Environment (dev|staging|prod) [default: prod]
 *   --base-url <url>    Base URL for API [overrides environment default]
 *   --service <service> Test specific service (all|auth|appointments|users|billing|ehr|video|communication|clinic|health) [default: all]
 *   --role <role>       Test specific role (all|patient|doctor|receptionist|clinic-admin) [default: all]
 *   --report            Generate HTML report
 *   --verbose           Verbose output
 *   --parallel          Run tests in parallel (faster but may hit rate limits)
 *   --delay <ms>        Delay between test suites (ms) [default: 2000]
 *
 * Examples:
 *   node test-scripts/test-production-apis.js --env prod
 *   node test-scripts/test-production-apis.js --env staging --service appointments --role doctor
 *   node test-scripts/test-production-apis.js --env prod --report --verbose
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { logSection, log, logWarning, logError, logSuccess, colors } = require('./_shared-utils');

// ============================================================================
// Configuration
// ============================================================================

const ENVIRONMENTS = {
  dev: {
    baseUrl: process.env.DEV_API_URL || 'http://localhost:8088/api/v1',
    baseUrlNoPrefix:
      process.env.DEV_API_URL?.replace(/\/api\/v1\/?$/, '') || 'http://localhost:8088',
    timeout: 15000,
  },
  staging: {
    baseUrl: process.env.STAGING_API_URL || 'https://staging-api.example.com/api/v1',
    baseUrlNoPrefix:
      process.env.STAGING_API_URL?.replace(/\/api\/v1\/?$/, '') ||
      'https://staging-api.example.com',
    timeout: 20000,
  },
  prod: {
    baseUrl: process.env.PROD_API_URL || 'https://backend-service-v1.ishswami.in/api/v1',
    baseUrlNoPrefix:
      process.env.PROD_API_URL?.replace(/\/api\/v1\/?$/, '') ||
      'https://backend-service-v1.ishswami.in',
    timeout: 30000,
  },
};

// Service test mappings
const SERVICE_TESTS = {
  health: {
    name: 'Health',
    path: 'health',
    script: 'test-health.js',
    roles: ['ALL'], // Public endpoint
  },
  auth: {
    name: 'Auth',
    path: 'auth',
    script: 'test-all-auth-sequential.js',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  },
  users: {
    name: 'Users',
    path: 'users',
    script: 'test-all-users-sequential.js',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  },
  appointments: {
    name: 'Appointments',
    path: 'appointments',
    script: 'test-all-appointments-sequential.js',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  },
  billing: {
    name: 'Billing',
    path: 'billing',
    script: 'test-all-billing-sequential.js',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  },
  ehr: {
    name: 'EHR',
    path: 'ehr',
    script: 'test-all-ehr-sequential.js',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  },
  video: {
    name: 'Video',
    path: 'video',
    script: 'test-all-video-sequential.js',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  },
  communication: {
    name: 'Communication',
    path: 'notification',
    script: 'test-all-notification-sequential.js',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  },
  clinic: {
    name: 'Clinic',
    path: 'clinic',
    script: 'test-all-clinic-sequential.js',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  },
  'notification-preferences': {
    name: 'Notification Preferences',
    path: 'notification-preferences',
    script: 'test-all-notification-preferences-sequential.js',
    roles: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  },
};

// Role mappings
const ROLE_MAPPINGS = {
  patient: 'PATIENT',
  doctor: 'DOCTOR',
  receptionist: 'RECEPTIONIST',
  'clinic-admin': 'CLINIC_ADMIN',
  all: 'ALL',
};

// ============================================================================
// Test Results
// ============================================================================

const testResults = {
  startTime: Date.now(),
  endTime: null,
  environment: null,
  baseUrl: null,
  services: {},
  totalPassed: 0,
  totalFailed: 0,
  totalSkipped: 0,
  errors: [],
};

// ============================================================================
// Utility Functions
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    env: 'prod',
    baseUrl: null,
    service: 'all',
    role: 'all',
    report: false,
    verbose: false,
    parallel: false,
    delay: 2000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--env' && args[i + 1]) {
      options.env = args[i + 1];
      i++;
    } else if (arg === '--base-url' && args[i + 1]) {
      options.baseUrl = args[i + 1];
      i++;
    } else if (arg === '--service' && args[i + 1]) {
      options.service = args[i + 1];
      i++;
    } else if (arg === '--role' && args[i + 1]) {
      options.role = args[i + 1];
      i++;
    } else if (arg === '--report') {
      options.report = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--parallel') {
      options.parallel = true;
    } else if (arg === '--delay' && args[i + 1]) {
      options.delay = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Production API Test Runner

Usage: node test-scripts/test-production-apis.js [options]

Options:
  --env <env>          Environment (dev|staging|prod) [default: prod]
  --base-url <url>     Base URL for API [overrides environment default]
  --service <service>  Test specific service [default: all]
  --role <role>        Test specific role [default: all]
  --report             Generate HTML report
  --verbose            Verbose output
  --parallel           Run tests in parallel
  --delay <ms>         Delay between test suites (ms) [default: 2000]
  --help, -h           Show this help message

Examples:
  node test-scripts/test-production-apis.js --env prod
  node test-scripts/test-production-apis.js --env staging --service appointments
  node test-scripts/test-production-apis.js --env prod --report --verbose
      `);
      process.exit(0);
    }
  }

  return options;
}

function updateBaseUrlInSharedUtils(baseUrl) {
  try {
    const sharedUtilsPath = path.join(__dirname, '_shared-utils.js');
    let content = fs.readFileSync(sharedUtilsPath, 'utf8');

    // Update BASE_URL - handle both formats: const BASE_URL = '...' and const BASE_URL = process.env.BASE_URL || '...'
    const baseUrlRegex = /(const BASE_URL = )(?:process\.env\.BASE_URL \|\| )?['"](.*?)['"];?/;
    if (baseUrlRegex.test(content)) {
      // Replace with new baseUrl, keeping process.env.BASE_URL || pattern if it exists
      content = content.replace(baseUrlRegex, `$1process.env.BASE_URL || '${baseUrl}';`);
      fs.writeFileSync(sharedUtilsPath, content, 'utf8');
      log(`✓ Updated BASE_URL in _shared-utils.js to: ${baseUrl}`, 'green');
      return true;
    } else {
      // Try to find and replace just the default value
      const defaultUrlRegex = /(process\.env\.BASE_URL \|\| )['"](.*?)['"]/;
      if (defaultUrlRegex.test(content)) {
        content = content.replace(defaultUrlRegex, `$1'${baseUrl}'`);
        fs.writeFileSync(sharedUtilsPath, content, 'utf8');
        log(`✓ Updated BASE_URL default in _shared-utils.js to: ${baseUrl}`, 'green');
        return true;
      }
      logWarning('Could not find BASE_URL in _shared-utils.js - using environment variable');
      return false;
    }
  } catch (error) {
    logWarning(`Could not update BASE_URL: ${error.message}`);
    return false;
  }
}

function runScript(scriptPath, options = {}) {
  return new Promise((resolve, reject) => {
    const relativePath = path.relative(path.resolve(__dirname, '..'), scriptPath);
    const child = spawn('node', [relativePath], {
      cwd: path.resolve(__dirname, '..'),
      stdio: options.verbose ? 'inherit' : 'pipe',
      shell: true,
      env: {
        ...process.env,
        BASE_URL: options.baseUrl || process.env.BASE_URL,
      },
    });

    let stdout = '';
    let stderr = '';

    if (!options.verbose) {
      child.stdout.on('data', data => {
        stdout += data.toString();
      });

      child.stderr.on('data', data => {
        stderr += data.toString();
      });
    }

    child.on('close', code => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });

    child.on('error', err => {
      reject(err);
    });
  });
}

// ============================================================================
// Test Execution
// ============================================================================

async function runServiceTests(serviceKey, options) {
  const service = SERVICE_TESTS[serviceKey];
  if (!service) {
    logError(`Unknown service: ${serviceKey}`);
    return { passed: false, error: 'Unknown service' };
  }

  const scriptPath = path.join(__dirname, service.path, service.script);

  // Check if script exists
  if (!fs.existsSync(scriptPath)) {
    logWarning(`Test script not found: ${service.script} - SKIPPING`);
    testResults.totalSkipped++;
    return { passed: false, skipped: true };
  }

  logSection(`Testing ${service.name} Service`);
  log(`Script: ${service.script}`, 'cyan');

  // Health endpoint doesn't use /api/v1 prefix
  const baseUrlForService = serviceKey === 'health' ? options.baseUrlNoPrefix : options.baseUrl;

  log(`Base URL: ${baseUrlForService}`, 'cyan');

  try {
    const result = await runScript(scriptPath, {
      baseUrl: baseUrlForService,
      verbose: options.verbose,
    });

    const passed = result.code === 0;

    if (passed) {
      testResults.totalPassed++;
      testResults.services[serviceKey] = { status: 'passed', result };
      logSuccess(`${service.name} tests PASSED`);
    } else {
      testResults.totalFailed++;
      testResults.services[serviceKey] = { status: 'failed', result };
      testResults.errors.push({
        service: service.name,
        error: result.stderr || 'Test failed',
      });
      logError(`${service.name} tests FAILED (exit code: ${result.code})`);
    }

    return { passed, result };
  } catch (error) {
    testResults.totalFailed++;
    testResults.services[serviceKey] = { status: 'error', error: error.message };
    testResults.errors.push({
      service: service.name,
      error: error.message,
    });
    logError(`${service.name} tests ERROR: ${error.message}`);
    return { passed: false, error: error.message };
  }
}

async function main() {
  const options = parseArgs();

  // Get environment configuration
  const envConfig = ENVIRONMENTS[options.env];
  if (!envConfig) {
    logError(`Unknown environment: ${options.env}`);
    log(`Available environments: ${Object.keys(ENVIRONMENTS).join(', ')}`, 'yellow');
    process.exit(1);
  }

  // Determine base URLs
  const baseUrl = options.baseUrl || envConfig.baseUrl;
  const baseUrlNoPrefix = options.baseUrl
    ? options.baseUrl.replace(/\/api\/v1\/?$/, '')
    : envConfig.baseUrlNoPrefix;

  testResults.environment = options.env;
  testResults.baseUrl = baseUrl;

  // Update BASE_URL in shared utils (for services that use /api/v1 prefix)
  updateBaseUrlInSharedUtils(baseUrl);

  // Header
  logSection('PRODUCTION API TEST SUITE');
  log(`Environment: ${options.env}`, 'cyan');
  log(`Base URL (API): ${baseUrl}`, 'cyan');
  log(`Base URL (Health): ${baseUrlNoPrefix}`, 'cyan');
  log(`Service: ${options.service}`, 'cyan');
  log(`Role: ${options.role}`, 'cyan');
  log(`Start Time: ${new Date().toISOString()}`, 'cyan');
  log(`Verbose: ${options.verbose}`, 'cyan');
  log(`Report: ${options.report}`, 'cyan');

  // Determine services to test
  const servicesToTest = options.service === 'all' ? Object.keys(SERVICE_TESTS) : [options.service];

  // Validate services
  const invalidServices = servicesToTest.filter(s => !SERVICE_TESTS[s]);
  if (invalidServices.length > 0) {
    logError(`Invalid services: ${invalidServices.join(', ')}`);
    log(`Available services: ${Object.keys(SERVICE_TESTS).join(', ')}`, 'yellow');
    process.exit(1);
  }

  // Run tests
  logSection('Running Tests');

  if (options.parallel) {
    // Run tests in parallel
    logWarning('Running tests in parallel - may hit rate limits');
    const promises = servicesToTest.map(serviceKey =>
      runServiceTests(serviceKey, { ...options, baseUrl, baseUrlNoPrefix })
    );
    await Promise.all(promises);
  } else {
    // Run tests sequentially
    for (const serviceKey of servicesToTest) {
      await runServiceTests(serviceKey, { ...options, baseUrl, baseUrlNoPrefix });

      // Delay between services
      if (options.delay > 0 && servicesToTest.indexOf(serviceKey) < servicesToTest.length - 1) {
        await new Promise(resolve => setTimeout(resolve, options.delay));
      }
    }
  }

  // Calculate final metrics
  testResults.endTime = Date.now();
  const totalTime = testResults.endTime - testResults.startTime;

  // Print summary
  logSection('TEST SUMMARY');
  log(`Environment: ${testResults.environment}`, 'cyan');
  log(`Base URL: ${testResults.baseUrl}`, 'cyan');
  log(`Total Passed: ${testResults.totalPassed}`, 'green');
  log(`Total Failed: ${testResults.totalFailed}`, testResults.totalFailed > 0 ? 'red' : 'green');
  log(`Total Skipped: ${testResults.totalSkipped}`, 'yellow');
  log(`Total Time: ${(totalTime / 1000).toFixed(2)}s`, 'cyan');

  // Service-wise results
  log('\nService-wise Results:', 'cyan');
  for (const [serviceKey, serviceResult] of Object.entries(testResults.services)) {
    const service = SERVICE_TESTS[serviceKey];
    const status = serviceResult.status === 'passed' ? '✓' : '✗';
    const color = serviceResult.status === 'passed' ? 'green' : 'red';
    log(`  ${status} ${service.name}: ${serviceResult.status.toUpperCase()}`, color);
  }

  // Print errors if any
  if (testResults.errors.length > 0) {
    log('\nErrors:', 'red');
    testResults.errors.forEach((error, index) => {
      log(`  ${index + 1}. ${error.service}: ${error.error}`, 'red');
    });
  }

  // Generate report if requested
  if (options.report) {
    generateReport(totalTime);
  }

  // Exit with appropriate code
  process.exit(testResults.totalFailed > 0 ? 1 : 0);
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport(totalTime) {
  const reportPath = path.join(__dirname, '..', 'test-report.html');
  const passRate =
    testResults.totalPassed + testResults.totalFailed > 0
      ? (
          (testResults.totalPassed / (testResults.totalPassed + testResults.totalFailed)) *
          100
        ).toFixed(2)
      : 0;

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Production API Test Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .header { background: #2c3e50; color: white; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
    .summary { background: white; padding: 20px; margin: 20px 0; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .metric { display: inline-block; margin: 10px 20px; text-align: center; }
    .metric-label { font-size: 14px; color: #666; }
    .metric-value { font-size: 32px; font-weight: bold; margin-top: 5px; }
    .passed { color: #27ae60; }
    .failed { color: #e74c3c; }
    .skipped { color: #f39c12; }
    .services { background: white; padding: 20px; margin: 20px 0; border-radius: 5px; }
    .service-item { padding: 10px; margin: 5px 0; border-left: 3px solid #ddd; }
    .service-passed { border-left-color: #27ae60; }
    .service-failed { border-left-color: #e74c3c; }
    .errors { background: white; padding: 20px; margin: 20px 0; border-radius: 5px; }
    .error-item { padding: 10px; margin: 5px 0; background: #fee; border-left: 3px solid #e74c3c; }
    table { width: 100%; border-collapse: collapse; background: white; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #34495e; color: white; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Production API Test Report</h1>
    <p><strong>Generated:</strong> ${new Date().toISOString()}</p>
    <p><strong>Environment:</strong> ${testResults.environment}</p>
    <p><strong>Base URL:</strong> ${testResults.baseUrl}</p>
    <p><strong>Total Time:</strong> ${(totalTime / 1000).toFixed(2)}s</p>
  </div>
  
  <div class="summary">
    <h2>Summary</h2>
    <div class="metric">
      <div class="metric-label">Total Passed</div>
      <div class="metric-value passed">${testResults.totalPassed}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Total Failed</div>
      <div class="metric-value failed">${testResults.totalFailed}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Total Skipped</div>
      <div class="metric-value skipped">${testResults.totalSkipped}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Pass Rate</div>
      <div class="metric-value">${passRate}%</div>
    </div>
  </div>

  <div class="services">
    <h2>Service Results</h2>
    ${Object.entries(testResults.services)
      .map(
        ([key, result]) => `
      <div class="service-item ${result.status === 'passed' ? 'service-passed' : 'service-failed'}">
        <strong>${SERVICE_TESTS[key].name}</strong>: ${result.status.toUpperCase()}
      </div>
    `
      )
      .join('')}
  </div>

  ${
    testResults.errors.length > 0
      ? `
  <div class="errors">
    <h2>Errors (${testResults.errors.length})</h2>
    ${testResults.errors
      .map(
        (error, index) => `
      <div class="error-item">
        <strong>${index + 1}. ${error.service}</strong><br>
        ${error.error}
      </div>
    `
      )
      .join('')}
  </div>
  `
      : ''
  }
</body>
</html>`;

  fs.writeFileSync(reportPath, html);
  logSuccess(`\n📊 Report generated: ${reportPath}`);
}

// ============================================================================
// Run Main
// ============================================================================

main().catch(error => {
  logError(`\nFatal error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
