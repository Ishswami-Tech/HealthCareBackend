/**
 * Shared utilities for appointment test scripts
 */

const http = require('http');
const https = require('https');

const BASE_URL = 'http://localhost:8088/api/v1';

// Colors for console output
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

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ ${message}`, 'cyan');
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

function logSection(message) {
  log(`\n${'='.repeat(60)}`, 'magenta');
  log(message, 'magenta');
  log('='.repeat(60), 'magenta');
}

// HTTP request helper
function httpRequestJson(method, url, body = null, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const finalHeaders = {
      'User-Agent': 'healthcare-appointment-test',
      ...headers,
    };

    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        headers: finalHeaders,
      },
      res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          raw += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode || 0;
          const ok = status >= 200 && status < 300;
          let data;
          try {
            data = raw ? JSON.parse(raw) : { message: 'No JSON response' };
          } catch {
            data = { message: 'No JSON response', raw };
          }

          const responseHeaders = {};
          for (const [k, v] of Object.entries(res.headers || {})) {
            if (typeof v === 'string') responseHeaders[k] = v;
            else if (Array.isArray(v)) responseHeaders[k] = v.join(', ');
          }

          resolve({ status, ok, data, headers: responseHeaders });
        });
      }
    );

    req.on('error', err => {
      reject(err);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout after ${Math.round(timeoutMs / 1000)} seconds`));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Wait function
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test context class
class TestContext {
  constructor(roleName, credentials) {
    this.roleName = roleName;
    this.credentials = credentials;
    this.accessToken = null;
    this.refreshToken = null;
    this.userId = null;
    this.clinicId = null;
    this.doctorId = null;
    this.locationId = null;
    this.appointmentId = null;
    this.patientId = null;
    this.results = { passed: 0, failed: 0, skipped: 0, total: 0 };
  }

  async makeRequest(method, endpoint, body = null, headers = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const authHeader = this.accessToken ? `Bearer ${this.accessToken.trim()}` : null;

    const defaultHeaders = {
      'X-API-Version': '1',
      'User-Agent': 'healthcare-appointment-test',
      ...(authHeader && { Authorization: authHeader }),
      ...(this.clinicId && { 'X-Clinic-ID': this.clinicId }),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    };

    try {
      return await httpRequestJson(method, url, body, defaultHeaders, 15000);
    } catch (error) {
      return {
        status: 0,
        ok: false,
        data: { message: error.message || 'Network error' },
        headers: {},
        error: error.message,
      };
    }
  }

  async login() {
    logInfo(`Logging in as ${this.roleName}...`);
    const result = await this.makeRequest('POST', '/auth/login', {
      email: this.credentials.email,
      password: this.credentials.password,
    });

    if (result.ok && result.data?.data?.accessToken) {
      this.accessToken = result.data.data.accessToken;
      this.refreshToken = result.data.data.refreshToken;
      this.userId = result.data.data.user?.id;
      this.clinicId = result.data.data.user?.clinicId || result.data.data.user?.primaryClinicId;
      logSuccess(`Logged in as ${this.roleName} (User ID: ${this.userId})`);
      return true;
    } else {
      logError(`Login failed: ${result.status} - ${JSON.stringify(result.data)}`);
      return false;
    }
  }

  async loadTestIds() {
    try {
      const fs = require('fs');
      const path = require('path');
      const testIdsPath = path.join(process.cwd(), 'test-ids.json');
      const testIds = JSON.parse(fs.readFileSync(testIdsPath, 'utf8'));

      if (!this.clinicId && testIds.clinics && testIds.clinics.length > 0) {
        this.clinicId = testIds.clinics[0];
      }
      if (!this.doctorId && testIds.demoDoctorId) {
        this.doctorId = testIds.demoDoctorId;
      }
      if (!this.patientId && testIds.demoPatientId) {
        this.patientId = testIds.demoPatientId;
      }
      if (!this.locationId && testIds.locations) {
        const clinicIndex = testIds.clinics?.indexOf(this.clinicId) ?? 0;
        const locationKey = clinicIndex === 0 ? 'clinic1' : 'clinic2';
        if (testIds.locations[locationKey] && testIds.locations[locationKey].length > 0) {
          this.locationId = testIds.locations[locationKey][0];
        }
      }
      return true;
    } catch (e) {
      logWarning('Could not load test-ids.json');
      return false;
    }
  }

  recordTest(name, passed, skipped = false) {
    this.results.total++;
    if (skipped) {
      this.results.skipped++;
      logWarning(`${name}: SKIPPED`);
    } else if (passed) {
      this.results.passed++;
      logSuccess(`${name}: PASSED`);
    } else {
      this.results.failed++;
      logError(`${name}: FAILED`);
    }
  }

  printSummary() {
    logSection(`${this.roleName} Test Summary`);
    log(`Passed: ${this.results.passed}`, 'green');
    log(`Failed: ${this.results.failed}`, this.results.failed > 0 ? 'red' : 'green');
    log(`Skipped: ${this.results.skipped}`, 'yellow');
    log(`Total: ${this.results.total}`, 'cyan');
    log('='.repeat(60) + '\n', 'magenta');
  }
}

module.exports = {
  BASE_URL,
  colors,
  log,
  logSuccess,
  logError,
  logInfo,
  logWarning,
  logSection,
  httpRequestJson,
  wait,
  TestContext,
};



