# 📍 Static Location-Based QR Code Check-In

## Overview

This feature enables patients to check in to their appointments by scanning a static QR code displayed at the clinic location. When a patient scans the QR code, the system automatically:

1. Identifies the location from the QR code
2. Finds the patient's appointments for that location
3. Validates the appointment (date, time, status)
4. Automatically checks in the patient
5. Adds the patient to the doctor's queue

## 🎯 Use Case

**Scenario**: A patient books an appointment for a specific clinic location. When they arrive at the location, they scan a static QR code displayed at the reception. The system automatically:

- Verifies they have an appointment at that location
- Checks them in automatically
- Adds them to the doctor's queue
- Provides their queue position and estimated wait time

## 📋 Current Implementation Status

### ✅ What's Already Implemented

#### 1. **Location QR Service** (`src/libs/utils/QR/location-qr.service.ts`)
- ✅ `generateLocationQR(locationId)` - Generates QR data for a location
- ✅ `verifyLocationQR(qrData, appointmentLocationId)` - Verifies QR matches location

#### 2. **Check-In Location Service** (`src/services/appointments/plugins/therapy/check-in-location.service.ts`)
- ✅ `getLocationByQRCode(qrCode)` - Retrieves location by QR code
- ✅ `createCheckInLocation(data)` - Creates check-in locations with QR codes
- ✅ `processCheckIn(data)` - Processes check-in with location validation
- ✅ Location validation with coordinates/radius (geofencing)

#### 3. **Check-In Service** (`src/services/appointments/plugins/checkin/check-in.service.ts`)
- ✅ `checkIn(appointmentId, userId)` - Manual check-in
- ✅ `processCheckIn(appointmentId, clinicId)` - QR check-in processing
- ✅ `addToQueue()` - Adds patient to doctor queue
- ✅ Queue management functions

#### 4. **Queue Service** (`src/services/appointments/plugins/queue/appointment-queue.service.ts`)
- ✅ `getDoctorQueue()` - Gets doctor's queue
- ✅ `getPatientQueuePosition()` - Gets patient position in queue
- ✅ Queue reordering and management

#### 5. **Database Schema**
- ✅ `CheckInLocation` model with `qrCode` field
- ✅ `CheckIn` model for tracking check-ins
- ✅ Indexes on `qrCode` for fast lookup

### ❌ What's Missing (To Be Implemented)

#### 1. **Controller Endpoint for QR Scan**
- ❌ Missing: `POST /appointments/check-in/scan-qr` endpoint
- ❌ Should accept QR code data and user context
- ❌ Should automatically find appointments and check-in

#### 2. **Automatic Appointment Lookup & Validation**
- ❌ Missing: Logic to find user's appointments for scanned location
- ❌ Missing: Validation that appointment exists, is valid, and matches location
- ❌ Missing: Date/time validation (appointment is today/upcoming)

#### 3. **End-to-End Integration Flow**
- ❌ Missing: Complete flow connecting all services
- ❌ Missing: User context extraction from authenticated request

#### 4. **Static QR Code Generation Endpoint**
- ❌ Missing: `GET /locations/:locationId/qr-code` to generate static QR for locations
- ❌ Missing: Integration with `QrService` to generate actual QR image

#### 5. **DTOs for QR Scan**
- ❌ Missing: `ScanLocationQRDto` for QR scan request
- ❌ Missing: Response DTO for check-in result with queue position

#### 6. **Error Handling**
- ❌ Missing: Specific error messages for edge cases

