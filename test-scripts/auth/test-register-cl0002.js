/**
 * Test Register API with Clinic ID cl0002
 *
 * Run with: node test-scripts/auth/test-register-cl0002.js
 *
 * To test production:
 *   BASE_URL=https://backend-service-v1.ishswami.in/api/v1 node test-scripts/auth/test-register-cl0002.js
 */

const {
  httpRequestJson,
  BASE_URL,
  logSection,
  logSuccess,
  logError,
  logInfo,
  logWarning,
} = require('../_shared-utils');

// Override BASE_URL if provided via environment variable
const PROD_BASE_URL = process.env.BASE_URL || BASE_URL;

async function testRegister() {
  logSection('Testing Register API with Clinic ID cl0002');

  // Generate unique email to avoid conflicts
  const timestamp = Date.now();
  const testEmail = `test-patient-${timestamp}@test.com`;

  // Try multiple clinic IDs: CL0001 (should exist), then CL0002, then cl0002
  const clinicIdsToTry = ['CL0001', 'CL0002', 'cl0002'];

  for (const clinicId of clinicIdsToTry) {
    const registerData = {
      email: testEmail,
      password: 'TestPassword123!',
      firstName: 'Test',
      lastName: 'Patient',
      phone: '+1234567890',
      clinicId: clinicId,
      role: 'PATIENT',
      gender: 'MALE',
      dateOfBirth: '1990-01-01',
      address: '123 Test Street, Test City, Test State 12345',
    };

    logInfo(`\nTrying with Clinic ID: ${clinicId}`);
    logInfo(`Registering user with email: ${testEmail}`);
    logInfo(`Base URL: ${PROD_BASE_URL}`);
    logInfo(`Request URL: ${PROD_BASE_URL}/auth/register`);
    logInfo(`Request Body: ${JSON.stringify(registerData, null, 2)}`);

    try {
      // Increase timeout to 30 seconds for production
      const result = await httpRequestJson(
        'POST',
        `${PROD_BASE_URL}/auth/register`,
        registerData,
        {
          'Content-Type': 'application/json',
          'X-API-Version': '1',
        },
        30000
      );

      logInfo(`\nResponse Status: ${result.status}`);
      logInfo(`Response OK: ${result.ok}`);
      logInfo(`Response Data: ${JSON.stringify(result.data, null, 2)}`);

      if (result.ok && result.data?.data?.accessToken) {
        logSuccess('\n✓ Registration successful!');
        logSuccess(`Clinic ID used: ${clinicId}`);
        logSuccess(`\nResponse Structure:`);
        logInfo(`  Status: ${result.status} (${result.ok ? 'OK' : 'FAILED'})`);
        logInfo(`  Message: ${result.data?.message || 'N/A'}`);
        logInfo(`  Access Token: ${result.data.data.accessToken.substring(0, 50)}...`);
        logInfo(
          `  Refresh Token: ${result.data.data.refreshToken ? result.data.data.refreshToken.substring(0, 50) + '...' : 'N/A'}`
        );
        logInfo(`  User Data:`);
        logInfo(`    - ID: ${result.data.data.user?.id || 'N/A'}`);
        logInfo(`    - Email: ${result.data.data.user?.email || 'N/A'}`);
        logInfo(
          `    - Name: ${result.data.data.user?.firstName || ''} ${result.data.data.user?.lastName || ''}`.trim()
        );
        logInfo(`    - Role: ${result.data.data.user?.role || 'N/A'}`);
        logInfo(
          `    - Verified: ${result.data.data.user?.isVerified !== undefined ? result.data.data.user.isVerified : 'N/A'}`
        );
        logSuccess(`\n✓ Expected response structure verified!`);
        return true;
      } else {
        // If clinic not found, try next format
        if (result.data?.code === 'CLINIC_NOT_FOUND' && clinicId === clinicIdsToTry[0]) {
          logWarning(`Clinic ${clinicId} not found, trying ${clinicIdsToTry[1]}...`);
          continue;
        }

        logError('✗ Registration failed');
        if (result.data?.message) {
          logError(`Error: ${result.data.message}`);
        }
        if (result.data?.code) {
          logError(`Error Code: ${result.data.code}`);
        }
        if (result.data?.metadata) {
          logError(`Metadata: ${JSON.stringify(result.data.metadata, null, 2)}`);
        }

        // If this was the last attempt, return false
        if (clinicId === clinicIdsToTry[clinicIdsToTry.length - 1]) {
          logError('\n⚠ Clinic CL0002/cl0002 does not exist in the database.');
          logError('Please create the clinic first or use an existing clinic ID.');
          return false;
        }
      }
    } catch (error) {
      logError(`✗ Request failed: ${error.message}`);
      if (error.stack) {
        logError(`Stack: ${error.stack}`);
      }
      // If this was the last attempt, return false
      if (clinicId === clinicIdsToTry[clinicIdsToTry.length - 1]) {
        return false;
      }
    }
  }

  return false;
}

// Run the test
(async () => {
  try {
    const success = await testRegister();
    process.exit(success ? 0 : 1);
  } catch (error) {
    logError(`Test execution failed: ${error.message}`);
    process.exit(1);
  }
})();
