# Jitsi Fallback Setup Guide

## Overview

This guide explains how to configure **External Jitsi Service** (Option 1) as a
fallback when OpenVidu is unhealthy or unavailable.

**Architecture:**

- **Primary:** OpenVidu (self-hosted, full control)
- **Fallback:** Jitsi (external service, no containers needed)
- **Automatic Switching:** Health-based, transparent to frontend

---

## ✅ Implementation Status

✅ **Automatic fallback is implemented and ready to use!**

The system will automatically:

1. Check OpenVidu health on each request
2. If OpenVidu is unhealthy → Automatically switch to Jitsi
3. Frontend uses same API endpoints (transparent fallback)
4. Switch back to OpenVidu when it becomes healthy

---

## 📋 Configuration Steps

### Step 1: Set GitHub Variables/Secrets

Configure these in your GitHub repository:

**GitHub → Settings → Secrets and variables → Actions → Variables:**

| Variable                    | Example Value                      | Description                                          |
| --------------------------- | ---------------------------------- | ---------------------------------------------------- |
| `JITSI_DOMAIN`              | `meet.jit.si`                      | Your Jitsi domain (external service)                 |
| `JITSI_BASE_DOMAIN`         | `jit.si`                           | Base domain (extracted from JITSI_DOMAIN if not set) |
| `JITSI_SUBDOMAIN`           | `meet`                             | Subdomain (extracted from JITSI_DOMAIN if not set)   |
| `JITSI_APP_ID`              | `healthcare-jitsi-app`             | JWT app ID for authentication                        |
| `JITSI_BASE_URL`            | `https://meet.jit.si`              | Base URL for Jitsi Meet                              |
| `JITSI_WS_URL`              | `wss://meet.jit.si/xmpp-websocket` | WebSocket URL for real-time communication            |
| `JITSI_ENABLE_RECORDING`    | `true`                             | Enable recording feature                             |
| `JITSI_ENABLE_WAITING_ROOM` | `true`                             | Enable waiting room feature                          |

**GitHub → Settings → Secrets and variables → Actions → Secrets:**

| Secret             | Example Value     | Description                                                     |
| ------------------ | ----------------- | --------------------------------------------------------------- |
| `JITSI_APP_SECRET` | `your-secret-key` | JWT secret for authentication (generate a secure random string) |

### Step 2: Using Public Jitsi (meet.jit.si)

If using the public Jitsi service (`meet.jit.si`):

```bash
# Variables
JITSI_DOMAIN=meet.jit.si
JITSI_BASE_DOMAIN=jit.si
JITSI_SUBDOMAIN=meet
JITSI_APP_ID=healthcare-jitsi-app
JITSI_BASE_URL=https://meet.jit.si
JITSI_WS_URL=wss://meet.jit.si/xmpp-websocket
JITSI_ENABLE_RECORDING=true
JITSI_ENABLE_WAITING_ROOM=true

# Secret
JITSI_APP_SECRET=<generate-a-secure-random-string>
```

**Note:** Public Jitsi (`meet.jit.si`) may have limitations:

- No custom branding
- Rate limiting
- No guaranteed uptime SLA
- May not support JWT authentication

### Step 3: Using Hosted Jitsi Service

If using a hosted Jitsi service (e.g., 8x8, Jitsi Cloud, or self-hosted):

```bash
# Variables
JITSI_DOMAIN=meet.yourdomain.com
JITSI_BASE_DOMAIN=yourdomain.com
JITSI_SUBDOMAIN=meet
JITSI_APP_ID=healthcare-jitsi-app
JITSI_BASE_URL=https://meet.yourdomain.com
JITSI_WS_URL=wss://meet.yourdomain.com/xmpp-websocket
JITSI_ENABLE_RECORDING=true
JITSI_ENABLE_WAITING_ROOM=true

# Secret
JITSI_APP_SECRET=<your-jitsi-jwt-secret>
```

---

## 🔍 How It Works

### Automatic Fallback Flow