## 🔄 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER SCANS QR CODE                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  POST /appointments/check-in/scan-qr                             │
│  Body: { qrCode: "CHK-clinic123-loc456-..." }                  │
│  Headers: Authorization, X-Clinic-ID                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Extract QR Code Data                                        │
│     - Parse QR code string                                       │
│     - Extract location identifier                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Get Location by QR Code                                     │
│     CheckInLocationService.getLocationByQRCode(qrCode)           │
│     - Validate QR code exists                                    │
│     - Check location is active                                   │
│     - Return location details                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Find User's Appointments for Location                       │
│     (NEW METHOD TO BE IMPLEMENTED)                               │
│     - Query appointments by userId + locationId                  │
│     - Filter by status: CONFIRMED, SCHEDULED                     │
│     - Filter by date: today or upcoming                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Validate Appointment                                        │
│     - Appointment exists                                         │
│     - Appointment is for today/upcoming                         │
│     - Appointment status is CONFIRMED/SCHEDULED                 │
│     - Appointment location matches QR location                   │
│     - Not already checked in                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Process Check-In                                            │
│     CheckInService.processCheckIn(appointmentId, clinicId)        │
│     - Create check-in record                                     │
│     - Update appointment status to CHECKED_IN                    │
│     - Set checkedInAt timestamp                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Add to Doctor Queue                                          │
│     AppointmentQueueService.addToQueue()                        │
│     - Add appointment to doctor's queue                          │
│     - Calculate queue position                                   │
│     - Calculate estimated wait time                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. Return Response                                              │
│     {                                                            │
│       success: true,                                             │
│       appointmentId: "...",                                     │
│       checkInAt: "...",                                         │
│       queuePosition: 3,                                         │
│       estimatedWaitTime: 15,                                    │
│       message: "Checked in successfully"                        │
│     }                                                            │
└─────────────────────────────────────────────────────────────────┘
```

## 📝 API Endpoints

### 1. Scan Location QR Code (To Be Implemented)

**Endpoint**: `POST /appointments/check-in/scan-qr`

**Description**: Scans a location QR code and automatically checks in the patient if they have a valid appointment.

**Request**:
```json
{
  "qrCode": "CHK-clinic123-loc456-1234567890-abc123"
}
```

**Response** (Success):
```json
{
  "success": true,
  "data": {
    "appointmentId": "appt-uuid",
    "locationId": "loc-uuid",
    "locationName": "Main Clinic Reception",
    "checkedInAt": "2024-01-15T10:30:00Z",
    "queuePosition": 3,
    "totalInQueue": 8,
    "estimatedWaitTime": 15,
    "doctorId": "doc-uuid",
    "doctorName": "Dr. John Smith"
  },
  "message": "Checked in successfully"
}
```

**Response** (Error - No Appointment):
```json
{
  "success": false,
  "error": {
    "code": "NO_APPOINTMENT_FOUND",
    "message": "No appointment found for this location",
    "details": {
      "locationId": "loc-uuid",
      "locationName": "Main Clinic Reception"
    }
  }
}
```

**Response** (Error - Already Checked In):
```json
{
  "success": false,
  "error": {
    "code": "ALREADY_CHECKED_IN",
    "message": "Appointment already checked in",
    "details": {
      "appointmentId": "appt-uuid",
      "checkedInAt": "2024-01-15T10:25:00Z"
    }
  }
}
```

**Response** (Error - Wrong Location):
```json
{
  "success": false,
  "error": {
    "code": "WRONG_LOCATION",
    "message": "Appointment is not scheduled for this location",
    "details": {
      "appointmentLocationId": "loc-other-uuid",
      "scannedLocationId": "loc-uuid"
    }
  }
}
```

**Authentication**: Required (JWT Bearer Token)
**Authorization**: Patient role or higher
**Rate Limiting**: 10 requests per minute per user

---

### 2. Generate Location QR Code (To Be Implemented)

**Endpoint**: `GET /appointments/locations/:locationId/qr-code`

**Description**: Generates a static QR code image for a check-in location.

**Parameters**:
- `locationId` (path, required): UUID of the location

**Query Parameters**:
- `format` (optional): `png` | `svg` | `base64` (default: `png`)
- `size` (optional): Size in pixels (default: `300`)

**Response** (PNG):
```
Content-Type: image/png
[Binary QR Code Image]
```

**Response** (Base64):
```json
{
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "locationId": "loc-uuid",
  "locationName": "Main Clinic Reception",
  "qrCodeString": "CHK-clinic123-loc456-1234567890-abc123"
}
```

**Authentication**: Required (JWT Bearer Token)
**Authorization**: Clinic Admin, Doctor, or Receptionist

---

### 3. Get Check-In Locations

**Endpoint**: `GET /appointments/check-in/locations`

**Description**: Gets all active check-in locations for a clinic.

**Query Parameters**:
- `isActive` (optional): Filter by active status (default: `true`)

**Response**:
```json
{
  "success": true,
  "data": {
    "locations": [
      {
        "id": "loc-uuid",
        "clinicId": "clinic-uuid",
        "locationName": "Main Clinic Reception",
        "qrCode": "CHK-clinic123-loc456-1234567890-abc123",
        "coordinates": {
          "lat": 19.0760,
          "lng": 72.8777
        },
        "radius": 50,
        "isActive": true,
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ],
    "total": 1
  }
}
```

---

### 4. Create Check-In Location

**Endpoint**: `POST /appointments/check-in/locations`

**Description**: Creates a new check-in location with a QR code.

**Request**:
```json
{
  "clinicId": "clinic-uuid",
  "locationName": "Main Clinic Reception",
  "coordinates": {
    "lat": 19.0760,
    "lng": 72.8777
  },
  "radius": 50
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": "loc-uuid",
    "clinicId": "clinic-uuid",
    "locationName": "Main Clinic Reception",
    "qrCode": "CHK-clinic123-loc456-1234567890-abc123",
    "coordinates": {
      "lat": 19.0760,
      "lng": 72.8777
    },
    "radius": 50,
    "isActive": true
  }
}
```

**Authentication**: Required (JWT Bearer Token)
**Authorization**: Clinic Admin only

---

## 🔧 Implementation Details

### Database Schema

```prisma
model CheckInLocation {
  id          String   @id @default(uuid())
  clinicId    String
  locationName String
  qrCode      String   @unique
  coordinates Json     // { lat: number, lng: number }
  radius      Int      @default(50) // meters
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  checkIns    CheckIn[]
  
  @@index([qrCode])
  @@index([clinicId])
}

