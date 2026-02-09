#!/bin/bash
# Reset PostgreSQL Password Script
# Resets the postgres user password to match the docker-compose configuration

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/utils.sh"

# Fixed container name for PostgreSQL (never changes)
POSTGRES_CONTAINER="postgres"

# Password from docker-compose (default: postgres)
NEW_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

# Colors for output
log_info() {
    echo -e "\033[0;34m[INFO]\033[0m $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

log_success() {
    echo -e "\033[0;32m[SUCCESS]\033[0m $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

log_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

log_warning() {
    echo -e "\033[1;33m[WARNING]\033[0m $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

# Check if container is running
check_container() {
    if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
        log_error "PostgreSQL container '${POSTGRES_CONTAINER}' is not running"
        log_info "Starting PostgreSQL container..."
        
        # Ensure docker-compose.prod.yml exists (restores from /tmp or git if missing)
        if ! ensure_compose_file; then
            log_error "Failed to ensure docker-compose.prod.yml exists"
            exit 1
        fi
        
        # Ensure directory exists before changing into it
        local compose_dir="${BASE_DIR}/devops/docker"
        mkdir -p "$compose_dir" || {
            log_error "Failed to create directory: ${compose_dir}"
            exit 1
        }
        cd "$compose_dir" || {
            log_error "Failed to change to directory: ${compose_dir}"
            exit 1
        }
        
        # Pull so we use postgres:18 from docker-compose.prod.yml
        docker compose -f docker-compose.prod.yml --profile infrastructure pull --quiet postgres 2>/dev/null || true
        docker compose -f docker-compose.prod.yml --profile infrastructure up -d postgres || {
            log_error "Failed to start PostgreSQL container"
            exit 1
        }
        
        # Wait for PostgreSQL to be ready
        log_info "Waiting for PostgreSQL to be ready..."
        local max_retries=30
        local retry_count=0
        
        while [ $retry_count -lt $max_retries ]; do
            if docker exec "${POSTGRES_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
                log_success "PostgreSQL is ready"
                return 0
            fi
            retry_count=$((retry_count + 1))
            sleep 2
        done
        
        log_error "PostgreSQL did not become ready after ${max_retries} retries"
        exit 1
    fi
    
    return 0
}

# Reset password using trust authentication (local connections)
reset_password_trust() {
    log_info "Attempting to reset password using trust authentication..."
    
    # Try to connect without password (trust authentication for local connections)
    if docker exec "${POSTGRES_CONTAINER}" psql -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD '${NEW_PASSWORD}';" >/dev/null 2>&1; then
        log_success "Password reset successful using trust authentication"
        return 0
    fi
    
    return 1
}

# Reset password using peer authentication
reset_password_peer() {
    log_info "Attempting to reset password using peer authentication..."
    
    # Try using peer authentication (connecting as postgres OS user)
    if docker exec -u postgres "${POSTGRES_CONTAINER}" psql -d postgres -c "ALTER USER postgres WITH PASSWORD '${NEW_PASSWORD}';" >/dev/null 2>&1; then
        log_success "Password reset successful using peer authentication"
        return 0
    fi
    
    return 1
}

# Reset password by modifying pg_hba.conf temporarily
reset_password_pg_hba() {
    log_warning "Attempting to reset password by modifying pg_hba.conf..."
    
    # Backup pg_hba.conf
    docker exec "${POSTGRES_CONTAINER}" cp /var/lib/postgresql/data/pgdata/pg_hba.conf /var/lib/postgresql/data/pgdata/pg_hba.conf.backup || {
        log_error "Failed to backup pg_hba.conf"
        return 1
    }
    
    # Temporarily set trust authentication for local connections
    docker exec "${POSTGRES_CONTAINER}" sed -i 's/local\s*all\s*postgres\s*.*/local   all             postgres                                trust/' /var/lib/postgresql/data/pgdata/pg_hba.conf || {
        log_error "Failed to modify pg_hba.conf"
        return 1
    }
    
    # Reload PostgreSQL configuration
    docker exec "${POSTGRES_CONTAINER}" psql -U postgres -d postgres -c "SELECT pg_reload_conf();" >/dev/null 2>&1 || {
        log_warning "Failed to reload config, restarting container..."
        docker restart "${POSTGRES_CONTAINER}" || {
            log_error "Failed to restart container"
            return 1
        }
        
        # Wait for container to be ready
        sleep 5
        local max_retries=30
        local retry_count=0
        while [ $retry_count -lt $max_retries ]; do
            if docker exec "${POSTGRES_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
                break
            fi
            retry_count=$((retry_count + 1))
            sleep 2
        done
    }
    
    # Now reset password
    if docker exec "${POSTGRES_CONTAINER}" psql -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD '${NEW_PASSWORD}';" >/dev/null 2>&1; then
        log_success "Password reset successful"
        
        # Restore pg_hba.conf
        docker exec "${POSTGRES_CONTAINER}" cp /var/lib/postgresql/data/pgdata/pg_hba.conf.backup /var/lib/postgresql/data/pgdata/pg_hba.conf || {
            log_warning "Failed to restore pg_hba.conf backup"
        }
        
        # Reload configuration again
        docker exec "${POSTGRES_CONTAINER}" psql -U postgres -d postgres -c "SELECT pg_reload_conf();" >/dev/null 2>&1 || {
            log_warning "Failed to reload config after restore, restarting container..."
            docker restart "${POSTGRES_CONTAINER}"
        }
        
        return 0
    else
        log_error "Failed to reset password even with trust authentication"
        # Restore pg_hba.conf
        docker exec "${POSTGRES_CONTAINER}" cp /var/lib/postgresql/data/pgdata/pg_hba.conf.backup /var/lib/postgresql/data/pgdata/pg_hba.conf || true
        return 1
    fi
}

# Verify password
verify_password() {
    log_info "Verifying new password..."
    
    if docker exec "${POSTGRES_CONTAINER}" psql -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
        log_success "Password verification successful"
        return 0
    fi
    
    # Try with explicit password
    if PGPASSWORD="${NEW_PASSWORD}" docker exec -e PGPASSWORD="${NEW_PASSWORD}" "${POSTGRES_CONTAINER}" psql -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
        log_success "Password verification successful (with PGPASSWORD)"
        return 0
    fi
    
    log_warning "Password verification failed, but password may have been reset"
    return 1
}

# Main execution
main() {
    log_info "Starting PostgreSQL password reset..."
    log_info "Container: ${POSTGRES_CONTAINER}"
    log_info "New password: ${NEW_PASSWORD}"
    
    # Check Docker
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    # Check container
    check_container || exit 1
    
    # Try different methods to reset password
    if reset_password_trust; then
        verify_password || true
        log_success "Password reset completed successfully"
        exit 0
    fi
    
    if reset_password_peer; then
        verify_password || true
        log_success "Password reset completed successfully"
        exit 0
    fi
    
    if reset_password_pg_hba; then
        verify_password || true
        log_success "Password reset completed successfully"
        exit 0
    fi
    
    log_error "All password reset methods failed"
    log_info "You may need to:"
    log_info "1. Stop the container: docker stop ${POSTGRES_CONTAINER}"
    log_info "2. Remove the container: docker rm ${POSTGRES_CONTAINER}"
    log_info "3. Remove the volume: docker volume rm docker_postgres_data"
    log_info "4. Start fresh: docker compose -f docker-compose.prod.yml --profile infrastructure up -d postgres"
    log_warning "WARNING: Removing the volume will DELETE ALL DATA!"
    
    exit 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

