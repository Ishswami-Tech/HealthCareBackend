/**
 * List all clinics in the database
 *
 * Run with: node test-scripts/auth/list-clinics.js
 *
 * To test production:
 *   BASE_URL=https://backend-service-v1.ishswami.in/api/v1 node test-scripts/auth/list-clinics.js
 */

const {
  httpRequestJson,
  BASE_URL,
  logSection,
  logSuccess,
  logError,
  logInfo,
} = require('../_shared-utils');

// Override BASE_URL if provided via environment variable
const PROD_BASE_URL = process.env.BASE_URL || BASE_URL;

async function listClinics() {
  logSection('Listing All Clinics');

  logInfo(`Base URL: ${PROD_BASE_URL}`);
  logInfo(`Request URL: ${PROD_BASE_URL}/clinics`);

  try {
    // Note: This endpoint might require authentication
    // If it does, you'll need to provide a token
    const result = await httpRequestJson('GET', `${PROD_BASE_URL}/clinics`, null, {
      'Content-Type': 'application/json',
      'X-API-Version': '1',
    });

    logInfo(`\nResponse Status: ${result.status}`);
    logInfo(`Response OK: ${result.ok}`);
    logInfo(`Response Data: ${JSON.stringify(result.data, null, 2)}`);

    if (result.ok && result.data?.data) {
      const clinics = Array.isArray(result.data.data) ? result.data.data : [result.data.data];
      logSuccess(`✓ Found ${clinics.length} clinic(s)`);
      clinics.forEach((clinic, index) => {
        logInfo(`\nClinic ${index + 1}:`);
        logInfo(`  ID: ${clinic.id || 'N/A'}`);
        logInfo(`  Clinic ID: ${clinic.clinicId || 'N/A'}`);
        logInfo(`  Name: ${clinic.name || 'N/A'}`);
        logInfo(`  Active: ${clinic.isActive !== undefined ? clinic.isActive : 'N/A'}`);
      });
      return true;
    } else {
      logError('✗ Failed to list clinics');
      if (result.data?.message) {
        logError(`Error: ${result.data.message}`);
      }
      if (result.status === 401 || result.status === 403) {
        logError('⚠ This endpoint requires authentication. Please provide a valid token.');
      }
      return false;
    }
  } catch (error) {
    logError(`✗ Request failed: ${error.message}`);
    if (error.stack) {
      logError(`Stack: ${error.stack}`);
    }
    return false;
  }
}

// Run the test
(async () => {
  try {
    const success = await listClinics();
    process.exit(success ? 0 : 1);
  } catch (error) {
    logError(`Test execution failed: ${error.message}`);
    process.exit(1);
  }
})();
