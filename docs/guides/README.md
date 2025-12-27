# 📚 Communication System Guides

> **Essential guides for the Healthcare Backend communication system**

## 🎯 Quick Start

**Primary Email Provider:** ✅ **ZeptoMail** (Configured)

## 📖 Essential Guides

### ⭐ Main Guide

1. **[Communication System Complete Guide](./COMMUNICATION_SYSTEM_COMPLETE_GUIDE.md)**
   - **START HERE** - Complete overview
   - ZeptoMail setup (Primary)
   - All providers and features
   - Testing & troubleshooting
   - Quick reference

### 📧 Provider Setup

2. **[AWS SES Complete Guide](./AWS_SES_COMPLETE_GUIDE.md)**
   - AWS SES setup (Fallback provider)
   - Multi-tenant configuration
   - SNS topic setup
   - HIPAA compliance

3. **[FCM Integration Guide](./FCM_INTEGRATION_GUIDE.md)**
   - Firebase Cloud Messaging setup
   - Push notifications
   - iOS/Android/Web configuration

### 💾 Infrastructure

4. **[Storage Configuration](./STORAGE_CONFIGURATION.md)**
   - Contabo S3 setup
   - Local storage fallback
   - Kubernetes configuration

---

## 🚀 Quick Setup

### 1. Configure ZeptoMail (Primary)

```bash
PUT /api/v1/clinics/{clinicId}/communication/config
{
  "email": {
    "primary": {
      "provider": "zeptomail",
      "credentials": {
        "sendMailToken": "your_token",
        "fromEmail": "noreply@clinic.com"
      }
    }
  }
}
```

### 2. Test Configuration

```bash
POST /api/v1/clinics/{clinicId}/communication/test-email
```

---

## ✅ System Status

- ✅ **ZeptoMail** - Primary Email (Configured)
- ✅ **AWS SES** - Fallback Email
- ✅ **Firebase FCM** - Primary Push
- ✅ **AWS SNS** - Fallback Push

---

**Last Updated:** January 2025  
**Primary Email Provider:** ✅ **ZeptoMail**

