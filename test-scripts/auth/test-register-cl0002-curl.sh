#!/bin/bash
# Test Register API with Clinic ID cl0002 using curl
# 
# Usage:
#   bash test-scripts/auth/test-register-cl0002-curl.sh
#   OR
#   curl -X POST https://backend-service-v1.ishswami.in/api/v1/auth/register \
#     -H "Content-Type: application/json" \
#     -H "X-API-Version: 1" \
#     -d '{
#       "email": "test-patient-'$(date +%s)'@test.com",
#       "password": "TestPassword123!",
#       "firstName": "Test",
#       "lastName": "Patient",
#       "phone": "+1234567890",
#       "clinicId": "cl0002",
#       "role": "PATIENT",
#       "gender": "MALE",
#       "dateOfBirth": "1990-01-01",
#       "address": "123 Test Street, Test City, Test State 12345"
#     }'

TIMESTAMP=$(date +%s)
EMAIL="test-patient-${TIMESTAMP}@test.com"

echo "============================================================"
echo "Testing Register API with Clinic ID cl0002"
echo "============================================================"
echo "Email: ${EMAIL}"
echo "Clinic ID: cl0002"
echo "URL: https://backend-service-v1.ishswami.in/api/v1/auth/register"
echo ""

curl -X POST https://backend-service-v1.ishswami.in/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 1" \
  -H "User-Agent: healthcare-api-test" \
  -d "{
    \"email\": \"${EMAIL}\",
    \"password\": \"TestPassword123!\",
    \"firstName\": \"Test\",
    \"lastName\": \"Patient\",
    \"phone\": \"+1234567890\",
    \"clinicId\": \"cl0002\",
    \"role\": \"PATIENT\",
    \"gender\": \"MALE\",
    \"dateOfBirth\": \"1990-01-01\",
    \"address\": \"123 Test Street, Test City, Test State 12345\"
  }" \
  -w "\n\nHTTP Status: %{http_code}\n" \
  -s | jq '.' 2>/dev/null || cat

echo ""
echo "============================================================"