model CheckIn {
  id            String   @id @default(uuid())
  appointmentId String
  locationId    String
  patientId     String
  checkedInAt   DateTime @default(now())
  coordinates   Json?    // Patient's location when checked in
  deviceInfo    Json?    // Device information
  isVerified    Boolean  @default(false)
  verifiedBy    String?
  notes         String?
  
  location      CheckInLocation @relation(fields: [locationId], references: [id])
  appointment   Appointment     @relation(fields: [appointmentId], references: [id])
  
  @@index([appointmentId])
  @@index([locationId])
  @@index([patientId])
}
```

### QR Code Format

The QR code contains a unique identifier string:
```
CHK-{clinicIdPrefix}-{locationHash}-{timestamp}-{random}
```

Example:
```
CHK-clinic123-loc456-1705315200000-abc123def456
```

### Validation Rules

1. **QR Code Validation**:
   - QR code must exist in database
   - Location must be active
   - QR code format must be valid

2. **Appointment Validation**:
   - User must have an appointment for the location
   - Appointment status must be `CONFIRMED` or `SCHEDULED`
   - Appointment date must be today or in the future
   - Appointment must not be already checked in
   - Appointment location must match QR location

3. **Time Validation**:
   - Check-in allowed up to 30 minutes before appointment time
   - Check-in allowed up to 2 hours after appointment time
   - Outside this window, check-in requires staff override

## 🚀 Usage Examples

### Frontend Integration

```typescript
// React/Next.js Example
import { useState } from 'react';

