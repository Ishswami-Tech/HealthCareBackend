# Production URL Configuration

## Production Backend URL

**Production API Base URL**: `https://backend-service-v1.ishswami.in/api/v1`

## Quick Test Commands

### Test Production APIs

```bash
# Test all production APIs
node test-scripts/test-production-apis.js --env prod --report

# Quick health check
node test-scripts/test-production-apis.js --env prod --service health

# Test specific service
node test-scripts/test-production-apis.js --env prod --service appointments
```

## Configuration

The production URL is automatically configured in:

- `test-scripts/test-production-apis.js` - Default production URL
- `test-scripts/_shared-utils.js` - BASE_URL (updated dynamically)

## Override URL

If you need to use a different URL:

```bash
# Using environment variable
export PROD_API_URL="https://backend-service-v1.ishswami.in/api/v1"
node test-scripts/test-production-apis.js --env prod

# Using command line flag
node test-scripts/test-production-apis.js --env prod --base-url https://backend-service-v1.ishswami.in/api/v1
```

## Endpoints

All endpoints are tested at:

- Base: `https://backend-service-v1.ishswami.in/api/v1`
- Health: `https://backend-service-v1.ishswami.in/api/v1/health`
- Auth: `https://backend-service-v1.ishswami.in/api/v1/auth/*`
- Appointments: `https://backend-service-v1.ishswami.in/api/v1/appointments/*`
- etc.

## Notes

- The script automatically updates `BASE_URL` in `_shared-utils.js` when running
- All existing test scripts will use the production URL
- Make sure test users exist in production database
- Use appropriate delays to avoid rate limiting
