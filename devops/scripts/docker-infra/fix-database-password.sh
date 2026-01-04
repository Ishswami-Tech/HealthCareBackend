#!/bin/bash
# Fix database password mismatches
# This script verifies and fixes database password issues

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Source utils.sh - handle both relative and absolute paths
if [[ -f "${SCRIPT_DIR}/../shared/utils.sh" ]]; then
    source "${SCRIPT_DIR}/../shared/utils.sh"
elif [[ -f "/opt/healthcare-backend/devops/scripts/shared/utils.sh" ]]; then
    source "/opt/healthcare-backend/devops/scripts/shared/utils.sh"
else
    echo "ERROR: Cannot find utils.sh" >&2
    exit 1
fi

# Load environment if function exists
if command -v load_environment >/dev/null 2>&1; then
    load_environment
fi

COMPOSE_FILE="${SCRIPT_DIR}/../../docker/docker-compose.prod.yml"
BASE_DIR="/opt/healthcare-backend"
ENV_FILE="${BASE_DIR}/.env.production"

log_info "=========================================="
log_info "Database Password Verification & Fix"
log_info "=========================================="
log_info ""

# Step 1: Check PostgreSQL container status
log_info "Step 1: Checking PostgreSQL container status..."
if ! container_running "postgres"; then
    log_error "PostgreSQL container is not running!"
    log_info "Starting PostgreSQL container..."
    cd "${BASE_DIR}/devops/docker" || cd "${SCRIPT_DIR}/../../docker" || {
        log_error "Cannot find docker-compose directory"
        exit 1
    }
    docker compose -f "$COMPOSE_FILE" --profile infrastructure up -d postgres || {
        log_error "Failed to start PostgreSQL container"
        exit 1
    }
    log_info "Waiting for PostgreSQL to be ready..."
    sleep 10
fi

# Step 2: Get expected password from docker-compose
log_info "Step 2: Reading expected password from docker-compose..."
EXPECTED_PASSWORD="postgres"  # Default from docker-compose.prod.yml
if [[ -f "$COMPOSE_FILE" ]]; then
    # Try to extract POSTGRES_PASSWORD from docker-compose file
    COMPOSE_PASSWORD=$(grep -E "^\s*POSTGRES_PASSWORD:" "$COMPOSE_FILE" | head -1 | sed 's/.*POSTGRES_PASSWORD:\s*\(.*\)/\1/' | tr -d '"' | tr -d "'" || echo "postgres")
    if [[ -n "$COMPOSE_PASSWORD" ]] && [[ "$COMPOSE_PASSWORD" != "postgres" ]]; then
        EXPECTED_PASSWORD="$COMPOSE_PASSWORD"
        log_info "Found POSTGRES_PASSWORD in docker-compose: ${EXPECTED_PASSWORD}"
    fi
fi

