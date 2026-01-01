# 🔥 Firebase Cloud Messaging (FCM) Integration Guide

## Step-by-Step Integration for Healthcare Backend

This guide will walk you through integrating Firebase Cloud Messaging (FCM) as the primary push notification provider for your healthcare application.

---

## 📋 Prerequisites

- Google account
- Firebase project (or create a new one)
- Node.js backend (already set up)
- Mobile app (iOS/Android) for testing

---

## 🚀 Step 1: Create Firebase Project

### 1.1 Go to Firebase Console
1. Visit [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"** or select an existing project
3. Enter project name (e.g., "Healthcare App")
4. Click **"Continue"**

### 1.2 Configure Project
1. **Google Analytics** (Optional but recommended):
   - Enable/disable Google Analytics
   - Select or create Analytics account
   - Click **"Create project"**

2. Wait for project creation (30-60 seconds)
3. Click **"Continue"** when ready

---

## 🔑 Step 2: Get Service Account Credentials

### 2.1 Enable Cloud Messaging API
1. In Firebase Console, go to **Project Settings** (gear icon)
2. Click on **"Cloud Messaging"** tab
3. Note the **Server key** (you'll need this later for SNS if needed)

### 2.2 Generate Service Account Key
1. Go to **Project Settings** → **Service Accounts** tab
2. Click **"Generate new private key"**
3. Click **"Generate key"** in the dialog
4. A JSON file will download (e.g., `healthcare-app-firebase-adminsdk-xxxxx.json`)

**⚠️ IMPORTANT**: Keep this file secure! It contains sensitive credentials.

### 2.3 Extract Credentials from JSON
Open the downloaded JSON file. You'll need these values:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  ...
}
```

**Extract these values:**
- `project_id` → `FIREBASE_PROJECT_ID`
- `private_key` → `FIREBASE_PRIVATE_KEY`
- `client_email` → `FIREBASE_CLIENT_EMAIL`

---

## ⚙️ Step 3: Configure Environment Variables

### 3.1 Add to `.env` File

Add these environment variables to your `.env` file:

```bash
# Firebase Cloud Messaging Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
```

### 3.2 Important Notes for Private Key

**⚠️ CRITICAL**: The `FIREBASE_PRIVATE_KEY` must include:
- The full key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
- All `\n` characters (newlines) must be preserved
- Use double quotes in `.env` file
- The key should be on a single line with `\n` characters

**Example:**
```bash
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
```

### 3.3 Alternative: Use Config Service

If you're using the enhanced ConfigService, you can also add these to your configuration files:

**`src/config/environment/development.config.ts`**:
```typescript
export default {
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  },
};
```

---

## 📱 Step 4: Configure Mobile Apps (iOS/Android)

### 4.1 Add iOS App to Firebase

1. In Firebase Console, click **"Add app"** → Select **iOS**
2. Enter **Bundle ID** (e.g., `com.healthcare.app`)
3. Enter **App nickname** (optional)
4. Enter **App Store ID** (optional)
5. Click **"Register app"**

6. **Download `GoogleService-Info.plist`**:
   - Download the configuration file
   - Add it to your iOS project (Xcode)

7. **Add Firebase SDK**:
   ```bash
   # Using CocoaPods
   pod 'Firebase/Messaging'
   ```

8. **Configure APNs**:
   - Go to **Project Settings** → **Cloud Messaging** → **Apple app configuration**
   - Upload your **APNs Authentication Key** (`.p8` file) or **APNs Certificate** (`.p12` file)
   - Enter your **Key ID** and **Team ID**

### 4.2 Add Android App to Firebase

1. In Firebase Console, click **"Add app"** → Select **Android**
2. Enter **Package name** (e.g., `com.healthcare.app`)
3. Enter **App nickname** (optional)
4. Enter **Debug signing certificate SHA-1** (optional, for development)
5. Click **"Register app"**

6. **Download `google-services.json`**:
   - Download the configuration file
   - Place it in `android/app/` directory

7. **Add Firebase SDK**:
   ```gradle
   // android/build.gradle
   dependencies {
       classpath 'com.google.gms:google-services:4.4.0'
   }

   // android/app/build.gradle
   apply plugin: 'com.google.gms.google-services'
   
   dependencies {
       implementation 'com.google.firebase:firebase-messaging:23.3.1'
   }
   ```

---

## 🧪 Step 5: Test the Integration

### 5.1 Check Service Initialization

1. Start your backend server:
   ```bash
   yarn start:dev
   ```

2. Check logs for Firebase initialization:
   ```
   [INFO] Firebase push notification service initialized successfully
   ```

3. If you see a warning:
   ```
   [WARN] Firebase credentials not provided, push notification service will be disabled
   ```
   → Check your environment variables

### 5.2 Test Push Notification via API

**Using Swagger UI** (if available):
1. Go to `http://localhost:8088/api/docs`
2. Navigate to **Notification** endpoints
3. Use the **"Send Push Notification"** endpoint

**Using cURL**:
```bash
curl -X POST http://localhost:8088/api/v1/communication/push \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "deviceToken": "YOUR_DEVICE_TOKEN",
    "title": "Test Notification",
    "body": "This is a test push notification",
    "data": {
      "type": "test",
      "id": "123"
    }
  }'
```

### 5.3 Get Device Token from Mobile App

