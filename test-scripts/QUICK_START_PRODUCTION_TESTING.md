# Quick Start: Production API Testing

## 🚀 Quick Commands

### Test All Production APIs

```bash
# From project root
node test-scripts/test-production-apis.js --env prod --report
```

### Test Specific Service

```bash
# Test appointments only
node test-scripts/test-production-apis.js --env prod --service appointments

# Test auth only
node test-scripts/test-production-apis.js --env prod --service auth
```

### Test Different Environments

```bash
# Production
node test-scripts/test-production-apis.js --env prod

# Staging
node test-scripts/test-production-apis.js --env staging

# Development
node test-scripts/test-production-apis.js --env dev
```

## 📋 Configuration

### Set Environment Variables

```bash
# Windows (PowerShell)
$env:PROD_API_URL="https://backend-service-v1.ishswami.in/api/v1"
$env:STAGING_API_URL="https://staging-api.yourdomain.com/api/v1"
$env:DEV_API_URL="http://localhost:8088/api/v1"

# Linux/Mac
export PROD_API_URL="https://backend-service-v1.ishswami.in/api/v1"
export STAGING_API_URL="https://staging-api.yourdomain.com/api/v1"
export DEV_API_URL="http://localhost:8088/api/v1"
```

### Or Use Custom Base URL

```bash
# Default production URL is already set to: https://backend-service-v1.ishswami.in/api/v1
# Override if needed:
node test-scripts/test-production-apis.js --env prod --base-url https://backend-service-v1.ishswami.in/api/v1
```

## 📊 Available Services

- `health` - Health check endpoints
- `auth` - Authentication endpoints
- `users` - User management
- `appointments` - Appointment management
- `billing` - Billing and invoices
- `ehr` - Electronic Health Records
- `video` - Video consultations
- `communication` - Notifications
- `clinic` - Clinic management
- `notification-preferences` - User preferences

## 📈 Generate Reports

```bash
# Generate HTML report
node test-scripts/test-production-apis.js --env prod --report

# Report saved to: test-report.html (in project root)
```

## 🔍 Verbose Output

```bash
# See detailed test output
node test-scripts/test-production-apis.js --env prod --verbose
```

## ⚡ Performance Options

```bash
# Parallel execution (faster, but may hit rate limits)
node test-scripts/test-production-apis.js --env prod --parallel

# Custom delay between services (ms)
node test-scripts/test-production-apis.js --env prod --delay 5000
```

## 📝 Example Workflow

```bash
# 1. Quick health check
node test-scripts/test-production-apis.js --env prod --service health

# 2. Test critical services
node test-scripts/test-production-apis.js --env prod --service auth
node test-scripts/test-production-apis.js --env prod --service appointments

# 3. Full test suite with report
node test-scripts/test-production-apis.js --env prod --report --verbose
```

## 🎯 What Gets Tested

The script uses existing test scripts from `test-scripts/` directory:

- ✅ All role-based tests (patient, doctor, receptionist, clinic-admin)
- ✅ All service endpoints (235+ endpoints)
- ✅ Authentication and authorization
- ✅ Error handling
- ✅ Response validation

## 📄 Output

- **Console**: Real-time test results with colored output
- **HTML Report**: Comprehensive report with pass/fail breakdown (if `--report`
  flag used)

## 🔧 Troubleshooting

### Script Not Found

```bash
# Make sure you're in project root
cd "d:\Projects\Doctor APP\HealthCareApp\HealthcareFrontend\HealthCareBackend"
node test-scripts/test-production-apis.js --env prod
```

### BASE_URL Issues

```bash
# Use --base-url to override
node test-scripts/test-production-apis.js --env prod --base-url https://api.yourdomain.com/api/v1
```

### Rate Limiting

```bash
# Increase delay between services
node test-scripts/test-production-apis.js --env prod --delay 10000
```

## 📚 Full Documentation

See `test-scripts/PRODUCTION_TEST_README.md` for complete documentation.