function QRCheckIn() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);

  const handleQRScan = async (qrCode: string) => {
    try {
      const response = await fetch('/api/appointments/check-in/scan-qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Clinic-ID': clinicId,
        },
        body: JSON.stringify({ qrCode }),
      });

      const data = await response.json();
      
      if (data.success) {
        setResult({
          message: 'Checked in successfully!',
          queuePosition: data.data.queuePosition,
          estimatedWaitTime: data.data.estimatedWaitTime,
        });
      } else {
        setResult({
          error: data.error.message,
        });
      }
    } catch (error) {
      setResult({
        error: 'Failed to check in. Please try again.',
      });
    }
  };

  return (
    <div>
      <QRScanner onScan={handleQRScan} />
      {result && (
        <div>
          {result.error ? (
            <p className="error">{result.error}</p>
          ) : (
            <div>
              <p>{result.message}</p>
              <p>Queue Position: {result.queuePosition}</p>
              <p>Estimated Wait: {result.estimatedWaitTime} minutes</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Mobile App Integration (React Native)

```typescript
import { Camera } from 'expo-camera';
import { BarCodeScanner } from 'expo-barcode-scanner';

function QRCheckInScreen() {
  const [hasPermission, setHasPermission] = useState(null);
  const [scanned, setScanned] = useState(false);

  const handleBarCodeScanned = async ({ data: qrCode }) => {
    if (scanned) return;
    setScanned(true);

    try {
      const response = await api.post('/appointments/check-in/scan-qr', {
        qrCode,
      });

      if (response.data.success) {
        Alert.alert(
          'Check-In Successful',
          `You are #${response.data.data.queuePosition} in queue. Estimated wait: ${response.data.data.estimatedWaitTime} minutes.`
        );
      }
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error?.message || 'Check-in failed');
    } finally {
      setScanned(false);
    }
  };

  return (
    <Camera
      style={StyleSheet.absoluteFillObject}
      onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
    >
      <View style={styles.overlay}>
        <Text>Scan QR Code</Text>
      </View>
    </Camera>
  );
}
```

## 🔒 Security Considerations

1. **QR Code Security**:
   - QR codes are unique per location
   - QR codes cannot be reused after location deactivation
   - QR code format includes timestamp and random component

2. **Authentication**:
   - All endpoints require JWT authentication
   - User context extracted from JWT token
   - RBAC checks for location management endpoints

3. **Rate Limiting**:
   - QR scan endpoint: 10 requests per minute per user
   - Prevents abuse and brute force attempts

4. **Validation**:
   - Multiple validation layers (QR format, location, appointment)
   - Prevents unauthorized check-ins
   - Prevents duplicate check-ins

5. **Audit Logging**:
   - All check-in events are logged
   - Includes user ID, location ID, timestamp, device info
   - HIPAA-compliant audit trail

## 📊 Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `NO_APPOINTMENT_FOUND` | User has no appointment for this location | 404 |
| `ALREADY_CHECKED_IN` | Appointment already checked in | 400 |
| `WRONG_LOCATION` | Appointment is for a different location | 400 |
| `APPOINTMENT_EXPIRED` | Appointment date has passed | 400 |
| `APPOINTMENT_NOT_CONFIRMED` | Appointment not in valid status | 400 |
| `INVALID_QR_CODE` | QR code format is invalid | 400 |
| `LOCATION_INACTIVE` | Check-in location is not active | 400 |
| `RATE_LIMIT_EXCEEDED` | Too many scan attempts | 429 |

## 🧪 Testing

### Unit Tests

```typescript
describe('Location QR Check-In', () => {
  it('should check in patient when valid QR code scanned', async () => {
    const qrCode = 'CHK-clinic123-loc456-1234567890-abc123';
    const userId = 'user-uuid';
    
    const result = await service.scanLocationQRAndCheckIn(qrCode, userId, clinicId);
    
    expect(result.success).toBe(true);
    expect(result.data.queuePosition).toBeGreaterThan(0);
  });

  it('should reject check-in when no appointment found', async () => {
    const qrCode = 'CHK-clinic123-loc456-1234567890-abc123';
    const userId = 'user-without-appointment';
    
    await expect(
      service.scanLocationQRAndCheckIn(qrCode, userId, clinicId)
    ).rejects.toThrow('NO_APPOINTMENT_FOUND');
  });
});
```

### Integration Tests

```typescript
describe('POST /appointments/check-in/scan-qr', () => {
  it('should return 200 with check-in result', async () => {
    const response = await request(app)
      .post('/appointments/check-in/scan-qr')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Clinic-ID', clinicId)
      .send({ qrCode: validQRCode })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('queuePosition');
  });
});
```

## 📚 Related Documentation

- [Appointment Service Documentation](../services/appointments/README.md)
- [Queue Management Documentation](./QUEUE_MANAGEMENT.md)
- [Check-In Service Documentation](../services/appointments/plugins/checkin/README.md)
- [QR Code Service Documentation](../../src/libs/utils/QR/README.md)

## 🔄 Future Enhancements

1. **Geofencing**: Automatic check-in when patient enters location radius
2. **Multi-Appointment Support**: Handle multiple appointments at same location
3. **Queue Notifications**: Push notifications when queue position changes
4. **Analytics Dashboard**: Track check-in patterns and wait times
5. **Offline Support**: Queue check-in requests when offline, sync when online
6. **Biometric Verification**: Optional fingerprint/face recognition
7. **Staff Override**: Allow staff to manually check in patients

## 📞 Support

For questions or issues related to location QR check-in:
- Create an issue in the repository
- Contact the development team
- Check the [FAQ](./FAQ.md)

---

**Last Updated**: 2024-01-15
**Version**: 1.0.0
**Status**: 🟡 Partially Implemented (Core services ready, endpoints pending)

