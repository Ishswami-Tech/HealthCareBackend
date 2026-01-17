# Production API Test Runner

## Overview

Enterprise-grade production API test runner that leverages existing test scripts
in `test-scripts/` directory. Supports multiple environments, comprehensive
reporting, and flexible test execution.

## Quick Start

### Basic Usage

```bash
# Test all APIs in production
node test-scripts/test-production-apis.js --env prod

# Test specific service
node test-scripts/test-production-apis.js --env prod --service appointments

# Test with HTML report
node test-scripts/test-production-apis.js --env prod --report

# Verbose output
node test-scripts/test-production-apis.js --env prod --verbose
```

### Advanced Usage

```bash
# Custom base URL (if different from default)
node test-scripts/test-production-apis.js --env prod --base-url https://backend-service-v1.ishswami.in/api/v1

# Staging environment
node test-scripts/test-production-apis.js --env staging

# Development environment
node test-scripts/test-production-apis.js --env dev

# Parallel execution (faster but may hit rate limits)
node test-scripts/test-production-apis.js --env prod --parallel

# Custom delay between services
node test-scripts/test-production-apis.js --env prod --delay 5000
```

## Command Line Options

| Option                | Description                      | Default         | Example                                     |
| --------------------- | -------------------------------- | --------------- | ------------------------------------------- |
| `--env <env>`         | Environment (dev\|staging\|prod) | `prod`          | `--env staging`                             |
| `--base-url <url>`    | Custom base URL                  | From env config | `--base-url https://api.example.com/api/v1` |
| `--service <service>` | Test specific service            | `all`           | `--service appointments`                    |
| `--role <role>`       | Test specific role               | `all`           | `--role doctor`                             |
| `--report`            | Generate HTML report             | `false`         | `--report`                                  |
| `--verbose`           | Verbose output                   | `false`         | `--verbose`                                 |
| `--parallel`          | Run tests in parallel            | `false`         | `--parallel`                                |
| `--delay <ms>`        | Delay between services           | `2000`          | `--delay 5000`                              |
| `--help, -h`          | Show help message                | -               | `--help`                                    |

## Available Services

The runner tests all services defined in existing test scripts:

1. **health** - Health check endpoints
2. **auth** - Authentication endpoints
3. **users** - User management endpoints
4. **appointments** - Appointment management
5. **billing** - Billing and invoices
6. **ehr** - Electronic Health Records
7. **video** - Video consultation endpoints
8. **communication** - Notifications and messaging
9. **clinic** - Clinic management
10. **notification-preferences** - User preferences

## Environment Configuration

### Environment Variables

Set these for different environments:

```bash
# Production
export PROD_API_URL="https://backend-service-v1.ishswami.in/api/v1"

# Staging
export STAGING_API_URL="https://staging-api.yourdomain.com/api/v1"

# Development
export DEV_API_URL="http://localhost:8088/api/v1"
```

### Default URLs

If environment variables are not set, defaults are:

- **dev**: `http://localhost:8088/api/v1`
- **staging**: `https://staging-api.example.com/api/v1`
- **prod**: `https://backend-service-v1.ishswami.in/api/v1`

## How It Works

1. **Updates BASE_URL**: Automatically updates `BASE_URL` in `_shared-utils.js`
   to match the selected environment
2. **Runs Existing Scripts**: Executes existing test scripts from
   `test-scripts/` directory
3. **Collects Results**: Aggregates results from all test scripts
4. **Generates Report**: Creates HTML report if `--report` flag is used

## Examples

### Example 1: Full Production Test

```bash
# Test all services in production with report
node test-scripts/test-production-apis.js --env prod --report
```

### Example 2: Test Specific Service

```bash
# Test only appointment endpoints
node test-scripts/test-production-apis.js --env prod --service appointments
```

### Example 3: Staging Environment

```bash
# Test staging environment
node test-scripts/test-production-apis.js --env staging --verbose
```

### Example 4: Quick Health Check

