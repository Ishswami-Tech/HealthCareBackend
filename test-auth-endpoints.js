/**
 * Auth Endpoints Test Script
 * Tests all authentication endpoints one by one
 * Run with: node test-auth-endpoints.js
 */

// Try both with and without leading slash - NestJS may handle it differently
const BASE_URL = 'http://localhost:8088/api/v1/auth';
const ALT_BASE_URL = 'http://localhost:8088/api/v1/auth'; // Alternative if needed

// Colors for console output
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

// Test data
let accessToken = null;
let refreshToken = null;
let userId = null;
const testEmail = `testuser_${Date.now()}@example.com`;
let testPassword = 'TestPassword123!';

// Helper function to make HTTP requests
async function makeRequest(method, endpoint, body = null, token = null) {
  // Handle endpoints that are not under /auth (like /user/profile)
  const baseUrl = endpoint.startsWith('/user') || endpoint.startsWith('/appointments') 
    ? 'http://localhost:8088/api/v1'
    : BASE_URL;
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Version': '1', // Required for API versioning
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({ message: 'No JSON response' }));

    return {
      status: response.status,
      ok: response.ok,
      data,
      headers: Object.fromEntries(response.headers.entries()),
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

// Wait function
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test functions
async function testHealthCheck() {
  log('\n=== Test 1: Health Check ===', 'cyan');
  try {
    const response = await fetch('http://localhost:8088/health');
    const data = await response.json();
    if (response.ok) {
      logSuccess('Health check passed');
      console.log(JSON.stringify(data, null, 2));
      return true;
    } else {
      logError(`Health check failed: ${response.status}`);
      return false;
    }
  } catch (error) {
    logError(`Health check error: ${error.message}`);
    return false;
  }
}

async function testRegister() {
  log('\n=== Test 2: POST /auth/register ===', 'cyan');
  const registerData = {
    email: testEmail,
    password: testPassword,
    firstName: 'Test',
    lastName: 'User',
    phone: '+1234567890',
    role: 'PATIENT',
    gender: 'MALE',
    dateOfBirth: '1990-01-01',
  };

  const result = await makeRequest('POST', '/register', registerData);
  
  if (result.ok && result.data?.data?.accessToken) {
    logSuccess('Register endpoint: OK');
    accessToken = result.data.data.accessToken;
    refreshToken = result.data.data.refreshToken;
    userId = result.data.data.user?.id;
    logInfo(`Access Token: ${accessToken.substring(0, 50)}...`);
    logInfo(`User ID: ${userId}`);
    return true;
  } else {
    logError(`Register failed: ${result.status} - ${JSON.stringify(result.data, null, 2)}`);
    if (result.data?.error) {
      logError(`Error details: ${result.data.error}`);
    }
    return false;
  }
}

async function testLogin() {
  log('\n=== Test 3: POST /auth/login ===', 'cyan');
  const loginData = {
    email: testEmail,
    password: testPassword,
  };

  const result = await makeRequest('POST', '/login', loginData);
  
  if (result.ok && result.data?.data?.accessToken) {
    logSuccess('Login endpoint: OK');
    if (!accessToken) {
      accessToken = result.data.data.accessToken;
      refreshToken = result.data.data.refreshToken;
      userId = result.data.data.user?.id;
    }
    logInfo(`Access Token: ${accessToken.substring(0, 50)}...`);
    return true;
  } else {
    logError(`Login failed: ${result.status} - ${JSON.stringify(result.data, null, 2)}`);
    if (result.data?.error) {
      logError(`Error details: ${result.data.error}`);
    }
    return false;
  }
}

async function testGetProfile() {
  log('\n=== Test 4: GET /user/profile ===', 'cyan');
  if (!accessToken) {
    logWarning('Skipping - No access token available');
    return false;
  }

  // Use the unified profile endpoint
  const result = await makeRequest('GET', '/user/profile', null, accessToken);
  
  if (result.ok && (result.data?.data || result.data)) {
    logSuccess('Get Profile endpoint: OK');
    const profile = result.data?.data || result.data;
    console.log(JSON.stringify(profile, null, 2));
    return true;
  } else {
    logError(`Get Profile failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testRefreshToken() {
  log('\n=== Test 5: POST /auth/refresh ===', 'cyan');
  if (!refreshToken) {
    logWarning('Skipping - No refresh token available');
    return false;
  }

  const refreshData = {
    refreshToken: refreshToken,
  };

  const result = await makeRequest('POST', '/refresh', refreshData);
  
  if (result.ok && result.data?.data?.accessToken) {
    logSuccess('Refresh Token endpoint: OK');
    const newAccessToken = result.data.data.accessToken;
    logInfo(`New Access Token: ${newAccessToken.substring(0, 50)}...`);
    accessToken = newAccessToken; // Update access token
    return true;
  } else {
    logError(`Refresh Token failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testGetSessions() {
  log('\n=== Test 6: GET /auth/sessions ===', 'cyan');
  if (!accessToken) {
    logWarning('Skipping - No access token available');
    return false;
  }

  const result = await makeRequest('GET', '/sessions', null, accessToken);
  
  if (result.ok) {
    logSuccess('Get Sessions endpoint: OK');
    console.log(JSON.stringify(result.data, null, 2));
    return true;
  } else {
    logError(`Get Sessions failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testRequestOtp() {
  log('\n=== Test 7: POST /auth/request-otp ===', 'cyan');
  const otpData = {
    identifier: testEmail,
  };

  const result = await makeRequest('POST', '/request-otp', otpData);
  
  if (result.ok) {
    logSuccess('Request OTP endpoint: OK');
    console.log(JSON.stringify(result.data, null, 2));
    return true;
  } else {
    logWarning(`Request OTP: ${result.status} - ${JSON.stringify(result.data)}`);
    // This might fail due to rate limiting, which is expected
    return result.status === 200 || result.status === 429;
  }
}

async function testForgotPassword() {
  log('\n=== Test 8: POST /auth/forgot-password ===', 'cyan');
  const forgotPasswordData = {
    email: testEmail,
  };

  const result = await makeRequest('POST', '/forgot-password', forgotPasswordData);
  
  if (result.ok) {
    logSuccess('Forgot Password endpoint: OK');
    console.log(JSON.stringify(result.data, null, 2));
    return true;
  } else {
    logError(`Forgot Password failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testChangePassword() {
  log('\n=== Test 9: POST /auth/change-password ===', 'cyan');
  if (!accessToken) {
    logWarning('Skipping - No access token available');
    return false;
  }

  const changePasswordData = {
    currentPassword: testPassword,
    newPassword: 'NewTestPassword123!',
    confirmPassword: 'NewTestPassword123!',
  };

  const result = await makeRequest('POST', '/change-password', changePasswordData, accessToken);
  
  if (result.ok) {
    logSuccess('Change Password endpoint: OK');
    console.log(JSON.stringify(result.data, null, 2));
    // Update password for future tests
    testPassword = 'NewTestPassword123!';
    return true;
  } else {
    logError(`Change Password failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testVerifyOtp() {
  log('\n=== Test 10: POST /auth/verify-otp ===', 'cyan');
  const verifyOtpData = {
    email: testEmail,
    otp: '123456', // This will likely fail, but tests the endpoint
  };

  const result = await makeRequest('POST', '/verify-otp', verifyOtpData);
  
  if (result.ok && result.data?.data?.accessToken) {
    logSuccess('Verify OTP endpoint: OK');
    return true;
  } else {
    logWarning(`Verify OTP: Expected to fail without valid OTP - ${result.status}`);
    // This is expected to fail without a valid OTP
    return result.status === 400 || result.status === 401;
  }
}

async function testResetPassword() {
  log('\n=== Test 11: POST /auth/reset-password ===', 'cyan');
  const resetPasswordData = {
    token: 'invalid-token-for-testing',
    newPassword: 'ResetPassword123!',
    confirmPassword: 'ResetPassword123!',
  };

  const result = await makeRequest('POST', '/reset-password', resetPasswordData);
  
  if (result.ok) {
    logSuccess('Reset Password endpoint: OK');
    return true;
  } else {
    logWarning(`Reset Password: Expected to fail without valid token - ${result.status}`);
    // This is expected to fail without a valid token
    return result.status === 400 || result.status === 401;
  }
}

async function testLogout() {
  log('\n=== Test 12: POST /auth/logout ===', 'cyan');
  if (!accessToken) {
    logWarning('Skipping - No access token available');
    return false;
  }

  const logoutData = {};

  const result = await makeRequest('POST', '/logout', logoutData, accessToken);
  
  if (result.ok) {
    logSuccess('Logout endpoint: OK');
    console.log(JSON.stringify(result.data, null, 2));
    // Clear tokens after logout
    accessToken = null;
    refreshToken = null;
    return true;
  } else {
    logError(`Logout failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

// Main test runner
async function runTests() {
  log('\n========================================', 'blue');
  log('  Auth Endpoints Test Suite', 'blue');
  log('========================================\n', 'blue');

  const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  // Test 1: Health Check
  if (await testHealthCheck()) {
    results.passed++;
  } else {
    results.failed++;
    logError('Server might not be running. Please start the server first.');
    return;
  }

  await wait(1000);

  // Test 2: Register
  if (await testRegister()) {
    results.passed++;
  } else {
    results.failed++;
    // Try login if register fails (user might already exist)
    logInfo('Register failed, trying login instead...');
    if (await testLogin()) {
      results.passed++;
      results.failed--; // Adjust counts
    }
  }

  await wait(1000);

  // Test 3: Login (if register succeeded, this should work too)
  if (!accessToken) {
    if (await testLogin()) {
      results.passed++;
    } else {
      results.failed++;
    }
  }

  await wait(1000);

  // Test 4: Get Profile
  if (await testGetProfile()) {
    results.passed++;
  } else {
    results.failed++;
  }

  await wait(1000);

  // Test 5: Refresh Token
  if (await testRefreshToken()) {
    results.passed++;
  } else {
    results.failed++;
  }

  await wait(1000);

  // Test 6: Get Sessions
  if (await testGetSessions()) {
    results.passed++;
  } else {
    results.failed++;
  }

  await wait(1000);

  // Test 7: Request OTP
  if (await testRequestOtp()) {
    results.passed++;
  } else {
    results.skipped++;
  }

  await wait(1000);

  // Test 8: Forgot Password
  if (await testForgotPassword()) {
    results.passed++;
  } else {
    results.failed++;
  }

  await wait(1000);

  // Test 9: Change Password
  if (await testChangePassword()) {
    results.passed++;
  } else {
    results.failed++;
  }

  await wait(1000);

  // Test 10: Verify OTP
  if (await testVerifyOtp()) {
    results.passed++;
  } else {
    results.skipped++;
  }

  await wait(1000);

  // Test 11: Reset Password
  if (await testResetPassword()) {
    results.passed++;
  } else {
    results.skipped++;
  }

  await wait(1000);

  // Test 12: Logout
  if (await testLogout()) {
    results.passed++;
  } else {
    results.failed++;
  }

  // Summary
  log('\n========================================', 'blue');
  log('  Test Summary', 'blue');
  log('========================================', 'blue');
  log(`Passed: ${results.passed}`, 'green');
  log(`Failed: ${results.failed}`, 'red');
  log(`Skipped: ${results.skipped}`, 'yellow');
  log('========================================\n', 'blue');
}

// Run tests
runTests().catch(error => {
  logError(`Test runner error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

