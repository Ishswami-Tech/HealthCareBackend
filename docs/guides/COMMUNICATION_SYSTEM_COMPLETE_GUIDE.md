# 📧 Communication System - Complete Guide

> **Comprehensive guide for the Healthcare Backend communication system with ZeptoMail as primary email provider**

This guide consolidates all communication-related documentation into a single, comprehensive reference.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Email System](#email-system)
3. [Push Notifications](#push-notifications)
4. [WhatsApp & SMS](#whatsapp--sms)
5. [Robustness Features](#robustness-features)
6. [Configuration](#configuration)
7. [Testing](#testing)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)

---

## 🎯 Overview

### Architecture

The communication system supports:
- **Multi-tenant architecture** - Clinic-specific configurations
- **Provider fallback** - Automatic failover between providers
- **Circuit breakers** - Prevents cascading failures
- **Rate limiting** - Protects against quota exhaustion
- **Health monitoring** - Continuous provider health checks
- **Suppression lists** - Bounce/complaint handling

### Primary Providers

| Channel | Primary Provider | Fallback Providers |
|---------|-----------------|-------------------|
| **Email** | **ZeptoMail** | AWS SES, SMTP |
| **Push** | Firebase Cloud Messaging | AWS SNS |
| **WhatsApp** | Meta Business API | Twilio |
| **SMS** | AWS SNS | Twilio |

---

## 📧 Email System

### Primary Provider: ZeptoMail

**ZeptoMail** is configured as the **primary email provider** by default for all clinics.

#### Why ZeptoMail?

- ✅ **Transactional email optimized** - Designed for transactional emails
- ✅ **High deliverability** - Better inbox placement
- ✅ **Cost-effective** - Competitive pricing
- ✅ **API-first** - RESTful API with better error handling
- ✅ **Built-in tracking** - Open/click tracking via headers
- ✅ **Attachment support** - Up to 15 MB per email

#### ZeptoMail Setup

**1. Get ZeptoMail Credentials:**

1. Log in to [ZeptoMail Console](https://www.zoho.com/zeptomail/)
2. Navigate to **Mail Agents** section
3. Create a new Mail Agent (or use existing)
4. Go to **Setup Info** → **API** tab
5. Generate and copy the **Send Mail Token**

**2. Configure Clinic Email:**

```bash
PUT /api/v1/clinics/{clinicId}/communication/config
Authorization: Bearer <token>

{
  "email": {
    "primary": {
      "provider": "zeptomail",
      "enabled": true,
      "credentials": {
        "sendMailToken": "your_send_mail_token",
        "fromEmail": "noreply@yourdomain.com",
        "fromName": "Your Clinic Name",
        "bounceAddress": "bounces@yourdomain.com"
      },
      "priority": 1
    },
    "fallback": [
      {
        "provider": "aws_ses",
        "enabled": true,
        "credentials": {
          "region": "us-east-1",
          "accessKeyId": "AKIA...",
          "secretAccessKey": "...",
          "fromEmail": "noreply@yourdomain.com",
          "fromName": "Your Clinic Name"
        },
        "priority": 2
      }
    ],
    "defaultFrom": "noreply@yourdomain.com",
    "defaultFromName": "Your Clinic Name"
  }
}
```

**3. Test Configuration:**

```bash
POST /api/v1/clinics/{clinicId}/communication/test-email
Authorization: Bearer <token>

{
  "testEmail": "your-email@example.com"
}
```

#### ZeptoMail API Integration

**Base URL:** `https://api.zeptomail.com/v1.1/email`

**Authentication:** `Zoho-enczapikey <send_mail_token>`

**Request Format:**
```json
{
  "bounce_address": "bounces@yourdomain.com",
  "from": {
    "address": "noreply@yourdomain.com",
    "name": "Your Company"
  },
  "to": [
    {
      "email_address": {
        "address": "recipient@example.com",
        "name": "Recipient Name"
      }
    }
  ],
  "subject": "Subject of the Email",
  "htmlbody": "<p>Your email content here.</p>",
  "textbody": "Plain text version (optional)"
}
```

**Features:**
- Template support
- Attachment management via file cache
- Full control over email headers
- Open/click tracking via `X-TM-OPEN-TRACK` and `X-TM-CLICK-TRACK` headers

**Limitations:**
- Email size limit: **15 MB** (headers + body + attachments)
- Transactional emails only (no bulk/promotional)
- IP restrictions recommended for production

#### Fallback Providers

**AWS SES (Fallback 1):**
- High deliverability
- HIPAA compliant
- Global infrastructure
- See [AWS_SES_COMPLETE_GUIDE.md](./AWS_SES_COMPLETE_GUIDE.md) for setup

**SMTP (Fallback 2):**
- Custom SMTP servers
- Gmail, Outlook, or custom SMTP
- Standard SMTP protocol

**Fallback Flow:**
1. Try ZeptoMail (primary)
2. If unhealthy → Try AWS SES
3. If unhealthy → Try SMTP
4. If all fail → Return error

---

## 🔔 Push Notifications

### Primary Provider: Firebase Cloud Messaging (FCM)

**Firebase Cloud Messaging** is the primary push notification provider.

#### Setup

**1. Firebase Configuration:**

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_VAPID_KEY=your-vapid-key  # For web push
```

**2. API Endpoints:**

```bash
# Register device token
POST /api/v1/communication/push/device-token
{
  "token": "FCM_TOKEN_FROM_BROWSER",
  "platform": "web",
  "userId": "user-123"
}

# Send push notification
POST /api/v1/communication/push
{
  "deviceToken": "FCM_TOKEN",
  "title": "Notification Title",
  "body": "Notification Body",
  "data": {
    "type": "appointment",
    "id": "123"
  }
}
```

#### Fallback: AWS SNS

**AWS SNS** serves as backup when FCM fails.

**Setup:** See [AWS_SNS_INTEGRATION_GUIDE.md](./AWS_SNS_INTEGRATION_GUIDE.md)

**Features:**
- HIPAA compliant
- High reliability
- Automatic failover
- Enterprise SLA

---

## 💬 WhatsApp & SMS

### WhatsApp: Meta Business API

**Primary provider** for WhatsApp messaging.

**Setup:** Configure via clinic communication settings.

### SMS: AWS SNS

**Primary provider** for SMS notifications.

**Use cases:**
- OTP verification
- Critical alerts
- Emergency notifications

---

## 🛡️ Robustness Features

### 1. Circuit Breaker Pattern

**Purpose:** Prevents cascading failures by temporarily stopping requests to failing providers.

**Configuration:**
- **Threshold:** Opens after 5 consecutive failures
- **Recovery:** Attempts recovery after 60 seconds
- **States:** `closed` → `open` → `half-open` → `closed`

**Benefits:**
- Prevents overwhelming failing providers
- Fast failure detection
- Automatic recovery attempts
- Per-provider and per-clinic isolation

### 2. Rate Limiting

**Configuration:**
```typescript
{
  zeptomail: { maxRequests: 1000, windowMs: 60000, burstAllowance: 100 },
  aws_ses: { maxRequests: 1000, windowMs: 60000, burstAllowance: 100 },
  smtp: { maxRequests: 500, windowMs: 60000, burstAllowance: 50 },
}
```

**Features:**
- Per-provider limits
- Per-clinic isolation
- Burst allowance for traffic spikes
- Automatic rate limit detection

### 3. Retry Logic with Exponential Backoff

**Strategy:**
- **Max Retries:** 3 attempts (configurable)
- **Base Delay:** 1 second
- **Exponential Backoff:** `delay = baseDelay * 2^attempt`
- **Rate Limit Handling:** Double delay for rate limit errors
- **Smart Retry:** Only retries retryable errors

**Non-Retryable Errors:**
- 4xx client errors (400, 401, 403, 404)
- Invalid credentials
- Invalid email addresses
- Suppressed emails

### 4. Provider Fallback

**Flow:**
1. Try primary provider (ZeptoMail)
2. Check health status
3. If unhealthy, try fallback providers in order
4. Log fallback usage
5. Return first healthy provider

### 5. Health Monitoring

**Metrics Tracked:**
- Total requests
- Successful requests
- Failed requests
- Consecutive failures
- Average latency
- Circuit breaker state
- Success rate

**Health Checks:**
- Performed every 30 seconds
- Cached for 10 seconds to reduce load
- Alerts when success rate < 80%
- Tracks circuit breaker state changes

### 6. Suppression List Management

**Features:**
- Automatic bounce handling
- Complaint processing
- Unsubscribe management
- Multi-tenant isolation
- Cache-based lookups
- Database persistence

**Integration:**
- All email adapters check suppression list before sending
- Automatic filtering of suppressed emails
- Graceful handling (continues with allowed emails)

### 7. Timeout Protection

**Default Timeouts:**
- Email sending: 30 seconds
- Health checks: 2 seconds
- Webhook processing: 5 seconds
- API calls: 30 seconds

**Implementation:**
- Uses `Promise.race()` with timeout promise
- Throws timeout error if exceeded
- Logs timeout events
- Allows retry on timeout

### 8. Error Classification

**Error Categories:**
- **Retryable:** Network errors, 5xx, timeouts, rate limits
- **Non-Retryable:** 4xx, invalid credentials, suppressed emails
- **Circuit Breaker:** Opens circuit for retryable errors

---

## ⚙️ Configuration

### Environment Variables

```bash
# ZeptoMail (Primary Email Provider)
ZEPTOMAIL_SEND_MAIL_TOKEN=your_send_mail_token
ZEPTOMAIL_FROM_EMAIL=noreply@yourdomain.com
ZEPTOMAIL_FROM_NAME=Healthcare App
ZEPTOMAIL_BOUNCE_ADDRESS=bounces@yourdomain.com

# AWS SES (Fallback Email Provider)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_SES_FROM_EMAIL=noreply@yourdomain.com
AWS_SES_FROM_NAME=Healthcare App

# Firebase (Primary Push Provider)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_VAPID_KEY=your-vapid-key

# Circuit Breaker
COMMUNICATION_CIRCUIT_BREAKER_THRESHOLD=5
COMMUNICATION_CIRCUIT_BREAKER_TIMEOUT=60000

# Rate Limiting
COMMUNICATION_RATE_LIMIT_WINDOW=60000
COMMUNICATION_RATE_LIMIT_BURST=100

# Health Checks
COMMUNICATION_HEALTH_CHECK_INTERVAL=30000
```

### Per-Clinic Configuration

**Via API:**
```bash
PUT /api/v1/clinics/{clinicId}/communication/config
```

**Via Database:**
```sql
UPDATE clinics
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{communicationSettings,email,primary}',
  '{
    "provider": "zeptomail",
    "enabled": true,
    "credentials": {
      "sendMailToken": "...",
      "fromEmail": "noreply@clinic-domain.com",
      "fromName": "Clinic Name"
    },
    "priority": 1
  }'::jsonb
)
WHERE id = 'clinic-id-here';
```

---

## 🧪 Testing

### Email Testing

**1. Simple Test Email:**
```bash
GET /api/v1/email/test
```

**2. Custom Test Email:**
```bash
POST /api/v1/email/test-custom
{
  "to": "your-email@example.com",
  "template": "VERIFICATION"
}
```

**Available Templates:**
- `VERIFICATION` - Email verification
- `PASSWORD_RESET` - Password reset
- `OTP_LOGIN` - OTP login code
- `WELCOME` - Welcome email
- `LOGIN_NOTIFICATION` - Login notification
- `SECURITY_ALERT` - Security alert

**3. Clinic-Specific Test:**
```bash
POST /api/v1/clinics/{clinicId}/communication/test-email
{
  "testEmail": "your-email@example.com"
}
```

**4. Communication Service Test:**
```bash
POST /api/v1/communication/email
{
  "to": "your-email@example.com",
  "subject": "Test Email",
  "body": "<h1>Test</h1><p>This is a test email.</p>",
  "isHtml": true
}
```

**5. Email Service Status:**
```bash
GET /api/v1/email/status
```

### Push Notification Testing

**1. Register Device Token:**
```bash
POST /api/v1/communication/push/device-token
{
  "token": "FCM_TOKEN",
  "platform": "web",
  "userId": "user-123"
}
```

**2. Send Push Notification:**
```bash
POST /api/v1/communication/push
{
  "deviceToken": "FCM_TOKEN",
  "title": "Test Notification",
  "body": "This is a test push notification",
  "data": {
    "type": "test",
    "id": "123"
  }
}
```

### Health Check

```bash
GET /api/v1/communication/health
```

**Response:**
```json
{
  "healthy": true,
  "services": {
    "email": {
      "primary": "zeptomail",
      "status": "healthy",
      "fallback": ["aws_ses", "smtp"]
    },
    "push": {
      "primary": "firebase",
      "status": "healthy",
      "fallback": ["aws_sns"]
    }
  }
}
```

---

## 🐛 Troubleshooting

### ZeptoMail Issues

**Issue: "Send Mail Token is required"**

**Solution:**
1. Verify `sendMailToken` is set in clinic configuration
2. Check token is valid (not expired)
3. Regenerate token in ZeptoMail console if needed

**Issue: "Email address is not verified"**

**Solution:**
1. Verify `fromEmail` in ZeptoMail console
2. Complete domain verification if using custom domain
3. Check Mail Agent configuration

**Issue: "Rate limit exceeded"**

**Solution:**
1. Check ZeptoMail quota limits
2. Implement rate limiting in application
3. Use fallback providers for high volume

### Circuit Breaker Open

**Symptoms:** All requests to provider fail immediately

**Solutions:**
1. Check provider health status
2. Verify credentials are valid
3. Check for rate limiting
4. Wait for recovery timeout (60 seconds)
5. Manually reset circuit breaker if needed

### High Failure Rate

**Symptoms:** Success rate < 80%

**Solutions:**
1. Check provider status page
2. Verify credentials
3. Check rate limits
4. Review error logs
5. Consider using fallback provider

### Email Not Received

**Solutions:**
1. Check suppression list (bounces/complaints)
2. Verify email address is valid
3. Check spam folder
4. Review provider delivery logs
5. Test with different email provider

---

## ✅ Best Practices

### Email Best Practices

1. **Always use ZeptoMail as primary** - Best for transactional emails
2. **Configure fallback providers** - AWS SES and SMTP
3. **Monitor health metrics** - Check success rates regularly
4. **Set appropriate timeouts** - Based on operation type
5. **Handle retryable vs non-retryable errors** - Appropriately
6. **Use suppression lists** - Prevent sending to invalid addresses
7. **Monitor rate limits** - Prevent quota exhaustion
8. **Test fallback mechanisms** - Regularly

### Security Best Practices

1. **Never commit credentials** - Use environment variables
2. **Encrypt credentials** - System automatically encrypts before storing
3. **Rotate tokens/passwords** - Regularly
4. **Enable IP restrictions** - In ZeptoMail for production
5. **Monitor email sending** - For unusual activity
6. **Use HTTPS only** - For webhook endpoints
7. **Verify signatures** - For webhook messages

### Performance Best Practices

1. **Use caching** - Suppression lists, health checks
2. **Batch operations** - When possible
3. **Implement connection pooling** - For SMTP
4. **Monitor latency** - Track response times
5. **Optimize retry logic** - Exponential backoff
6. **Use async operations** - Don't block main thread

---

## 📚 Related Documentation

- [ZeptoMail & Zoho Mail Info](./ZEPTOMAIL_ZOHO_MAIL_INFO.md) - Detailed ZeptoMail setup
- [AWS SES Complete Guide](./AWS_SES_COMPLETE_GUIDE.md) - AWS SES setup
- [Communication Robustness](./COMMUNICATION_ROBUSTNESS.md) - Robustness features
- [Email Testing Guide](./EMAIL_TESTING_GUIDE.md) - Testing procedures
- [Email System Enhancements](./EMAIL_SYSTEM_ENHANCEMENTS.md) - Feature checklist
- [FCM Integration Guide](./FCM_INTEGRATION_GUIDE.md) - Push notifications
- [AWS SNS Integration Guide](./AWS_SNS_INTEGRATION_GUIDE.md) - Push backup

---

## 🎯 Quick Reference

### Default Configuration

```typescript
{
  email: {
    primary: {
      provider: "zeptomail",  // ✅ Primary
      enabled: true
    },
    fallback: [
      { provider: "aws_ses" },  // Fallback 1
      { provider: "smtp" }      // Fallback 2
    ]
  }
}
```

### API Endpoints

- `GET /api/v1/email/status` - Email service status
- `POST /api/v1/email/test-custom` - Test email
- `POST /api/v1/communication/email` - Send email via communication service
- `POST /api/v1/clinics/{clinicId}/communication/test-email` - Test clinic email
- `GET /api/v1/clinics/{clinicId}/communication/config` - Get clinic config
- `PUT /api/v1/clinics/{clinicId}/communication/config` - Update clinic config

---

**Last Updated:** January 2025  
**Status:** ✅ **PRODUCTION READY**

**Primary Email Provider:** ✅ **ZeptoMail** (Configured)

