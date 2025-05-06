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
DEPLOY_PATH="/var/www/healthcare"
NETWORK_NAME=${NETWORK_NAME:-app-network}
TEMPLATE_DIR="./conf.d"
API_CONF="api.conf"
API_IP="172.18.0.5"  # Static IP for API container

# Function to clean up existing configurations
cleanup_configs() {
    echo -e "${YELLOW}Cleaning up existing Nginx configurations...${NC}"
    sudo rm -f ${NGINX_CONF_DIR}/*.conf
    sudo rm -f ${NGINX_CONF_DIR}/.conf.*
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
        
        # Try internal health check
        echo -e "${YELLOW}Testing internal health check (container IP)...${NC}"
        curl -v http://172.18.0.5:8088/health
        
        # Try external health check
        echo -e "${YELLOW}Testing external health check...${NC}"
        local response=$(curl -v -m 10 "$endpoint" 2>&1)
        local status=$?
        
        echo -e "${YELLOW}Curl exit code: $status${NC}"
        echo -e "${YELLOW}Response:${NC}"
        echo "$response"
        
        if echo "$response" | grep -q "200 OK"; then
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
    echo -e "${RED}Final diagnostics:${NC}"
    echo -e "${YELLOW}1. Nginx configuration test:${NC}"
    sudo nginx -t
    echo -e "${YELLOW}2. Nginx error log:${NC}"
    sudo tail -n 50 /var/log/nginx/error.log
    echo -e "${YELLOW}3. API container status:${NC}"
    docker inspect latest-api --format '{{.State.Status}} - {{.State.Health.Status}}'
    echo -e "${YELLOW}4. Container logs:${NC}"
    docker logs --tail 20 latest-api
    return 1
}

# Function to wait for container readiness
wait_for_container() {
    local container_name=$1
    local max_attempts=30
    local attempt=1
    local wait_time=10

    echo -e "${YELLOW}Waiting for container $container_name to be ready...${NC}"
    
    while [ $attempt -le $max_attempts ]; do
        if docker ps --filter "name=$container_name" --format "{{.Status}}" | grep -q "healthy"; then
            echo -e "${GREEN}Container $container_name is healthy${NC}"
            return 0
        fi
        echo -e "${YELLOW}Attempt $attempt/$max_attempts: Container $container_name not ready yet...${NC}"
        sleep $wait_time
        attempt=$((attempt + 1))
    done

    echo -e "${RED}Container $container_name failed to become healthy${NC}"
    return 1
}

# Function to apply template
apply_template() {
    local template="$1"
    local target="$2"
    
    # Create backup of template if it doesn't exist
    if [ ! -f "${template}.original" ]; then
        cp "${template}" "${template}.original"
    fi
    
    # Restore from original template
    cp "${template}.original" "${template}"
    
    # Apply environment variables
    envsubst '${API_DOMAIN} ${API_IP}' < "${template}" > "${target}"
    
    echo -e "${GREEN}Applied template ${template} to ${target}${NC}"
}

# Function to verify configuration
verify_config() {
    local conf_file="$1"
    
    if ! grep -q "server_name api.ishswami.in" "${conf_file}"; then
        echo -e "${RED}Error: API domain configuration not found in ${conf_file}${NC}"
        exit 1
    fi
    
    if ! grep -q "172.18.0.5:8088" "${conf_file}"; then
        echo -e "${RED}Error: Static IP configuration not found in ${conf_file}${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Configuration verification passed for ${conf_file}${NC}"
}

# Function to set proper permissions
set_permissions() {
    echo -e "${YELLOW}Setting proper permissions for all files and directories...${NC}"
    
    # Set permissions for Nginx configuration files if they exist
    if ls ${NGINX_CONF_DIR}/*.conf 1> /dev/null 2>&1; then
        sudo chmod 644 ${NGINX_CONF_DIR}/*.conf
        sudo chown root:root ${NGINX_CONF_DIR}/*.conf
    fi
    
    # Set directory permissions
    sudo chmod 755 ${NGINX_CONF_DIR}
    sudo chown -R root:root ${NGINX_CONF_DIR}
    
    echo -e "${GREEN}Permissions set successfully${NC}"
}

# Main script execution
main() {
    echo -e "${YELLOW}Starting API HTTP-only deployment...${NC}"
    
    # Create required directories
    sudo mkdir -p ${NGINX_CONF_DIR}
    
    # Clean up existing configurations
    cleanup_configs
    
    # Apply templates and verify configuration
    echo -e "${YELLOW}Applying API configuration template...${NC}"
    apply_template "${TEMPLATE_DIR}/${API_CONF}" "${NGINX_CONF_DIR}/${API_DOMAIN}.conf"
    
    # Copy common configurations
    echo -e "${YELLOW}Copying common configurations...${NC}"
    if [ -f "${TEMPLATE_DIR}/cloudflare.conf" ]; then
        cp "${TEMPLATE_DIR}/cloudflare.conf" "${NGINX_CONF_DIR}/cloudflare.conf"
    fi
    
    # Verify configuration
    verify_config "${NGINX_CONF_DIR}/${API_DOMAIN}.conf"
    
    # Set final permissions
    set_permissions
    
    # Test and reload Nginx
    echo -e "${YELLOW}Testing Nginx configuration...${NC}"
    if sudo nginx -t; then
        echo -e "${GREEN}Nginx configuration test passed${NC}"
        sudo systemctl reload nginx
        echo -e "${GREEN}Nginx reloaded successfully${NC}"
    else
        echo -e "${RED}Nginx configuration test failed${NC}"
        exit 1
    fi
}

# Execute main function
main

echo -e "${GREEN}Nginx deployment completed successfully${NC}"

# Wait for containers to be ready
echo -e "${YELLOW}Waiting for containers to be ready...${NC}"
wait_for_container "latest-redis" || exit 1
wait_for_container "latest-api" || exit 1

# Check API health
echo -e "${YELLOW}Checking API health...${NC}"
check_api_health "http://${API_DOMAIN}/${HEALTH_CHECK_ENDPOINT:-health}"

echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${YELLOW}Important: Please follow these steps to complete the setup:${NC}"
echo "1. Log in to your Cloudflare dashboard"
echo "2. Go to SSL/TLS > Overview"
echo "3. Set SSL/TLS encryption mode to 'Off'"
echo "4. Disable 'Always Use HTTPS' option"
echo ""
echo "API is now accessible at: http://${API_DOMAIN}" 