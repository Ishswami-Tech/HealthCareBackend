#!/bin/bash
# Fix database password mismatches
# This script verifies and fixes database password issues

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/utils.sh"

# Load environment
load_environment

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

# Step 4: Test connection with expected password
log_info "Step 4: Testing database connection..."
TEST_RESULT=0
if docker exec postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
    log_success "Database connection successful with default password"
    TEST_RESULT=0
else
    log_warning "Database connection failed with default password"
    TEST_RESULT=1
fi

# Step 5: Try to determine actual password
log_info "Step 5: Determining actual database password..."
ACTUAL_PASSWORD=""
if [[ $TEST_RESULT -eq 0 ]]; then
    ACTUAL_PASSWORD="$EXPECTED_PASSWORD"
    log_success "Actual password matches expected: ${ACTUAL_PASSWORD:0:2}***"
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
    
    if [[ -z "$ACTUAL_PASSWORD" ]]; then
        log_error "Could not determine actual database password!"
        log_error "Please manually check PostgreSQL container logs:"
        log_error "  docker logs postgres"
        exit 1
    fi
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

# Step 7: Fix mismatches
if $NEEDS_FIX; then
    log_info "Step 7: Fixing password mismatches..."
    
    # Option 1: Change PostgreSQL password to match docker-compose (recommended)
    log_info "Option 1: Changing PostgreSQL password to match docker-compose..."
    if docker exec -e PGPASSWORD="$ACTUAL_PASSWORD" postgres psql -U postgres -c "ALTER USER postgres WITH PASSWORD '$EXPECTED_PASSWORD';" >/dev/null 2>&1; then
        log_success "PostgreSQL password changed to match docker-compose"
        ACTUAL_PASSWORD="$EXPECTED_PASSWORD"
    else
        log_warning "Failed to change PostgreSQL password, trying alternative method..."
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

# Step 8: Verify final connection
log_info "Step 8: Verifying final database connection..."
FINAL_DATABASE_URL="postgresql://postgres:${ACTUAL_PASSWORD}@postgres:5432/userdb"
if docker exec -e PGPASSWORD="$ACTUAL_PASSWORD" postgres psql -U postgres -d userdb -c "SELECT 1;" >/dev/null 2>&1; then
    log_success "Final database connection verified!"
    log_info "DATABASE_URL should be: ${FINAL_DATABASE_URL:0:30}***"
    log_info ""
    log_success "=========================================="
    log_success "Database Password Fix Complete"
    log_success "=========================================="
    exit 0
else
    log_error "Final database connection failed!"
    log_error "Please check:"
    log_error "  1. PostgreSQL container is running and healthy"
    log_error "  2. Password is correct: ${ACTUAL_PASSWORD:0:2}***"
    log_error "  3. Database 'userdb' exists"
    exit 1
fi

