/**
 * Appointment Endpoints Test Script
 * Tests all appointment endpoints one by one
 * Run with: node test-appointment-endpoints.js
 * 
 * Prerequisites:
 * - Server must be running on http://localhost:8088
 * - You need valid clinic and doctor IDs (set via env vars or defaults)
 */

const BASE_URL = 'http://localhost:8088/api/v1';

// Test IDs - can be overridden via environment variables
// For testing, you can set these to real IDs from your database
// After seeding: CL0001 or CL0002 are typical clinic IDs
const TEST_CLINIC_ID = process.env.TEST_CLINIC_ID || null; // Set to null to try to get from user
const TEST_DOCTOR_ID = process.env.TEST_DOCTOR_ID || null; // Will try to get from clinic

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
let clinicId = TEST_CLINIC_ID;
let doctorId = TEST_DOCTOR_ID;
let locationId = null;
let appointmentId = null;
let userId = null;

// Helper to get clinic ID from database query (if we can access it)
async function tryGetClinicFromDatabase() {
  // This would require direct database access or an API endpoint
  // For now, we'll rely on user profile or environment variable
  return null;
}

// Helper function to make HTTP requests
async function makeRequest(method, endpoint, body = null, headers = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const authHeader = accessToken && typeof accessToken === 'string' 
    ? `Bearer ${accessToken.trim()}` 
    : null;
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'X-API-Version': '1',
    ...(authHeader && { Authorization: authHeader }),
    ...(clinicId && { 'X-Clinic-ID': clinicId }),
    ...headers,
  };
  
  // Debug: Log token for first appointment request
  if (endpoint.includes('/appointments') && !endpoint.includes('/auth') && authHeader) {
    logInfo(`Sending token: ${authHeader.substring(0, 50)}...`);
  }

  const options = {
    method,
    headers: defaultHeaders,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    // Add timeout to requests (10 seconds for faster failure)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 10000);
    
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error('Request timeout after 10 seconds');
      }
      throw fetchError;
    }
    
    const data = await response.json().catch(() => ({ message: 'No JSON response' }));

    return {
      status: response.status,
      ok: response.ok,
      data,
      headers: Object.fromEntries(response.headers.entries()),
    };
  } catch (error) {
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return {
        status: 0,
        ok: false,
        data: { message: 'Request timeout after 10 seconds' },
        headers: {},
      };
    }
    return {
      status: 0,
      ok: false,
      data: { message: error.message || 'Network error' },
      headers: {},
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
  log('\n=== Test 0: Health Check ===', 'cyan');
  try {
    const response = await fetch('http://localhost:8088/health');
    const data = await response.json();
    if (response.ok) {
      logSuccess('Health check passed');
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

async function getUserProfile() {
  log('\n=== Getting User Profile ===', 'cyan');
  if (!accessToken) {
    logWarning('Skipping - No access token available');
    return false;
  }

  // Use the unified profile endpoint
  const result = await makeRequest('GET', '/user/profile');
  
  if (result.ok && (result.data?.data || result.data)) {
    const user = result.data?.data || result.data;
    // Try to get clinic ID from user profile
    if (user.primaryClinicId) {
      clinicId = user.primaryClinicId;
      logSuccess(`Found clinic ID from profile: ${clinicId}`);
      return true;
    } else if (user.clinicId) {
      clinicId = user.clinicId;
      logSuccess(`Found clinic ID from profile: ${clinicId}`);
      return true;
    } else if (user.clinics && Array.isArray(user.clinics) && user.clinics.length > 0) {
      clinicId = user.clinics[0].id || user.clinics[0];
      logSuccess(`Found clinic ID from clinics array: ${clinicId}`);
      return true;
    } else {
      // If clinic ID is already set from login, that's fine
      if (clinicId) {
        logInfo(`Using clinic ID from login: ${clinicId}`);
        return true;
      }
      logWarning('User profile does not have clinic association');
      // Don't log full user data (may contain sensitive info)
      return false;
    }
  } else {
    logWarning(`Failed to get user profile: ${result.status}`);
    if (result.data?.message) {
      logInfo(`Error: ${result.data.message}`);
    }
    // If clinic ID is already set from login, that's fine
    if (clinicId) {
      logInfo(`Using clinic ID from login: ${clinicId}`);
      return true;
    }
    return false;
  }
}

async function tryGetClinicsFromAPI() {
  log('\n=== Attempting to Get Clinics from API ===', 'cyan');
  if (!accessToken) {
    return false;
  }

  // Try to get clinics (requires CLINIC_ADMIN or SUPER_ADMIN role)
  const result = await makeRequest('GET', '/clinics');
  
  if (result.ok && result.data) {
    const clinics = Array.isArray(result.data) ? result.data : (result.data?.data || []);
    if (clinics.length > 0) {
      clinicId = clinics[0].id;
      logSuccess(`Found clinic from API: ${clinics[0].name} (ID: ${clinicId})`);
      
      // Try to get a doctor from this clinic
      if (!doctorId || doctorId === 'test-doctor-123') {
        const doctorsResult = await makeRequest('GET', `/clinics/${clinicId}/doctors`);
        if (doctorsResult.ok && doctorsResult.data) {
          const doctors = Array.isArray(doctorsResult.data) 
            ? doctorsResult.data 
            : (doctorsResult.data?.data || []);
          if (doctors.length > 0) {
            doctorId = doctors[0].id;
            logSuccess(`Found doctor from clinic: ${doctors[0].name || 'Doctor'} (ID: ${doctorId})`);
          }
        }
      }
      
      return true;
    }
  } else if (result.status === 403) {
    logWarning('Cannot access clinics endpoint (requires admin role)');
  } else {
    logWarning(`Failed to get clinics: ${result.status}`);
  }
  return false;
}

async function getDoctorIdFromDatabase() {
  log('\n=== Getting Doctor ID from Database ===', 'cyan');
  if (!clinicId) {
    logWarning('No clinic ID available');
    return false;
  }

  // Method 1: Try to get from user/role/doctors endpoint (if accessible)
  try {
    logInfo('Trying to get doctor ID from /user/role/doctors endpoint...');
    const doctorsResult = await Promise.race([
      makeRequest('GET', '/user/role/doctors'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000)),
    ]).catch(error => {
      if (error.message === 'Timeout') {
        return { ok: false, data: { message: 'Timeout' } };
      }
      throw error;
    });

    if (doctorsResult.ok && doctorsResult.data) {
      const doctors = Array.isArray(doctorsResult.data) 
        ? doctorsResult.data 
        : (Array.isArray(doctorsResult.data?.data) ? doctorsResult.data.data : []);
      if (doctors.length > 0) {
        doctorId = doctors[0].id;
        logSuccess(`Found doctor ID from doctors list: ${doctorId}`);
        return true;
      }
    }
  } catch (error) {
    logInfo(`Could not get from doctors endpoint: ${error.message}`);
  }

  // Method 2: Try doctor login with strict timeout (3 seconds max)
  try {
    logInfo('Attempting to login as doctor to get doctor ID (timeout: 3s)...');
    
    // Create a timeout promise that rejects after 3 seconds (shorter timeout)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Doctor login timeout')), 3000)
    );
    
    // Create login promise with explicit timeout
    const loginPromise = (async () => {
      try {
        return await makeRequest('POST', '/auth/login', {
          email: 'doctor1@example.com',
          password: 'test1234',
        }, {});
      } catch (error) {
        return { ok: false, data: { message: error.message } };
      }
    })();
    
    // Race between login and timeout
    const doctorLoginResult = await Promise.race([loginPromise, timeoutPromise]).catch(error => {
      if (error.message === 'Doctor login timeout') {
        logWarning('Doctor login timed out after 3 seconds');
        return { ok: false, data: { message: 'Login timeout' } };
      }
      return { ok: false, data: { message: error.message } };
    });

    if (doctorLoginResult && doctorLoginResult.ok) {
      const doctorToken = doctorLoginResult.data?.data?.accessToken || doctorLoginResult.data?.accessToken;
      if (doctorToken) {
        // Get doctor profile with timeout (3 seconds)
        const profileTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Profile timeout')), 3000)
        );
        
        const profilePromise = (async () => {
          try {
            return await makeRequest('GET', '/user/profile', {}, {
              'Authorization': `Bearer ${doctorToken}`,
              'X-Clinic-ID': clinicId,
            });
          } catch (error) {
            return { ok: false, data: { message: error.message } };
          }
        })();
        
        const doctorProfileResult = await Promise.race([profilePromise, profileTimeout]).catch(() => {
          logWarning('Doctor profile fetch timed out');
          return { ok: false, data: { message: 'Profile timeout' } };
        });

        if (doctorProfileResult && doctorProfileResult.ok && (doctorProfileResult.data?.data || doctorProfileResult.data)) {
          const doctorUser = doctorProfileResult.data?.data || doctorProfileResult.data;
          doctorId = (doctorUser.id || '').trim();
          if (doctorId) {
            logSuccess(`Found doctor ID from profile: ${doctorId}`);
            return true;
          }
        }
      }
    }
  } catch (error) {
    logWarning(`Error getting doctor ID from login: ${error.message}`);
  }

  // Method 3: Try to get doctor ID from an existing appointment (with timeout)
  logInfo('Trying alternative method to get doctor ID...');
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), 5000)
    );
    
    const myAppointmentsPromise = makeRequest('GET', '/appointments/my-appointments', null, {
      'Authorization': accessToken ? `Bearer ${accessToken}` : undefined,
    });
    
    const myAppointmentsResult = await Promise.race([myAppointmentsPromise, timeoutPromise]).catch(() => {
      return { ok: false, data: { message: 'Timeout' } };
    });
    
    if (myAppointmentsResult && myAppointmentsResult.ok && myAppointmentsResult.data?.data) {
      const appointments = Array.isArray(myAppointmentsResult.data.data) 
        ? myAppointmentsResult.data.data 
        : [];
      if (appointments.length > 0 && appointments[0].doctor?.id) {
        doctorId = appointments[0].doctor.id;
        logSuccess(`Found doctor ID from existing appointment: ${doctorId}`);
        return true;
      }
    }
  } catch (error) {
    logInfo(`Could not get doctor ID from appointments: ${error.message}`);
  }
  
  logWarning('Could not retrieve doctor ID. Some tests will be skipped.');
  logInfo('Tip: Set TEST_DOCTOR_ID environment variable or ensure doctor1@example.com exists in database');
  return false;
}

