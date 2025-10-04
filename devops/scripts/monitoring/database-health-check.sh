#!/bin/bash

# Database Health Check Script
# This script helps diagnose and fix database connection issues

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_HOST=${DB_HOST:-"localhost"}
DB_PORT=${DB_PORT:-"5432"}
DB_NAME=${DB_NAME:-"healthcare"}
DB_USER=${DB_USER:-"postgres"}
MAX_RETRIES=30
RETRY_INTERVAL=5

echo -e "${BLUE}=== Database Health Check Script ===${NC}"
echo ""

# Function to check if PostgreSQL is running
check_postgres_running() {
    echo -e "${YELLOW}Checking if PostgreSQL is running...${NC}"
    
    if pg_isready -h $DB_HOST -p $DB_PORT -U $DB_USER > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PostgreSQL is running and accepting connections${NC}"
        return 0
    else
        echo -e "${RED}✗ PostgreSQL is not running or not accepting connections${NC}"
        return 1
    fi
}

# Function to check database connection
check_db_connection() {
    echo -e "${YELLOW}Testing database connection...${NC}"
    
    if psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1;" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Database connection successful${NC}"
        return 0
    else
        echo -e "${RED}✗ Database connection failed${NC}"
        return 1
    fi
}

# Function to check database recovery status
check_recovery_status() {
    echo -e "${YELLOW}Checking database recovery status...${NC}"
    
    local recovery_status=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT pg_is_in_recovery();" 2>/dev/null | tr -d ' ')
    
    if [ "$recovery_status" = "t" ]; then
        echo -e "${YELLOW}⚠ Database is in recovery mode${NC}"
        echo -e "${YELLOW}   This is normal for read replicas, but may cause connection issues${NC}"
        return 1
    elif [ "$recovery_status" = "f" ]; then
        echo -e "${GREEN}✓ Database is not in recovery mode${NC}"
        return 0
    else
        echo -e "${RED}✗ Could not determine recovery status${NC}"
        return 1
    fi
}

# Function to check active connections
check_active_connections() {
    echo -e "${YELLOW}Checking active database connections...${NC}"
    
    local active_connections=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';" 2>/dev/null | tr -d ' ')
    local max_connections=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SHOW max_connections;" 2>/dev/null | tr -d ' ')
    
    echo -e "${BLUE}   Active connections: $active_connections${NC}"
    echo -e "${BLUE}   Max connections: $max_connections${NC}"
    
    if [ "$active_connections" -gt 0 ]; then
        echo -e "${GREEN}✓ Database has active connections${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠ No active connections found${NC}"
        return 1
    fi
}

# Function to restart PostgreSQL service
restart_postgres() {
    echo -e "${YELLOW}Attempting to restart PostgreSQL...${NC}"
    
    # Try different service names
    if command -v systemctl >/dev/null 2>&1; then
        # Systemd
        if systemctl is-active --quiet postgresql; then
            echo "Restarting postgresql service..."
            sudo systemctl restart postgresql
        elif systemctl is-active --quiet postgres; then
            echo "Restarting postgres service..."
            sudo systemctl restart postgres
        else
            echo -e "${RED}Could not find running PostgreSQL service${NC}"
            return 1
        fi
    elif command -v service >/dev/null 2>&1; then
        # SysV init
        if service postgresql status >/dev/null 2>&1; then
            echo "Restarting postgresql service..."
            sudo service postgresql restart
        else
            echo -e "${RED}Could not find running PostgreSQL service${NC}"
            return 1
        fi
    else
        echo -e "${RED}Could not determine how to restart PostgreSQL service${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✓ PostgreSQL service restarted${NC}"
    return 0
}

# Function to wait for database to be ready
wait_for_database() {
    echo -e "${YELLOW}Waiting for database to be ready...${NC}"
    
    local retries=0
    while [ $retries -lt $MAX_RETRIES ]; do
        if check_postgres_running; then
            echo -e "${GREEN}✓ Database is ready after $retries retries${NC}"
            return 0
        fi
        
        retries=$((retries + 1))
        echo -e "${YELLOW}   Retry $retries/$MAX_RETRIES (waiting ${RETRY_INTERVAL}s)...${NC}"
        sleep $RETRY_INTERVAL
    done
    
    echo -e "${RED}✗ Database did not become ready after $MAX_RETRIES retries${NC}"
    return 1
}

# Function to check Prisma connection
check_prisma_connection() {
    echo -e "${YELLOW}Testing Prisma connection...${NC}"
    
    # Check if we're in the right directory
    if [ ! -f "package.json" ]; then
        echo -e "${RED}✗ Not in project root directory${NC}"
        return 1
    fi
    
    # Try to run a simple Prisma command
    if npx prisma db execute --stdin <<< "SELECT 1;" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Prisma connection successful${NC}"
        return 0
    else
        echo -e "${RED}✗ Prisma connection failed${NC}"
        return 1
    fi
}

# Function to reset Prisma client
reset_prisma_client() {
    echo -e "${YELLOW}Resetting Prisma client...${NC}"
    
    # Remove generated Prisma client
    rm -rf node_modules/.prisma
    
    # Regenerate Prisma client
    npx prisma generate
    
    echo -e "${GREEN}✓ Prisma client reset complete${NC}"
}

# Main execution
main() {
    echo -e "${BLUE}Starting database health check...${NC}"
    echo ""
    
    # Check if PostgreSQL is running
    if ! check_postgres_running; then
        echo ""
        echo -e "${YELLOW}PostgreSQL is not running. Attempting to restart...${NC}"
        if restart_postgres; then
            echo ""
            echo -e "${YELLOW}Waiting for PostgreSQL to start...${NC}"
            wait_for_database
        else
            echo -e "${RED}Failed to restart PostgreSQL. Please check your installation.${NC}"
            exit 1
        fi
    fi
    
    echo ""
    
    # Check database connection
    if ! check_db_connection; then
        echo -e "${RED}Database connection failed. Please check your credentials and database configuration.${NC}"
        exit 1
    fi
    
    echo ""
    
    # Check recovery status
    check_recovery_status
    
    echo ""
    
    # Check active connections
    check_active_connections
    
    echo ""
    
    # Check Prisma connection
    if ! check_prisma_connection; then
        echo ""
        echo -e "${YELLOW}Prisma connection failed. Attempting to reset Prisma client...${NC}"
        reset_prisma_client
        
        echo ""
        echo -e "${YELLOW}Testing Prisma connection again...${NC}"
        if check_prisma_connection; then
            echo -e "${GREEN}✓ Prisma connection restored${NC}"
        else
            echo -e "${RED}✗ Prisma connection still failing${NC}"
            exit 1
        fi
    fi
    
    echo ""
    echo -e "${GREEN}=== Database Health Check Complete ===${NC}"
    echo -e "${GREEN}All checks passed! Your database should be working properly.${NC}"
}

# Run main function
main "$@" 