```
1. Frontend Request → VideoService.generateMeetingToken()
   ↓
2. VideoService.getProvider() checks OpenVidu health
   ↓
3. If OpenVidu healthy → Use OpenVidu
   If OpenVidu unhealthy → Automatically use Jitsi
   ↓
4. Same response format to frontend (transparent)
```

### Health Check Details

**OpenVidu Health Check:**

- Checks `/openvidu/api/health` endpoint
- Verifies container is running and accessible
- Timeout: 10 seconds with retries

**Jitsi Health Check:**

- Checks external Jitsi service is reachable
- Verifies configuration is valid
- Timeout: 5 seconds with retries
- Accepts any HTTP response (200, 404, etc.) as "service is up"

### Provider Switching

- **Automatic:** No manual intervention needed
- **Real-time:** Health checks on each request
- **Transparent:** Frontend uses same API endpoints
- **Logged:** All switches are logged for monitoring

---

## 📊 Monitoring

### Health Indicators

The health service tracks:

- Current provider (OpenVidu or Jitsi)
- Fallback provider status
- Health status of both providers

**Check health:**

```bash
GET /health?detailed=true
```

Response includes:

```json
{
  "services": {
    "video": {
      "status": "healthy",
      "primaryProvider": "openvidu",
      "fallbackProvider": "jitsi",
      "details": "..."
    }
  }
}
```

### Logs

All provider switches are logged:

- `LogType.SYSTEM`
- `LogLevel.INFO` - Provider switch successful
- `LogLevel.WARN` - Fallback activated
- `LogLevel.ERROR` - Both providers unavailable

---

## 🧪 Testing

### Test OpenVidu Health

```bash
# Check OpenVidu health
curl http://your-api/health?detailed=true | jq '.services.video'
```

### Test Jitsi Fallback

1. **Stop OpenVidu container:**

   ```bash
   docker stop openvidu-server
   ```

2. **Make video request:**

   ```bash
   POST /api/v1/video/consultations/generate-token
   ```

3. **Verify:**
   - Request succeeds (uses Jitsi)
   - Logs show fallback activation
   - Health check shows Jitsi as active provider

### Test Automatic Switch Back

1. **Start OpenVidu container:**

   ```bash
   docker start openvidu-server
   ```

2. **Wait for health check:**
   - Next request will check OpenVidu health
   - If healthy, automatically switches back to OpenVidu

---

## 🔧 Troubleshooting

### Jitsi Not Available

**Symptoms:**

- Health check fails
- Fallback not working

**Solutions:**

1. Verify `JITSI_BASE_URL` is correct
2. Check external Jitsi service is accessible
3. Verify network connectivity
4. Check logs for specific error messages

### Both Providers Unavailable

**Symptoms:**

- Video requests fail
- Health check shows both unhealthy

**Solutions:**

1. Check OpenVidu container status
2. Verify Jitsi configuration
3. Check network connectivity
4. Review logs for detailed errors

---

## 📝 Notes

### No Containers Needed

✅ **External Jitsi service requires NO containers!**

Just configure:

- Environment variables (URLs, domain)
- JWT secret (if using authentication)

### Frontend Compatibility

✅ **No frontend changes needed!**

- Same API endpoints
- Same request/response format
- Same meeting URL structure
- Automatic provider switching

### Resource Usage

- **OpenVidu:** Self-hosted (uses server resources)
- **Jitsi:** External service (no server resources)
- **Fallback:** Only active when OpenVidu is down

---

## 🎯 Summary

✅ **External Jitsi fallback is ready to use!**

**To activate:**

1. Set GitHub Variables/Secrets (see Step 1)
2. Deploy (CI/CD will use new configuration)
3. Test fallback (see Testing section)

**Benefits:**

- ✅ No containers needed
- ✅ Simple configuration
- ✅ Automatic fallback
- ✅ Transparent to frontend
- ✅ Reliable backup

---

## 📚 Related Documentation

- [Video Service README](./README.md)
- [Health Service README](../health/README.md)
- [CI/CD Workflow](../../../.github/workflows/ci.yml)
