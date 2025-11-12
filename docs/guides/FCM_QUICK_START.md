# 🚀 FCM Quick Start Checklist

## Quick Reference for Firebase Cloud Messaging Integration

---

## ✅ Step-by-Step Checklist

### 1. Firebase Console Setup
- [ ] Go to [Firebase Console](https://console.firebase.google.com/)
- [ ] Create new project or select existing
- [ ] Wait for project creation

### 2. Get Credentials
- [ ] Go to **Project Settings** → **Service Accounts**
- [ ] Click **"Generate new private key"**
- [ ] Download JSON file
- [ ] Extract these values:
  - [ ] `project_id` → `FIREBASE_PROJECT_ID`
  - [ ] `private_key` → `FIREBASE_PRIVATE_KEY`
  - [ ] `client_email` → `FIREBASE_CLIENT_EMAIL`

### 3. Environment Variables
- [ ] Add to `.env` file:
  ```bash
  FIREBASE_PROJECT_ID=your-project-id
  FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
  FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
  ```
- [ ] Verify private key includes `\n` characters
- [ ] Use double quotes for private key

### 4. Mobile App Setup (iOS)
- [ ] Add iOS app in Firebase Console
- [ ] Download `GoogleService-Info.plist`
- [ ] Add to Xcode project
- [ ] Install Firebase SDK: `pod 'Firebase/Messaging'`
- [ ] Upload APNs certificate/key to Firebase
- [ ] Request notification permissions in app
- [ ] Get FCM token from app

### 5. Mobile App Setup (Android)
- [ ] Add Android app in Firebase Console
- [ ] Download `google-services.json`
- [ ] Place in `android/app/` directory
- [ ] Add Firebase SDK to `build.gradle`
- [ ] Request notification permissions in app
- [ ] Get FCM token from app

### 6. Test Integration
- [ ] Start backend server: `npm run start:dev`
- [ ] Check logs for: `Firebase push notification service initialized successfully`
- [ ] Get device token from mobile app
- [ ] Send test notification via API
- [ ] Verify notification received on device

### 7. Verify Health
- [ ] Check health endpoint: `GET /api/notifications/health`
- [ ] Should show: `"firebase": true`
- [ ] Test notification delivery
- [ ] Check logs for success messages

### 8. HIPAA Compliance (if sending PHI)
- [ ] Sign Google Cloud BAA
- [ ] Verify data encryption
- [ ] Ensure no PHI in notification payloads
- [ ] Use encrypted deep links

---

## 🔑 Environment Variables Template

```bash
# Copy this to your .env file and fill in values

# Firebase Cloud Messaging
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=""
FIREBASE_CLIENT_EMAIL=
```

---

## 📱 Device Token Collection

**iOS**:
```swift
Messaging.messaging().token { token, error in
    if let token = token {
        // Send token to backend: POST /api/device-tokens
        print("FCM Token: \(token)")
    }
}
```

**Android**:
```kotlin
FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
    val token = task.result
    // Send token to backend: POST /api/device-tokens
    Log.d(TAG, "FCM Token: $token")
}
```

---

## 🧪 Test Notification

**cURL**:
```bash
curl -X POST http://localhost:8088/api/notifications/push \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "deviceToken": "YOUR_DEVICE_TOKEN",
    "title": "Test",
    "body": "Test notification"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "messageId": "projects/xxx/messages/0:xxx",
  "provider": "fcm"
}
```

---

## 🐛 Common Issues

| Issue | Solution |
|-------|----------|
| "Firebase credentials not provided" | Check `.env` file, restart server |
| "Invalid registration token" | Get new token from mobile app |
| Notifications not received | Check permissions, verify APNs setup (iOS) |
| Private key error | Ensure `\n` characters are included |

---

## 📞 Quick Links

- [Firebase Console](https://console.firebase.google.com/)
- [Full Integration Guide](./FCM_INTEGRATION_GUIDE.md)
- [Firebase Documentation](https://firebase.google.com/docs/cloud-messaging)

---

**Need Help?** See the full guide: `docs/guides/FCM_INTEGRATION_GUIDE.md`

