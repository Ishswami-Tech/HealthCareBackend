#!/bin/bash
set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Load environment variables
if [ -f "../.env.production" ]; then
    source "../.env.production"
else
    echo -e "${RED}Error: .env.production file not found${NC}"
    exit 1
fi

# Variables
API_DOMAIN="api.ishswami.in"
NGINX_CONF_DIR="/etc/nginx/conf.d"
API_IP="172.18.0.5"  # Static IP for API container
SERVER_IP=$(hostname -I | awk '{print $1}')

# Function to clean up existing configurations
cleanup_configs() {
    echo -e "${YELLOW}Cleaning up existing Nginx configurations...${NC}"
    sudo rm -f ${NGINX_CONF_DIR}/*.conf
    echo -e "${GREEN}Cleanup completed${NC}"
}

# Function to check API health
check_api_health() {
    local endpoint=$1
    local max_retries=${HEALTH_CHECK_RETRIES:-5}
    local retry_count=0
    local wait_time=10

    echo -e "${YELLOW}Checking API health at: $endpoint${NC}"
    
    while [ $retry_count -lt $max_retries ]; do
        echo -e "${YELLOW}Attempt $((retry_count + 1)): Checking API health...${NC}"
        
        # Try direct health check
        local response=$(curl -s -m 10 "$endpoint" 2>&1)
        
        if echo "$response" | grep -q "status.*ok\|\"status\":\"ok\"\|\"ok\"\|\"status\": \"ok\""; then
            echo -e "${GREEN}API is healthy at $endpoint${NC}"
            return 0
        else
            retry_count=$((retry_count + 1))
            if [ $retry_count -lt $max_retries ]; then
                echo -e "${YELLOW}Attempt $retry_count failed. Waiting $wait_time seconds before retry...${NC}"
                sleep $wait_time
            fi
        fi
    done
    
    echo -e "${RED}API health check failed after $max_retries attempts at $endpoint${NC}"
    return 1
}

# Main execution
echo -e "${YELLOW}Starting deployment...${NC}"

# Check API health directly (no Nginx)
echo -e "${YELLOW}Checking API health directly...${NC}"
check_api_health "http://localhost:8088/health" || check_api_health "http://${SERVER_IP}:8088/health"

echo -e "${GREEN}API deployment successful!${NC}"
echo -e "${GREEN}API is accessible at:${NC}"
echo -e "${GREEN}http://${SERVER_IP}:8088${NC}"
echo -e "${GREEN}If using DNS, you should configure ${API_DOMAIN} to point to ${SERVER_IP}${NC}" 