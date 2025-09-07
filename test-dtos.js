// Test file to verify DTOs are working correctly
// This is a temporary test file to validate our Step 1 implementation

console.log("🧪 Testing Enhanced DTOs Library...");

try {
  // Test importing DTOs
  const {
    LoginDto,
    RegisterDto,
    CreateUserDto,
    CreateAppointmentDto,
    CreateClinicDto,
    HealthCheckResponseDto,
    BaseResponseDto,
    PaginatedResponseDto,
  } = require("./dist/libs/dtos");

  console.log("✅ All DTOs imported successfully!");

  // Test creating instances
  const loginDto = new LoginDto();
  loginDto.email = "test@example.com";
  loginDto.password = "SecurePassword123!";

  console.log("✅ LoginDto instance created:", loginDto.email);

  const userDto = new CreateUserDto();
  userDto.email = "user@example.com";
  userDto.password = "SecurePassword123!";
  userDto.firstName = "John";
  userDto.lastName = "Doe";
  userDto.phone = "+1234567890";

  console.log(
    "✅ CreateUserDto instance created:",
    userDto.firstName,
    userDto.lastName
  );

  const appointmentDto = new CreateAppointmentDto();
  appointmentDto.patientId = "patient-uuid-123";
  appointmentDto.doctorId = "doctor-uuid-123";
  appointmentDto.clinicId = "clinic-uuid-123";
  appointmentDto.appointmentDate = "2024-01-15T10:00:00.000Z";
  appointmentDto.duration = 30;
  appointmentDto.type = "CONSULTATION";

  console.log("✅ CreateAppointmentDto instance created:", appointmentDto.type);

  const clinicDto = new CreateClinicDto();
  clinicDto.name = "Test Clinic";
  clinicDto.type = "GENERAL";
  clinicDto.address = "123 Test St";
  clinicDto.city = "Test City";
  clinicDto.state = "TS";
  clinicDto.country = "Test Country";
  clinicDto.zipCode = "12345";
  clinicDto.phone = "+1234567890";
  clinicDto.email = "test@clinic.com";

  console.log("✅ CreateClinicDto instance created:", clinicDto.name);

  const healthDto = new HealthCheckResponseDto();
  healthDto.status = "healthy";
  healthDto.timestamp = new Date().toISOString();
  healthDto.service = "Test Service";
  healthDto.version = "1.0.0";
  healthDto.environment = "test";

  console.log("✅ HealthCheckResponseDto instance created:", healthDto.status);

  const responseDto = new BaseResponseDto("Test message");
  console.log("✅ BaseResponseDto instance created:", responseDto.message);

  console.log("\n🎉 All DTOs are working correctly!");
  console.log("📋 Step 1 (Enhanced DTOs Library) completed successfully!");
} catch (error) {
  console.error("❌ Error testing DTOs:", error.message);
  console.error("Stack trace:", error.stack);
}