async function testLoginOrRegister() {
  log('\n=== Test 1: Login/Register Test User ===', 'cyan');
  
  // First, try to login with seeded user (has clinic access)
  const seededEmail = 'patient1@example.com';
  const seededPassword = 'test1234';
  
  logInfo(`Attempting to login with seeded user: ${seededEmail}`);
  const loginResult = await testLogin(seededEmail, seededPassword);
  
  if (loginResult) {
    logSuccess('Logged in with seeded user (has clinic access)');
    // Get clinic from profile
    await getUserProfile();
    // Try to get doctor ID early so it's available for appointment creation
    if (!doctorId) {
      await getDoctorIdFromDatabase();
    }
    return true;
  }
  
  // If seeded user doesn't work, try registration
  logInfo('Seeded user login failed, trying registration...');
  const testEmail = `testpatient_${Date.now()}@test.com`;
  const testPassword = 'TestPassword123!';
  
  const registerData = {
    email: testEmail,
    password: testPassword,
    firstName: 'Test',
    lastName: 'Patient',
    phone: '+1234567890',
    role: 'PATIENT',
    gender: 'MALE',
    dateOfBirth: '1990-01-01',
  };

  const result = await makeRequest('POST', '/auth/register', registerData, {});
  
  if (result.ok) {
    // Try different response structures
    const token = result.data?.data?.accessToken || result.data?.accessToken || result.data?.data?.tokens?.accessToken;
    const user = result.data?.data?.user || result.data?.user;
    
    if (token) {
      logSuccess('Register: OK');
      accessToken = token;
      userId = user?.id || result.data?.data?.user?.id;
      clinicId = user?.clinicId || result.data?.data?.user?.clinicId || user?.primaryClinicId || clinicId;
      logInfo(`Registered user: ${testEmail}`);
      logInfo(`Access Token: ${typeof token === 'string' ? token.substring(0, 30) + '...' : 'INVALID TYPE'}`);
      logInfo(`User ID: ${userId}`);
      logInfo(`Clinic ID from registration: ${clinicId}`);
      
      // Try to get clinic from user profile
      await getUserProfile();
      
      return true;
    } else {
      logWarning(`Register response missing token: ${JSON.stringify(result.data, null, 2)}`);
      return false;
    }
  } else {
    logWarning(`Register failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testLogin(email = 'patient@test.com', password = 'TestPassword123!') {
  log('\n=== Test 1b: Login (Required for Auth) ===', 'cyan');
  const loginData = {
    email: email,
    password: password,
  };

  const result = await makeRequest('POST', '/auth/login', loginData, {});
  
  if (result.ok) {
    // Try different response structures
    const token = result.data?.data?.accessToken || result.data?.accessToken || result.data?.data?.tokens?.accessToken;
    const user = result.data?.data?.user || result.data?.user;
    
    if (token && typeof token === 'string') {
      logSuccess('Login: OK');
      accessToken = token;
      userId = user?.id || result.data?.data?.user?.id;
      clinicId = user?.clinicId || result.data?.data?.user?.clinicId || clinicId;
      logInfo(`Access Token obtained`);
      logInfo(`User ID: ${userId}`);
      logInfo(`Clinic ID: ${clinicId}`);
      return true;
    } else {
      logWarning(`Login response missing valid token: ${JSON.stringify(result.data, null, 2)}`);
      return false;
    }
  } else {
    logWarning(`Login failed: ${result.status} - ${JSON.stringify(result.data)}`);
    logInfo('Continuing with tests (some will fail without auth)');
    return false;
  }
}

async function testCreateAppointment() {
  log('\n=== Test 3: POST /appointments - Create Appointment ===', 'cyan');
  if (!accessToken) {
    logWarning('Skipping - No access token available');
    return false;
  }

  if (!clinicId || clinicId === 'test-clinic-123') {
    logWarning(`Skipping - No valid clinic ID available (current: ${clinicId})`);
    logInfo('Note: User needs to be associated with a clinic.');
    logInfo('Options:');
    logInfo('  1. Set TEST_CLINIC_ID environment variable to a real clinic ID');
    logInfo('  2. Run seed script: pnpm seed:dev (creates clinics CL0001, CL0002)');
    logInfo('  3. Use seeded user: patient1@example.com / test1234 (has clinic access)');
    logInfo('  4. Manually associate user with clinic via database');
    return false;
  }

  // Try to get doctor ID if not set
  if (!doctorId || doctorId === 'test-doctor-123' || doctorId === 'null' || doctorId === 'undefined') {
    logInfo('Doctor ID not set, attempting to get it...');
    const gotDoctorId = await getDoctorIdFromDatabase();
    if (!gotDoctorId || !doctorId || doctorId === 'test-doctor-123' || doctorId === 'null' || doctorId === 'undefined') {
      logWarning(`Skipping - No valid doctor ID available (current: ${doctorId})`);
      logInfo('Note: Set TEST_DOCTOR_ID environment variable to a real doctor ID from your database');
      return false;
    }
  }

  // Get location ID if not set
  if (!locationId && clinicId) {
    try {
      logInfo(`Attempting to get locations for clinic: ${clinicId}`);
      
      // Try my-clinic endpoint first (patients can access this)
      let locationsResult = await Promise.race([
        makeRequest('GET', '/clinics/my-clinic'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000)),
      ]).catch(error => {
        if (error.message === 'Timeout') {
          return { ok: false, data: { message: 'Timeout' } };
        }
        throw error;
      });
      
      // If my-clinic works, extract locations from it
      if (locationsResult.ok && locationsResult.data) {
        const clinicData = locationsResult.data?.data || locationsResult.data;
        if (clinicData.locations && Array.isArray(clinicData.locations) && clinicData.locations.length > 0) {
          locationId = clinicData.locations[0].id;
          logSuccess(`Using location ID from my-clinic: ${locationId}`);
        }
      }
      
      // If still no location, try direct locations endpoint (requires staff role)
      if (!locationId) {
        locationsResult = await Promise.race([
          makeRequest('GET', `/clinics/${clinicId}/locations`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000)),
        ]).catch(error => {
          if (error.message === 'Timeout') {
            return { ok: false, data: { message: 'Timeout' } };
          }
          throw error;
        });
        
        if (locationsResult.ok && locationsResult.data) {
          const locations = Array.isArray(locationsResult.data) 
            ? locationsResult.data 
            : (Array.isArray(locationsResult.data?.data) ? locationsResult.data.data : []);
          if (locations.length > 0) {
            locationId = locations[0].id;
            logSuccess(`Using location ID: ${locationId}`);
          } else {
            logWarning('Clinic has no locations');
          }
        } else {
          logWarning(`Could not get locations: ${locationsResult.status || 'unknown error'} (may require staff role)`);
        }
      }
      
      if (!locationId) {
        logInfo('Note: Appointment creation requires a valid location ID. Clinic may need to have locations created.');
      }
    } catch (error) {
      logWarning(`Could not get location ID: ${error.message}`);
    }
  }

  if (!locationId) {
    logWarning('Skipping - No location ID available');
    logInfo('Note: Clinic must have at least one location');
    return false;
  }

  if (!userId) {
    logWarning('Skipping - No user ID available');
    return false;
  }

  // Calculate tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];

  const appointmentData = {
    patientId: userId,
    doctorId: doctorId.trim(), // Ensure no whitespace
    locationId: locationId,
    clinicId: clinicId,
    date: dateStr,
    time: '10:00',
    duration: 30,
    type: 'GENERAL_CONSULTATION',
    notes: 'This is a test appointment',
  };

  const result = await makeRequest('POST', '/appointments', appointmentData);
  
  if (result.ok && result.data?.data) {
    logSuccess('Create Appointment: OK');
    appointmentId = result.data.data.id || result.data.data.data?.id;
    logInfo(`Appointment ID: ${appointmentId}`);
    return true;
  } else {
    logError(`Create Appointment failed: ${result.status} - ${JSON.stringify(result.data, null, 2)}`);
    if (result.status === 403 && result.data?.message?.includes('clinic')) {
      logInfo('Tip: User needs to be associated with the clinic. Check clinic access permissions.');
    }
    return false;
  }
}

async function testGetMyAppointments() {
  log('\n=== Test 4: GET /appointments/my-appointments ===', 'cyan');
  if (!accessToken) {
    logWarning('Skipping - No access token available');
    return false;
  }

  const result = await makeRequest('GET', '/appointments/my-appointments');
  
  if (result.ok) {
    logSuccess('Get My Appointments: OK');
    const appointments = result.data?.data || result.data || [];
    logInfo(`Found ${Array.isArray(appointments) ? appointments.length : 0} appointment(s)`);
    return true;
  } else {
    logError(`Get My Appointments failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testGetAllAppointments() {
  log('\n=== Test 5: GET /appointments - Get All Appointments (Staff) ===', 'cyan');
  if (!accessToken) {
    logWarning('Skipping - No access token available');
    return false;
  }

  const result = await makeRequest('GET', '/appointments');
  
  if (result.ok) {
    logSuccess('Get All Appointments: OK');
    const appointments = result.data?.data || result.data || [];
    logInfo(`Found ${Array.isArray(appointments) ? appointments.length : 0} appointment(s)`);
    return true;
  } else if (result.status === 403) {
    logWarning('Get All Appointments: Expected failure (Patients cannot access)');
    return true; // Expected for patient role
  } else {
    logError(`Get All Appointments failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testGetDoctorAvailability() {
  log('\n=== Test 6: GET /appointments/doctor/:doctorId/availability ===', 'cyan');
  if (!accessToken) {
    logWarning('Skipping - No access token available');
    return false;
  }

  // If doctorId is not set, try to get it first
  if (!doctorId || doctorId === 'null' || doctorId === 'undefined') {
    logWarning('Doctor ID not available, attempting to get it...');
    const gotDoctorId = await getDoctorIdFromDatabase();
    if (!gotDoctorId || !doctorId) {
      logWarning('Skipping - No valid doctor ID available');
      return false;
    }
  }

  // Ensure doctor ID is trimmed (no whitespace)
  const cleanDoctorId = (doctorId || '').trim();
  if (!cleanDoctorId) {
    logWarning('Skipping - Doctor ID is empty after trimming');
    return false;
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];

  const result = await makeRequest('GET', `/appointments/doctor/${cleanDoctorId}/availability?date=${dateStr}`);
  
  if (result.ok) {
    logSuccess('Get Doctor Availability: OK');
    logInfo(`Date checked: ${dateStr}`);
    const availability = result.data?.data || result.data;
    if (availability) {
      logInfo(`Available slots: ${availability.availableSlots?.length || 0}`);
    }
    return true;
  } else {
    logError(`Get Doctor Availability failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testGetUserUpcomingAppointments() {
  log('\n=== Test 7: GET /appointments/user/:userId/upcoming ===', 'cyan');
  if (!accessToken || !userId) {
    logWarning('Skipping - No access token or user ID available');
    return false;
  }

  const result = await makeRequest('GET', `/appointments/user/${userId}/upcoming`);
  
  if (result.ok) {
    logSuccess('Get User Upcoming Appointments: OK');
    const appointments = result.data || [];
    logInfo(`Found ${Array.isArray(appointments) ? appointments.length : 0} upcoming appointment(s)`);
    return true;
  } else {
    logError(`Get User Upcoming Appointments failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testGetAppointmentById() {
  log('\n=== Test 8: GET /appointments/:id ===', 'cyan');
  if (!accessToken || !appointmentId) {
    logWarning('Skipping - No access token or appointment ID available');
    return false;
  }

  const result = await makeRequest('GET', `/appointments/${appointmentId}`);
  
  if (result.ok) {
    logSuccess('Get Appointment By ID: OK');
    logInfo(`Appointment ID: ${appointmentId}`);
    return true;
  } else {
    logError(`Get Appointment By ID failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testUpdateAppointment() {
  log('\n=== Test 9: PUT /appointments/:id - Update Appointment ===', 'cyan');
  if (!accessToken || !appointmentId) {
    logWarning('Skipping - No access token or appointment ID available');
    return false;
  }

  const updateData = {
    notes: 'Updated test appointment notes',
    reason: 'Updated reason',
  };

  const result = await makeRequest('PUT', `/appointments/${appointmentId}`, updateData);
  
  if (result.ok) {
    logSuccess('Update Appointment: OK');
    return true;
  } else {
    logError(`Update Appointment failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testCancelAppointment() {
  log('\n=== Test 10: DELETE /appointments/:id - Cancel Appointment ===', 'cyan');
  if (!accessToken || !appointmentId) {
    logWarning('Skipping - No access token or appointment ID available');
    return false;
  }

  const result = await makeRequest('DELETE', `/appointments/${appointmentId}`);
  
  if (result.ok) {
    logSuccess('Cancel Appointment: OK');
    return true;
  } else {
    logError(`Cancel Appointment failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testCreateVideoRoom() {
  log('\n=== Test 11: POST /appointments/:id/video/create-room ===', 'cyan');
  if (!accessToken || !appointmentId) {
    logWarning('Skipping - No access token or appointment ID available');
    return false;
  }

  const result = await makeRequest('POST', `/appointments/${appointmentId}/video/create-room`);
  
  if (result.ok) {
    logSuccess('Create Video Room: OK');
    return true;
  } else if (result.status === 403) {
    logWarning('Create Video Room: Expected failure (Patients cannot create rooms)');
    return true; // Expected for patient role
  } else {
    logError(`Create Video Room failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testGenerateVideoJoinToken() {
  log('\n=== Test 12: POST /appointments/:id/video/join-token ===', 'cyan');
  if (!accessToken || !appointmentId) {
    logWarning('Skipping - No access token or appointment ID available');
    return false;
  }

  const result = await makeRequest('POST', `/appointments/${appointmentId}/video/join-token`);
  
  if (result.ok) {
    logSuccess('Generate Video Join Token: OK');
    return true;
  } else {
    logError(`Generate Video Join Token failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testVideoStart() {
  log('\n=== Test 13: POST /appointments/:id/video/start ===', 'cyan');
  if (!accessToken || !appointmentId) {
    logWarning('Skipping - No access token or appointment ID available');
    return false;
  }

  const result = await makeRequest('POST', `/appointments/${appointmentId}/video/start`);
  
  if (result.ok) {
    logSuccess('Start Video Consultation: OK');
    return true;
  } else {
    logWarning(`Start Video Consultation failed: ${result.status} - May require video room setup`);
    return false;
  }
}

async function testVideoStatus() {
  log('\n=== Test 14: GET /appointments/:id/video/status ===', 'cyan');
  if (!accessToken || !appointmentId) {
    logWarning('Skipping - No access token or appointment ID available');
    return false;
  }

  const result = await makeRequest('GET', `/appointments/${appointmentId}/video/status`);
  
  if (result.ok) {
    logSuccess('Get Video Status: OK');
    return true;
  } else if (result.status === 404) {
    logWarning('Get Video Status: No video session found (expected if not started)');
    return true;
  } else {
    logError(`Get Video Status failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

async function testVideoEnd() {
  log('\n=== Test 15: POST /appointments/:id/video/end ===', 'cyan');
  if (!accessToken || !appointmentId) {
    logWarning('Skipping - No access token or appointment ID available');
    return false;
  }

  const result = await makeRequest('POST', `/appointments/${appointmentId}/video/end`, {
    meetingNotes: 'Test consultation completed',
  });
  
  if (result.ok) {
    logSuccess('End Video Consultation: OK');
    return true;
  } else {
    logWarning(`End Video Consultation failed: ${result.status} - May require active session`);
    return false;
  }
}

async function testReportTechnicalIssue() {
  log('\n=== Test 16: POST /appointments/:id/video/report-issue ===', 'cyan');
  if (!accessToken || !appointmentId) {
    logWarning('Skipping - No access token or appointment ID available');
    return false;
  }

  const result = await makeRequest('POST', `/appointments/${appointmentId}/video/report-issue`, {
    issueType: 'connection',
    description: 'Test technical issue report',
  });
  
  if (result.ok) {
    logSuccess('Report Technical Issue: OK');
    return true;
  } else {
    logWarning(`Report Technical Issue failed: ${result.status} - May require active video session`);
    return false;
  }
}

async function testAppointmentContext() {
  log('\n=== Test 17: GET /appointments/test/context ===', 'cyan');
  if (!accessToken) {
    logWarning('Skipping - No access token available');
    return false;
  }

  const result = await makeRequest('GET', '/appointments/test/context');
  
  if (result.ok) {
    logSuccess('Test Appointment Context: OK');
    logInfo(JSON.stringify(result.data, null, 2));
    return true;
  } else {
    logError(`Test Appointment Context failed: ${result.status} - ${JSON.stringify(result.data)}`);
    return false;
  }
}

// Main test runner
async function runTests() {
  log('\n========================================', 'cyan');
  log('  Appointment Endpoints Test Suite', 'cyan');
  log('========================================\n', 'cyan');

  const tests = [
    { name: 'Health Check', fn: testHealthCheck },
    { name: 'Login/Register', fn: testLoginOrRegister },
    { name: 'Get User Profile (for clinic)', fn: getUserProfile },
    { name: 'Try Get Clinics from API', fn: tryGetClinicsFromAPI },
    { name: 'Get Doctor ID', fn: getDoctorIdFromDatabase },
    { name: 'Create Appointment', fn: testCreateAppointment },
    { name: 'Get My Appointments', fn: testGetMyAppointments },
    { name: 'Get All Appointments', fn: testGetAllAppointments },
    { name: 'Get Doctor Availability', fn: testGetDoctorAvailability },
    { name: 'Get User Upcoming Appointments', fn: testGetUserUpcomingAppointments },
    { name: 'Get Appointment By ID', fn: testGetAppointmentById },
    { name: 'Update Appointment', fn: testUpdateAppointment },
    { name: 'Create Video Room', fn: testCreateVideoRoom },
    { name: 'Generate Video Join Token', fn: testGenerateVideoJoinToken },
    { name: 'Start Video Consultation', fn: testVideoStart },
    { name: 'Get Video Status', fn: testVideoStatus },
    { name: 'End Video Consultation', fn: testVideoEnd },
    { name: 'Report Technical Issue', fn: testReportTechnicalIssue },
    { name: 'Test Appointment Context', fn: testAppointmentContext },
    { name: 'Cancel Appointment', fn: testCancelAppointment }, // Cancel last to clean up
  ];

  const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result === true) {
        results.passed++;
      } else if (result === false) {
        results.failed++;
      } else {
        results.skipped++;
      }
      await wait(500); // Small delay between tests
    } catch (error) {
      logError(`Test "${test.name}" threw an error: ${error.message}`);
      results.failed++;
    }
  }

  log('\n========================================', 'cyan');
  log('  Test Summary', 'cyan');
  log('========================================', 'cyan');
  log(`Passed: ${results.passed}`, 'green');
  log(`Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'green');
  log(`Skipped: ${results.skipped}`, 'yellow');
  log('========================================\n', 'cyan');

  if (results.failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  logError(`Test suite failed: ${error.message}`);
  console.error(error);
  process.exit(1);
});

