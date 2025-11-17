# 🚀 AWS SNS & SES Quick Start Checklist

## Quick Reference for AWS Integration

---

## ✅ AWS SNS (Push Notifications) Checklist

### 1. AWS Setup
- [ ] AWS account created
- [ ] IAM user created: `healthcare-sns-user`
- [ ] Permissions: `AmazonSNSFullAccess`
- [ ] Access keys saved:
  - [ ] `AWS_ACCESS_KEY_ID`
  - [ ] `AWS_SECRET_ACCESS_KEY`
- [ ] AWS region selected: `us-east-1` (or your preference)

### 2. iOS Platform Application
- [ ] APNs certificate/key prepared
- [ ] Platform application created in SNS
- [ ] iOS Platform ARN copied: `AWS_SNS_IOS_PLATFORM_ARN`

### 3. Android Platform Application
- [ ] FCM server key obtained from Firebase
- [ ] Platform application created in SNS
- [ ] Android Platform ARN copied: `AWS_SNS_ANDROID_PLATFORM_ARN`

### 4. Environment Variables
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_SNS_IOS_PLATFORM_ARN=arn:aws:sns:us-east-1:xxx:app/APNS/xxx
AWS_SNS_ANDROID_PLATFORM_ARN=arn:aws:sns:us-east-1:xxx:app/GCM/xxx
```

### 5. HIPAA Compliance
- [ ] BAA signed in AWS Artifact
- [ ] Using HIPAA-eligible region

### 6. Test
- [ ] Server restarted
- [ ] Logs show: `AWS SNS backup service initialized successfully`
- [ ] Health endpoint shows: `"sns": true`
- [ ] Test notification sent (via FCM failure)

---

## ✅ AWS SES (Email) Checklist

### 1. AWS Setup
- [ ] AWS account created (same as SNS)
- [ ] IAM user created: `healthcare-ses-user`
- [ ] Permissions: `AmazonSESFullAccess`
- [ ] Access keys saved:
  - [ ] `AWS_ACCESS_KEY_ID`
  - [ ] `AWS_SECRET_ACCESS_KEY`
- [ ] AWS region selected: `us-east-1` (or your preference)

### 2. Email Verification (Development)
- [ ] Email address verified in SES
- [ ] Verification email received and clicked

### 3. Domain Verification (Production)
- [ ] Domain added to SES
- [ ] SPF record added to DNS
- [ ] DKIM records added to DNS
- [ ] DMARC record added to DNS (optional)
- [ ] Domain verified in SES

### 4. Production Access
- [ ] Production access requested
- [ ] Request approved by AWS

### 5. Environment Variables
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_SES_FROM_EMAIL=noreply@healthcare.com
AWS_SES_FROM_NAME=Healthcare App
EMAIL_PROVIDER=ses
```

### 6. HIPAA Compliance
- [ ] BAA signed in AWS Artifact
- [ ] Using HIPAA-eligible region

### 7. Test
- [ ] Server restarted
- [ ] Logs show: `AWS SES email service initialized successfully`
- [ ] Test email sent
- [ ] Email received in inbox

---

## 🔑 Environment Variables Template

```bash
# AWS Configuration (Shared)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# AWS SNS (Push Notifications Backup)
AWS_SNS_IOS_PLATFORM_ARN=
AWS_SNS_ANDROID_PLATFORM_ARN=

# AWS SES (Email)
AWS_SES_FROM_EMAIL=
AWS_SES_FROM_NAME=
EMAIL_PROVIDER=ses
```

---

## 📱 SNS Platform ARN Format

**iOS**:
```
arn:aws:sns:REGION:ACCOUNT_ID:app/APNS/APPLICATION_NAME
```

**Android**:
```
arn:aws:sns:REGION:ACCOUNT_ID:app/GCM/APPLICATION_NAME
```

---

## 🧪 Quick Test Commands

### Test SNS (via Push Notification)
```bash
curl -X POST http://localhost:8088/api/notifications/push \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "deviceToken": "YOUR_DEVICE_TOKEN",
    "title": "Test",
    "body": "Testing SNS backup"
  }'
```

### Test SES (via Email)
```bash
curl -X POST http://localhost:8088/api/email/test-custom \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "template": "WELCOME"
  }'
```

### Check Health
```bash
curl http://localhost:8088/api/notifications/health
```

Expected:
```json
{
  "healthy": true,
  "services": {
    "firebase": true,
    "sns": true
  }
}
```

---

## 🐛 Common Issues

| Issue | Solution |
|-------|----------|
| "AWS credentials not provided" | Check `.env` file, restart server |
| "Platform ARN not configured" | Copy ARN from SNS console |
| "Email not verified" | Verify email/domain in SES console |
| "Account in sandbox" | Request production access |
| "Sending quota exceeded" | Request quota increase |

---

## 📞 Quick Links

- [AWS Console](https://console.aws.amazon.com/)
- [SNS Console](https://console.aws.amazon.com/sns/)
- [SES Console](https://console.aws.amazon.com/ses/)
- [AWS Artifact (BAA)](https://console.aws.amazon.com/artifact/)
- [Full SNS Guide](./AWS_SNS_INTEGRATION_GUIDE.md)
- [Full SES Guide](./AWS_SES_INTEGRATION_GUIDE.md)

---

## 💡 Tips

1. **Use same AWS account** for SNS and SES (simpler management)
2. **Use same region** for all AWS services (lower latency)
3. **Save access keys securely** (use password manager)
4. **Set up billing alerts** (avoid surprises)
5. **Monitor CloudWatch** (track usage and errors)

---

**Need Help?** See the full guides:
- `docs/guides/AWS_SNS_INTEGRATION_GUIDE.md`
- `docs/guides/AWS_SES_INTEGRATION_GUIDE.md`