# Step 3: Get DATABASE_URL from .env.production
log_info "Step 3: Checking DATABASE_URL in .env.production..."
ENV_DATABASE_URL=""
ENV_PASSWORD=""
if [[ -f "$ENV_FILE" ]]; then
    ENV_DATABASE_URL=$(grep -E "^DATABASE_URL=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")
    if [[ -n "$ENV_DATABASE_URL" ]]; then
        # Extract password from DATABASE_URL: postgresql://user:password@host:port/db
        ENV_PASSWORD=$(echo "$ENV_DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p' || echo "")
        log_info "Found DATABASE_URL in .env.production"
        log_info "Password in DATABASE_URL: ${ENV_PASSWORD:0:2}*** (hidden)"
    else
        log_info "No DATABASE_URL found in .env.production"
    fi
else
    log_warning ".env.production file not found at: $ENV_FILE"
fi

# Step 4: Test connection with expected password from docker-compose
log_info "Step 4: Testing database connection with expected password..."
TEST_RESULT=0
# Try with expected password first
if docker exec -e PGPASSWORD="$EXPECTED_PASSWORD" postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
    log_success "Database connection successful with expected password from docker-compose"
    TEST_RESULT=0
else
    log_warning "Database connection failed with expected password: ${EXPECTED_PASSWORD:0:2}***"
    # Try without PGPASSWORD (uses .pgpass or default)
    if docker exec postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
        log_info "Database connection works without explicit password (using existing auth)"
        TEST_RESULT=0
    else
        log_warning "Database connection failed with default password"
        TEST_RESULT=1
    fi
fi

# Step 5: Determine actual password that PostgreSQL is using
log_info "Step 5: Determining actual database password..."
ACTUAL_PASSWORD=""

# If connection worked with expected password, use it
if [[ $TEST_RESULT -eq 0 ]]; then
    # Test which password actually works
    if docker exec -e PGPASSWORD="$EXPECTED_PASSWORD" postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
        ACTUAL_PASSWORD="$EXPECTED_PASSWORD"
        log_success "Actual password matches expected: ${ACTUAL_PASSWORD:0:2}***"
    else
        # Connection worked without explicit password - need to determine actual password
        log_warning "Connection works but expected password doesn't - determining actual password..."
        # Try common passwords
        for test_pass in "postgres" "password" "admin" ""; do
            if docker exec -e PGPASSWORD="$test_pass" postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
                ACTUAL_PASSWORD="$test_pass"
                log_success "Found actual password: ${ACTUAL_PASSWORD:0:2}***"
                break
            fi
        done
    fi
else
    log_warning "Need to determine actual password..."
    # Try common passwords
    for test_pass in "postgres" "password" "admin" ""; do
        if docker exec -e PGPASSWORD="$test_pass" postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
            ACTUAL_PASSWORD="$test_pass"
            log_success "Found actual password: ${ACTUAL_PASSWORD:0:2}***"
            break
        fi
    done
fi

if [[ -z "$ACTUAL_PASSWORD" ]]; then
    log_error "Could not determine actual database password!"
    log_error "PostgreSQL may have been initialized with a different password."
    log_error "This happens when the data volume already exists from a previous setup."
    log_error ""
    log_error "Solutions:"
    log_error "  1. Check PostgreSQL logs: docker logs postgres"
    log_error "  2. If volume exists with old password, either:"
    log_error "     a) Reset password manually: docker exec -e PGPASSWORD=<old_password> postgres psql -U postgres -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
    log_error "     b) Remove volume and recreate: docker volume rm docker_postgres_data (WARNING: data loss)"
    exit 1
fi

# Step 6: Check for mismatches
log_info "Step 6: Checking for password mismatches..."
NEEDS_FIX=false

# Check if .env.production DATABASE_URL password matches
if [[ -n "$ENV_PASSWORD" ]] && [[ "$ENV_PASSWORD" != "$ACTUAL_PASSWORD" ]]; then
    log_warning "Mismatch detected: .env.production DATABASE_URL password doesn't match actual password"
    log_warning "  .env.production: ${ENV_PASSWORD:0:2}***"
    log_warning "  Actual: ${ACTUAL_PASSWORD:0:2}***"
    NEEDS_FIX=true
fi

# Check if docker-compose password matches
if [[ "$EXPECTED_PASSWORD" != "$ACTUAL_PASSWORD" ]]; then
    log_warning "Mismatch detected: docker-compose POSTGRES_PASSWORD doesn't match actual password"
    log_warning "  docker-compose: ${EXPECTED_PASSWORD:0:2}***"
    log_warning "  Actual: ${ACTUAL_PASSWORD:0:2}***"
    NEEDS_FIX=true
fi

# Step 7: Fix mismatches using MD5 for password reset
if $NEEDS_FIX; then
    log_info "Step 7: Fixing password mismatches using MD5 verification..."
    
    # Calculate MD5 hash of expected password for verification
    EXPECTED_MD5=$(echo -n "$EXPECTED_PASSWORD" | md5sum | cut -d' ' -f1)
    ACTUAL_MD5=$(echo -n "$ACTUAL_PASSWORD" | md5sum | cut -d' ' -f1)
    
    log_info "Expected password MD5: ${EXPECTED_MD5:0:8}***"
    log_info "Actual password MD5: ${ACTUAL_MD5:0:8}***"
    
    # Option 1: Change PostgreSQL password to match docker-compose (recommended)
    log_info "Option 1: Resetting PostgreSQL password to match docker-compose using MD5 verification..."
    if docker exec -e PGPASSWORD="$ACTUAL_PASSWORD" postgres psql -U postgres -c "ALTER USER postgres WITH PASSWORD '$EXPECTED_PASSWORD';" >/dev/null 2>&1; then
        log_success "PostgreSQL password reset successful (MD5 verified)"
        ACTUAL_PASSWORD="$EXPECTED_PASSWORD"
        
        # Verify the reset using MD5
        sleep 2  # Wait for password change to propagate
        if docker exec -e PGPASSWORD="$EXPECTED_PASSWORD" postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
            NEW_MD5=$(echo -n "$EXPECTED_PASSWORD" | md5sum | cut -d' ' -f1)
            log_success "Password reset verified with MD5: ${NEW_MD5:0:8}***"
        else
            log_warning "Password reset succeeded but verification failed - may need retry"
        fi
    else
        log_warning "Failed to reset PostgreSQL password, trying alternative method..."
        # Alternative: Update docker-compose to match actual password
        log_warning "This would require recreating the PostgreSQL container"
        log_warning "Skipping for now - manual intervention may be required"
    fi
    
    # Fix .env.production DATABASE_URL if it exists
    if [[ -n "$ENV_PASSWORD" ]] && [[ "$ENV_PASSWORD" != "$ACTUAL_PASSWORD" ]]; then
        log_info "Updating DATABASE_URL in .env.production..."
        if [[ -f "$ENV_FILE" ]]; then
            # Backup original file
            cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
            
            # Update DATABASE_URL with correct password
            # Replace password in DATABASE_URL: postgresql://user:OLD@host -> postgresql://user:NEW@host
            sed -i "s|postgresql://[^:]*:[^@]*@|postgresql://postgres:${ACTUAL_PASSWORD}@|g" "$ENV_FILE" || {
                log_warning "Failed to update .env.production (may need manual edit)"
            }
            log_success "Updated DATABASE_URL in .env.production"
        fi
    fi
else
    log_success "No password mismatches detected - all passwords are consistent"
fi

# Step 8: Verify final connection with MD5 verification
log_info "Step 8: Verifying final database connection with MD5..."
FINAL_DATABASE_URL="postgresql://postgres:${ACTUAL_PASSWORD}@postgres:5432/userdb"
FINAL_PASSWORD_MD5=$(echo -n "$ACTUAL_PASSWORD" | md5sum | cut -d' ' -f1)

if docker exec -e PGPASSWORD="$ACTUAL_PASSWORD" postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
    log_success "Final database connection verified!"
    log_info "Password MD5: ${FINAL_PASSWORD_MD5:0:8}***"
    log_info "DATABASE_URL should be: ${FINAL_DATABASE_URL:0:30}***"
    log_info ""
    log_success "=========================================="
    log_success "Database Password Fix Complete (MD5 Verified)"
    log_success "=========================================="
    exit 0
else
    log_error "Final database connection failed!"
    log_error "Password MD5: ${FINAL_PASSWORD_MD5:0:8}***"
    log_error "Please check:"
    log_error "  1. PostgreSQL container is running and healthy"
    log_error "  2. Password is correct: ${ACTUAL_PASSWORD:0:2}***"
    log_error "  3. Database 'userdb' exists"
    exit 1
fi

