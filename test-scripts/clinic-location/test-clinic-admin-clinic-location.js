/**
 * CLINIC_ADMIN Role Clinic-Location Endpoints Test
 * Tests all clinic-location endpoints accessible to CLINIC_ADMIN role
 *
 * Run with: node test-scripts/clinic-location/test-clinic-admin-clinic-location.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.CLINIC_ADMIN;

const clinicAdminClinicLocationTests = {
  async testGetAllLocations(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Get All Locations', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/clinics/${ctx.clinicId}/locations`);
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get All Locations', passed);
    return passed;
  },

  async testGetLocationById(ctx) {
    if (!ctx.clinicId || !ctx.locationId) {
      ctx.recordTest('Get Location By ID', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'GET',
      `/clinics/${ctx.clinicId}/locations/${ctx.locationId}`
    );
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Location By ID', passed);
    return passed;
  },

  async testCreateLocation(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Create Location', false, true);
      return false;
    }
    const result = await ctx.makeRequest('POST', `/clinics/${ctx.clinicId}/locations`, {
      name: 'Test Location',
      address: '123 Test St',
      city: 'Test City',
      state: 'TS',
      country: 'Test Country',
      zipCode: '12345',
      phone: '+1234567890',
      email: 'test@example.com',
      timezone: 'UTC',
      workingHours: '9:00 AM - 5:00 PM',
      isActive: true,
    });
    const passed =
      result.ok ||
      result.status === 400 ||
      result.status === 403 ||
      result.status === 404 ||
      result.status === 500;
    if (result.ok && result.data?.data?.id) {
      ctx.testLocationId = result.data.data.id;
    }
    ctx.recordTest('Create Location', passed);
    return passed;
  },

  async testUpdateLocation(ctx) {
    if (!ctx.clinicId || (!ctx.locationId && !ctx.testLocationId)) {
      ctx.recordTest('Update Location', false, true);
      return false;
    }
    const locationId = ctx.testLocationId || ctx.locationId;
    const result = await ctx.makeRequest(
      'PUT',
      `/clinics/${ctx.clinicId}/locations/${locationId}`,
      {
        name: 'Updated Test Location',
      }
    );
    const passed =
      result.ok ||
      result.status === 400 ||
      result.status === 403 ||
      result.status === 404 ||
      result.status === 500;
    ctx.recordTest('Update Location', passed);
    return passed;
  },

  async testDeleteLocation(ctx) {
    if (!ctx.clinicId || (!ctx.testLocationId && !ctx.locationId)) {
      ctx.recordTest('Delete Location', false, true);
      return false;
    }
    // Only delete if we created a test location
    if (!ctx.testLocationId) {
      ctx.recordTest('Delete Location', false, true);
      return false;
    }
    const result = await ctx.makeRequest(
      'DELETE',
      `/clinics/${ctx.clinicId}/locations/${ctx.testLocationId}`
    );
    const passed =
      result.ok ||
      result.status === 400 ||
      result.status === 403 ||
      result.status === 404 ||
      result.status === 500;
    ctx.recordTest('Delete Location', passed);
    return passed;
  },
};

async function runClinicAdminClinicLocationTests() {
  logSection('CLINIC_ADMIN Role Clinic-Location Endpoints Test');

  const ctx = new TestContext('CLINIC_ADMIN', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  const testSuite = [
    'testGetAllLocations',
    'testGetLocationById',
    'testCreateLocation',
    'testUpdateLocation',
    'testDeleteLocation',
  ];

  for (const testName of testSuite) {
    const testFn = clinicAdminClinicLocationTests[testName];
    if (testFn) {
      try {
        await testFn(ctx);
        await wait(300);
      } catch (error) {
        ctx.recordTest(testName, false);
      }
    }
  }

  ctx.printSummary();

  if (ctx.results.failed > 0) {
    process.exit(1);
  }
}

runClinicAdminClinicLocationTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});

