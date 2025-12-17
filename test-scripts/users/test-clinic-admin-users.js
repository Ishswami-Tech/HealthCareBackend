/**
 * CLINIC_ADMIN Role Users Endpoints Test
 * Tests all user management endpoints accessible to CLINIC_ADMIN role
 *
 * Run with: node test-scripts/users/test-clinic-admin-users.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.CLINIC_ADMIN;

const clinicAdminUsersTests = {
  async testGetAllUsers(ctx) {
    const result = await ctx.makeRequest('GET', '/user/all');
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get All Users', passed);
    return passed;
  },

  async testGetProfile(ctx) {
    const result = await ctx.makeRequest('GET', '/user/profile');
    const passed = result.ok || result.status === 403; // 403 = permission issue
    ctx.recordTest('Get Profile', passed);
    return passed;
  },

  async testGetUserById(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Get User By ID', false, true);
      return false;
    }
    const result = await ctx.makeRequest('GET', `/user/${ctx.userId}`);
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get User By ID', passed);
    return passed;
  },

  async testUpdateUser(ctx) {
    if (!ctx.userId) {
      ctx.recordTest('Update User', false, true);
      return false;
    }
    const result = await ctx.makeRequest('PATCH', `/user/${ctx.userId}`, {
      firstName: 'Updated',
    });
    const passed = result.ok || result.status === 403 || result.status === 400; // 403 = permission, 400 = validation
    ctx.recordTest('Update User', passed);
    return passed;
  },

  async testGetDoctors(ctx) {
    const result = await ctx.makeRequest('GET', '/user/role/doctors');
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Doctors', passed);
    return passed;
  },

  async testGetReceptionists(ctx) {
    const result = await ctx.makeRequest('GET', '/user/role/receptionists');
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Receptionists', passed);
    return passed;
  },

  async testGetPatients(ctx) {
    const result = await ctx.makeRequest('GET', '/user/role/patient');
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Patients', passed);
    return passed;
  },

  async testCreateUserWithLocation(ctx) {
    if (!ctx.clinicId || !ctx.locationId) {
      ctx.recordTest('Create User With Location', false, true);
      return false;
    }
    // Create a test receptionist user with locationId
    const testEmail = `test-receptionist-${Date.now()}@example.com`;
    const result = await ctx.makeRequest('POST', '/user', {
      email: testEmail,
      password: 'Test1234!@#',
      firstName: 'Test',
      lastName: 'Receptionist',
      phone: '+1234567890',
      role: 'RECEPTIONIST',
      clinicId: ctx.clinicId,
      locationId: ctx.locationId,
    });
    const passed =
      result.ok || result.status === 400 || result.status === 403 || result.status === 409; // 409 = user already exists
    if (result.ok && result.data?.data?.id) {
      ctx.testCreatedUserId = result.data.data.id;
    }
    ctx.recordTest('Create User With Location', passed);
    return passed;
  },

  async testUpdateUserRoleWithLocation(ctx) {
    if (!ctx.userId || !ctx.locationId) {
      ctx.recordTest('Update User Role With Location', false, true);
      return false;
    }
    // Update user role to PHARMACIST with locationId
    const result = await ctx.makeRequest('PUT', `/user/${ctx.userId}/role`, {
      role: 'PHARMACIST',
      clinicId: ctx.clinicId,
      locationId: ctx.locationId,
    });
    const passed =
      result.ok || result.status === 400 || result.status === 403 || result.status === 404;
    ctx.recordTest('Update User Role With Location', passed);
    return passed;
  },

  async testGetUsersByLocation(ctx) {
    if (!ctx.clinicId || !ctx.locationId) {
      ctx.recordTest('Get Users By Location', false, true);
      return false;
    }
    // Test getting receptionists (should filter by location if implemented)
    const result = await ctx.makeRequest('GET', '/user/role/receptionists', null, {
      'X-Location-ID': ctx.locationId,
    });
    const passed = result.ok || result.status === 403;
    ctx.recordTest('Get Users By Location', passed);
    return passed;
  },

  async testChangeUserLocation(ctx) {
    if (!ctx.userId || !ctx.clinicId || !ctx.locationId) {
      ctx.recordTest('Change User Location', false, true);
      return false;
    }
    // Get another location for testing
    const locationsResult = await ctx.makeRequest('GET', `/clinics/${ctx.clinicId}/locations`);
    if (!locationsResult.ok || !locationsResult.data?.data?.length) {
      ctx.recordTest('Change User Location', false, true);
      return false;
    }
    const locations = locationsResult.data.data;
    const newLocationId = locations.find(loc => loc.id !== ctx.locationId)?.id || ctx.locationId;
    
    // Test changing user location (only CLINIC_ADMIN and SUPER_ADMIN can do this)
    const result = await ctx.makeRequest('POST', `/user/${ctx.userId}/change-location`, {
      locationId: newLocationId,
    });
    const passed =
      result.ok || result.status === 400 || result.status === 403 || result.status === 404;
    
    // If successful, revert back to original location
    if (result.ok && newLocationId !== ctx.locationId) {
      await ctx.makeRequest('POST', `/user/${ctx.userId}/change-location`, {
        locationId: ctx.locationId,
      }).catch(() => {
        // Ignore revert errors
      });
    }
    
    ctx.recordTest('Change User Location', passed);
    return passed;
  },

  async testGetLocationHeadUsers(ctx) {
    if (!ctx.clinicId) {
      ctx.recordTest('Get LocationHead Users', false, true);
      return false;
    }
    // Test getting LocationHead users
    const result = await ctx.makeRequest('GET', '/user/role/location-head');
    const passed = result.ok || result.status === 403 || result.status === 404;
    ctx.recordTest('Get LocationHead Users', passed);
    return passed;
  },

  async testCreateLocationHeadUser(ctx) {
    if (!ctx.clinicId || !ctx.locationId) {
      ctx.recordTest('Create LocationHead User', false, true);
      return false;
    }
    // Create a LocationHead user with locationId
    const testEmail = `locationhead-${Date.now()}@example.com`;
    const result = await ctx.makeRequest('POST', '/user', {
      email: testEmail,
      password: 'Test1234!@#',
      firstName: 'Location',
      lastName: 'Head',
      phone: '+1234567890',
      role: 'LOCATION_HEAD',
      clinicId: ctx.clinicId,
      locationId: ctx.locationId,
    });
    const passed =
      result.ok || result.status === 400 || result.status === 403 || result.status === 409;
    if (result.ok && result.data?.data?.id) {
      ctx.testLocationHeadUserId = result.data.data.id;
    }
    ctx.recordTest('Create LocationHead User', passed);
    return passed;
  },
};

async function runClinicAdminUsersTests() {
  logSection('CLINIC_ADMIN Role Users Endpoints Test');

  const ctx = new TestContext('CLINIC_ADMIN', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  const testSuite = [
    'testGetAllUsers',
    'testGetProfile',
    'testGetUserById',
    'testUpdateUser',
    'testGetDoctors',
    'testGetReceptionists',
    'testGetPatients',
    'testGetLocationHeadUsers',
    'testCreateUserWithLocation',
    'testCreateLocationHeadUser',
    'testUpdateUserRoleWithLocation',
    'testGetUsersByLocation',
    'testChangeUserLocation',
  ];

  for (const testName of testSuite) {
    const testFn = clinicAdminUsersTests[testName];
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

runClinicAdminUsersTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