**iOS (Swift)**:
```swift
import FirebaseMessaging

// Request permission
UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
    if granted {
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }
}

// Get FCM token
Messaging.messaging().token { token, error in
    if let error = error {
        print("Error fetching FCM registration token: \(error)")
    } else if let token = token {
        print("FCM registration token: \(token)")
        // Send this token to your backend
    }
}
```

**Android (Kotlin)**:
```kotlin
import com.google.firebase.messaging.FirebaseMessaging

// Get FCM token
FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
    if (!task.isSuccessful) {
        Log.w(TAG, "Fetching FCM registration token failed", task.exception)
        return@addOnCompleteListener
    }

    // Get new FCM registration token
    val token = task.result
    Log.d(TAG, "FCM registration token: $token")
    // Send this token to your backend
}
```

---

## 🔍 Step 6: Verify Integration

### 6.1 Check Health Endpoint

```bash
curl http://localhost:8088/api/v1/communication/health
```

Expected response:
```json
{
  "healthy": true,
  "services": {
    "firebase": true,
    "sns": true
  }
}
```

### 6.2 Check Logs

After sending a test notification, check logs for:
- ✅ `Push notification sent successfully via FCM`
- ✅ `messageId: projects/your-project/messages/0:xxxxx`

If FCM fails, you should see:
- ⚠️ `FCM push notification failed, attempting SNS backup`
- ✅ `Push notification sent successfully via SNS backup`

---

## 🏥 Step 7: HIPAA Compliance Setup

### 7.1 Sign Business Associate Agreement (BAA)

**For HIPAA compliance**, you need to sign a BAA with Google Cloud:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **Billing** → **Account Management**
3. Contact Google Cloud Support to request a **Business Associate Agreement (BAA)**
4. Complete the BAA signing process

**Note**: This is required if you're sending PHI (Protected Health Information) via push notifications.

### 7.2 Configure Data Encryption

Ensure your notification payloads:
- ✅ Don't include PHI in notification body/title
- ✅ Use encrypted deep links to app screens
- ✅ Store sensitive data in secure app storage
- ✅ Use notification IDs that reference secure data

---

## 🐛 Troubleshooting

### Issue: "Firebase credentials not provided"

**Solution**:
1. Check `.env` file has all three variables
2. Verify private key includes `\n` characters
3. Restart the server after changing `.env`

### Issue: "Failed to initialize Firebase"

**Solution**:
1. Verify credentials are correct
2. Check private key format (must include BEGIN/END markers)
3. Ensure service account has proper permissions

### Issue: "Invalid registration token"

**Solution**:
1. Verify device token is correct
2. Check if token is expired (tokens can expire)
3. Re-register device token from mobile app

### Issue: Notifications not received on iOS

**Solution**:
1. Verify APNs certificate/key is uploaded to Firebase
2. Check iOS app has notification permissions
3. Verify `GoogleService-Info.plist` is in the project
4. Check device is not in Do Not Disturb mode

### Issue: Notifications not received on Android

**Solution**:
1. Verify `google-services.json` is in correct location
2. Check Firebase SDK is properly integrated
3. Verify app has notification permissions
4. Check device notification settings

---

## 📊 Step 8: Monitor and Optimize

### 8.1 Monitor Delivery Rates

Check Firebase Console → **Cloud Messaging** → **Reports**:
- Delivery success rate
- Failure reasons
- Platform breakdown (iOS vs Android)

### 8.2 Set Up Alerts

Configure alerts for:
- High failure rates
- Service downtime
- Invalid token errors

### 8.3 Optimize Notification Content

- Keep titles under 50 characters
- Keep body under 200 characters
- Use data payload for deep linking
- Test on both iOS and Android

---

## ✅ Integration Checklist

- [ ] Firebase project created
- [ ] Service account key downloaded
- [ ] Environment variables configured
- [ ] iOS app added to Firebase (if applicable)
- [ ] Android app added to Firebase (if applicable)
- [ ] APNs certificate/key uploaded (iOS)
- [ ] Mobile SDKs integrated
- [ ] Device tokens being collected
- [ ] Test notification sent successfully
- [ ] Health endpoint shows Firebase as healthy
- [ ] BAA signed (if sending PHI)
- [ ] Monitoring set up

---

## 🎯 Next Steps

1. **Production Deployment**:
   - Use environment-specific Firebase projects
   - Set up separate projects for dev/staging/prod
   - Configure proper security rules

2. **Advanced Features**:
   - Topic subscriptions for broadcast notifications
   - Conditional messaging
   - Notification scheduling
   - Rich notifications (images, actions)

3. **Analytics**:
   - Track notification open rates
   - Monitor delivery success rates
   - Analyze user engagement

---

## 📚 Additional Resources

- [Firebase Cloud Messaging Documentation](https://firebase.google.com/docs/cloud-messaging)
- [Firebase Admin SDK for Node.js](https://firebase.google.com/docs/admin/setup)
- [FCM HTTP v1 API](https://firebase.google.com/docs/cloud-messaging/migrate-v1)
- [HIPAA Compliance with Google Cloud](https://cloud.google.com/security/compliance/hipaa)

---

## 🆘 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review Firebase Console logs
3. Check backend application logs
4. Verify environment variables are set correctly

---

**Last Updated**: January 2025

