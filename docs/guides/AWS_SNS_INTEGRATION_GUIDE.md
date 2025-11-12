# 📱 AWS SNS (Simple Notification Service) Integration Guide

## Step-by-Step Integration for Push Notifications Backup

This guide will walk you through integrating AWS SNS as the backup push notification provider for your healthcare application. SNS serves as a HIPAA-compliant fallback when FCM fails.

---

## 📋 Prerequisites

- AWS account
- AWS IAM user with SNS permissions
- iOS app with APNs certificate/key
- Android app with FCM server key
- Node.js backend (already set up)

---

## 🚀 Step 1: Create AWS Account & IAM User

### 1.1 Create AWS Account
1. Go to [AWS Console](https://console.aws.amazon.com/)
2. Sign up or sign in to your AWS account
3. Complete account verification if required

### 1.2 Create IAM User for SNS
1. Go to **IAM** → **Users** → **Add users**
2. Enter username: `healthcare-sns-user`
3. Select **"Programmatic access"**
4. Click **"Next: Permissions"**

### 1.3 Attach SNS Permissions
1. Click **"Attach existing policies directly"**
2. Search for and select:
   - `AmazonSNSFullAccess` (or create custom policy with minimal permissions)
3. Click **"Next: Tags"** (optional)
4. Click **"Next: Review"**
5. Click **"Create user"**

### 1.4 Save Access Keys
1. **IMPORTANT**: Copy the **Access Key ID** and **Secret Access Key**
2. Save them securely (you won't be able to see the secret key again)
3. These will be your `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

---

## 🔑 Step 2: Configure AWS SNS for Push Notifications

### 2.1 Choose AWS Region
1. Select your preferred AWS region (e.g., `us-east-1`, `us-west-2`, `eu-west-1`)
2. Note: Use the same region for all SNS resources
3. This will be your `AWS_REGION`

### 2.2 Create iOS Platform Application

#### 2.2.1 Prepare APNs Certificate/Key
You need one of these:
- **APNs Certificate** (`.p12` file) - Traditional method
- **APNs Authentication Key** (`.p8` file) - Recommended, easier to manage

**Option A: APNs Authentication Key (Recommended)**
1. Go to [Apple Developer Portal](https://developer.apple.com/account/)
2. Navigate to **Certificates, Identifiers & Profiles** → **Keys**
3. Click **"+"** to create a new key
4. Enable **"Apple Push Notifications service (APNs)"**
5. Click **"Continue"** → **"Register"**
6. Download the `.p8` key file
7. Note the **Key ID** and **Team ID**

**Option B: APNs Certificate**
1. Create APNs certificate in Apple Developer Portal
2. Export as `.p12` file with password

#### 2.2.2 Create iOS Platform Application in SNS
1. Go to **SNS** → **Mobile** → **Push notifications**
2. Click **"Create platform application"**
3. Enter:
   - **Name**: `healthcare-ios-app`
   - **Platform**: Select **"Apple iOS"**
   - **Push notification platform**: Select **"Apple iOS"**
4. Upload credentials:
   - **Option A (APNs Key)**: Upload `.p8` file, enter Key ID and Team ID
   - **Option B (Certificate)**: Upload `.p12` file, enter password
5. Click **"Create platform application"**
6. **Copy the Platform Application ARN** (e.g., `arn:aws:sns:us-east-1:123456789012:app/APNS/healthcare-ios-app`)
   - This is your `AWS_SNS_IOS_PLATFORM_ARN`

### 2.3 Create Android Platform Application

#### 2.3.1 Get FCM Server Key
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your Firebase project
3. Go to **Project Settings** → **Cloud Messaging**
4. Under **"Cloud Messaging API (Legacy)"**, copy the **Server key**
   - This is your FCM server key for SNS

#### 2.3.2 Create Android Platform Application in SNS
1. Go to **SNS** → **Mobile** → **Push notifications**
2. Click **"Create platform application"**
3. Enter:
   - **Name**: `healthcare-android-app`
   - **Platform**: Select **"Google Cloud Messaging (GCM)"**
   - **API key**: Paste your FCM Server Key
4. Click **"Create platform application"**
5. **Copy the Platform Application ARN** (e.g., `arn:aws:sns:us-east-1:123456789012:app/GCM/healthcare-android-app`)
   - This is your `AWS_SNS_ANDROID_PLATFORM_ARN`

---

## ⚙️ Step 3: Configure Environment Variables

### 3.1 Add to `.env` File

Add these environment variables:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key

# AWS SNS Platform Application ARNs
AWS_SNS_IOS_PLATFORM_ARN=arn:aws:sns:us-east-1:123456789012:app/APNS/healthcare-ios-app
AWS_SNS_ANDROID_PLATFORM_ARN=arn:aws:sns:us-east-1:123456789012:app/GCM/healthcare-android-app
```

### 3.2 Important Notes

- **AWS_REGION**: Must match the region where you created platform applications
- **AWS_ACCESS_KEY_ID**: From Step 1.4
- **AWS_SECRET_ACCESS_KEY**: From Step 1.4 (keep secure!)
- **Platform ARNs**: Copy exactly from SNS console

---

## 🏥 Step 4: HIPAA Compliance Setup

### 4.1 Sign Business Associate Agreement (BAA)

**Required for HIPAA compliance**:

1. Go to [AWS Artifact](https://console.aws.amazon.com/artifact/)
2. Navigate to **"Agreements"**
3. Request **"AWS Business Associate Addendum (BAA)"**
4. Review and accept the BAA
5. This enables HIPAA-eligible services including SNS

### 4.2 Verify HIPAA Eligibility

1. Go to **SNS** → **Mobile** → **Push notifications**
2. Your platform applications should show as HIPAA-eligible
3. Ensure you're using HIPAA-eligible regions:
   - `us-east-1` (N. Virginia)
   - `us-west-2` (Oregon)
   - `us-gov-west-1` (GovCloud)

---

## 🧪 Step 5: Test the Integration

### 5.1 Check Service Initialization

1. Start your backend server:
   ```bash
   npm run start:dev
   ```

2. Check logs for SNS initialization:
   ```
   [INFO] AWS SNS backup service initialized successfully
   ```

3. If you see a warning:
   ```
   [WARN] AWS credentials not provided, SNS backup service will be disabled
   ```
   → Check your environment variables

### 5.2 Test Push Notification

**Using Swagger UI**:
1. Go to `http://localhost:8088/api/docs`
2. Navigate to **Notification** endpoints
3. Send a push notification
4. If FCM fails, SNS will automatically be used as backup

**Using cURL**:
```bash
curl -X POST http://localhost:8088/api/notifications/push \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "deviceToken": "YOUR_DEVICE_TOKEN",
    "title": "Test Notification",
    "body": "Testing SNS backup"
  }'
```

### 5.3 Verify Fallback Behavior

1. **Temporarily disable FCM** (for testing):
   - Remove FCM credentials from `.env`
   - Restart server
   - Send notification
   - Should automatically use SNS

2. **Check logs**:
   ```
   [WARN] FCM push notification failed, attempting SNS backup
   [INFO] Push notification sent successfully via SNS backup
   ```

---

## 📱 Step 6: Platform-Specific Setup

### 6.1 iOS Setup

**Device Token Format**:
- iOS uses APNs device tokens
- Tokens are typically 64 characters
- Tokens can change (app reinstall, OS update)

**SNS Endpoint Creation**:
- SNS automatically creates platform endpoints
- Each device token gets a unique endpoint ARN
- Endpoints are managed automatically

### 6.2 Android Setup

**Device Token Format**:
- Android uses FCM registration tokens
- Tokens are typically 152+ characters
- Tokens can change (app reinstall, app data cleared)

**SNS Endpoint Creation**:
- SNS uses FCM server key to create endpoints
- Endpoints are created automatically
- No manual endpoint management needed

---

## 🔍 Step 7: Verify Integration

### 7.1 Check Health Endpoint

```bash
curl http://localhost:8088/api/notifications/health
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

### 7.2 Monitor SNS Usage

1. Go to **AWS SNS Console** → **Metrics**
2. View:
   - Number of messages published
   - Delivery success rate
   - Platform-specific metrics

### 7.3 Check Logs

After sending a notification, check logs for:
- ✅ `AWS SNS backup service initialized successfully`
- ✅ `SNS push notification sent successfully` (if used as backup)
- ✅ `messageId` from SNS response

---

## 💰 Step 8: Cost Management

### 8.1 SNS Pricing

- **Push notifications**: $0.50 per million requests
- **Platform endpoints**: $0.50 per million requests
- **Data transfer**: $0.09 per GB

### 8.2 Cost Optimization

Since SNS is used as **backup only**:
- Most notifications go through FCM (free)
- SNS only charges for actual usage
- Typical cost: Very low (only on FCM failures)

**Example**:
- 1M notifications/month
- 1% failure rate = 10,000 notifications via SNS
- Cost: ~$0.005/month (negligible)

### 8.3 Set Up Billing Alerts

1. Go to **AWS Billing** → **Budgets**
2. Create budget for SNS costs
3. Set alert threshold (e.g., $10/month)
4. Get notified if costs exceed threshold

---

## 🐛 Troubleshooting

### Issue: "AWS credentials not provided"

**Solution**:
1. Check `.env` file has all AWS variables
2. Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are correct
3. Restart server after changing `.env`

### Issue: "Platform application ARN not configured"

**Solution**:
1. Verify `AWS_SNS_IOS_PLATFORM_ARN` and `AWS_SNS_ANDROID_PLATFORM_ARN` are set
2. Check ARNs are correct (copy from SNS console)
3. Ensure ARNs match the AWS region

### Issue: "Invalid platform endpoint"

**Solution**:
1. Verify device token is valid
2. Check platform (iOS/Android) matches the token
3. Ensure platform application is properly configured

### Issue: "APNs certificate/key invalid"

**Solution**:
1. Verify APNs certificate/key is not expired
2. Check Key ID and Team ID are correct
3. Ensure certificate/key has push notification permissions

### Issue: "FCM server key invalid"

**Solution**:
1. Verify FCM server key is correct
2. Check key is from the correct Firebase project
3. Ensure key has proper permissions

---

## 📊 Step 9: Monitor and Optimize

### 9.1 CloudWatch Metrics

Monitor SNS metrics in CloudWatch:
- `NumberOfMessagesPublished`
- `NumberOfNotificationsDelivered`
- `NumberOfNotificationsFailed`
- `PublishSize`

### 9.2 Set Up Alarms

1. Go to **CloudWatch** → **Alarms**
2. Create alarms for:
   - High failure rates
   - Unusual activity
   - Cost thresholds

### 9.3 Review Delivery Reports

1. Go to **SNS** → **Mobile** → **Push notifications**
2. View delivery reports for each platform
3. Identify patterns in failures
4. Optimize notification content

---

## ✅ Integration Checklist

- [ ] AWS account created
- [ ] IAM user created with SNS permissions
- [ ] Access keys saved securely
- [ ] iOS platform application created
- [ ] Android platform application created
- [ ] Platform ARNs copied
- [ ] Environment variables configured
- [ ] BAA signed (for HIPAA compliance)
- [ ] Service initialized successfully
- [ ] Test notification sent
- [ ] Fallback behavior verified
- [ ] Health endpoint shows SNS as healthy
- [ ] Monitoring set up

---

## 🎯 Next Steps

1. **Production Deployment**:
   - Use separate AWS accounts for dev/staging/prod
   - Set up proper IAM roles (not users) for production
   - Configure CloudWatch alarms

2. **Advanced Features**:
   - Topic-based subscriptions
   - Message attributes
   - Delivery status tracking
   - Dead letter queues

3. **Security**:
   - Rotate access keys regularly
   - Use IAM roles instead of access keys (for EC2/ECS)
   - Enable MFA for AWS account
   - Set up CloudTrail for audit logging

---

## 📚 Additional Resources

- [AWS SNS Documentation](https://docs.aws.amazon.com/sns/)
- [SNS Mobile Push Notifications](https://docs.aws.amazon.com/sns/latest/dg/sns-mobile-application-as-subscriber.html)
- [HIPAA Compliance with AWS](https://aws.amazon.com/compliance/hipaa-compliance/)
- [SNS Pricing](https://aws.amazon.com/sns/pricing/)

---

## 🆘 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review AWS CloudWatch logs
3. Check backend application logs
4. Verify environment variables are set correctly
5. Ensure platform applications are properly configured

---

**Last Updated**: January 2025