```bash
# Quick health check only
node test-scripts/test-production-apis.js --env prod --service health
```

## Output

### Console Output

```
============================================================
PRODUCTION API TEST SUITE
============================================================
Environment: prod
Base URL: https://api.example.com/api/v1
Service: all
Role: all
Start Time: 2025-01-01T00:00:00.000Z
Verbose: false
Report: true

============================================================
Running Tests
============================================================

============================================================
Testing Health Service
============================================================
Script: test-health.js
Base URL: https://api.example.com/api/v1
✓ Health tests PASSED

============================================================
Testing Auth Service
============================================================
Script: test-all-auth-sequential.js
Base URL: https://api.example.com/api/v1
✓ Auth tests PASSED

...

============================================================
TEST SUMMARY
============================================================
Environment: prod
Base URL: https://api.example.com/api/v1
Total Passed: 10
Total Failed: 0
Total Skipped: 0
Total Time: 45.32s

Service-wise Results:
  ✓ Health: PASSED
  ✓ Auth: PASSED
  ✓ Users: PASSED
  ...
```

### HTML Report

When using `--report` flag, generates `test-report.html` in project root with:

- Test summary (total, passed, failed, skipped)
- Pass rate percentage
- Service-wise breakdown
- Error details (if any)
- Environment and base URL information

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Production API Tests

on:
  schedule:
    - cron: '0 2 * * *' # Daily at 2 AM
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Run Production API Tests
        env:
          PROD_API_URL: ${{ secrets.PROD_API_URL }}
        run: |
          node test-scripts/test-production-apis.js --env prod --report
      - name: Upload Report
        uses: actions/upload-artifact@v3
        with:
          name: api-test-report
          path: test-report.html
```

## Best Practices

### 1. **Start with Health Checks**

```bash
# Always start with health checks
node test-scripts/test-production-apis.js --env prod --service health
```

### 2. **Test Incrementally**

```bash
# Test one service at a time
node test-scripts/test-production-apis.js --env prod --service auth
node test-scripts/test-production-apis.js --env prod --service appointments
# ... etc
```

### 3. **Use Appropriate Delays**

```bash
# For production, use longer delays to avoid rate limits
node test-scripts/test-production-apis.js --env prod --delay 5000
```

### 4. **Generate Reports**

```bash
# Always generate reports for documentation
node test-scripts/test-production-apis.js --env prod --report
```

### 5. **Use Environment Variables**

```bash
# Set environment variables for different environments
export PROD_API_URL="https://api.yourdomain.com/api/v1"
node test-scripts/test-production-apis.js --env prod
```

## Troubleshooting

### BASE_URL Not Updating

**Problem**: Tests still using old BASE_URL

**Solution**:

1. Check if `_shared-utils.js` is writable
2. Verify the script has permissions to modify files
3. Manually set `BASE_URL` environment variable

### Test Scripts Not Found

**Problem**: Scripts not found errors

**Solution**:

1. Verify test scripts exist in `test-scripts/` directory
2. Check script names match SERVICE_TESTS configuration
3. Ensure you're running from project root

### Authentication Failures

**Problem**: Tests failing with 401 Unauthorized

**Solution**:

1. Verify test user credentials in test scripts
2. Check if test users exist in the database
3. Verify JWT token expiration settings

### Rate Limiting

**Problem**: Tests failing with 429 Too Many Requests

**Solution**:

1. Increase delay between services: `--delay 5000`
2. Don't use `--parallel` flag
3. Test services sequentially

## Notes

- The script automatically updates `BASE_URL` in `_shared-utils.js` for the
  selected environment
- All existing test scripts in `test-scripts/` are used as-is
- The runner aggregates results from all test scripts
- HTML reports are generated in the project root directory

## Support

For issues or questions:

1. Check the error logs in console output
2. Review the HTML report for detailed errors
3. Verify environment configuration
4. Check existing test scripts in `test-scripts/` directory
