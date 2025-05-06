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
DOMAIN="ishswami.in"
API_DOMAIN="api.ishswami.in"
NGINX_CONF_DIR="/etc/nginx/conf.d"
DEPLOY_PATH="/var/www/healthcare"
NETWORK_NAME=${NETWORK_NAME:-app-network}
TEMPLATE_DIR="./conf.d"
API_CONF="api.conf"
FRONTEND_CONF="frontend.conf"
API_IP="172.18.0.5"  # Static IP for API container

# Function to check API health
check_api_health() {
    local endpoint=$1
    local max_retries=${HEALTH_CHECK_RETRIES}
    local retry_count=0
    local wait_time=10

    echo -e "${YELLOW}Checking API health at: $endpoint${NC}"
    
    while [ $retry_count -lt $max_retries ]; do
        echo -e "${YELLOW}Attempt $((retry_count + 1)): Checking with curl verbose output...${NC}"
        
        # Try internal health check first
        echo -e "${YELLOW}Testing internal health check (localhost)...${NC}"
        curl -v http://localhost:8088/health
        
        echo -e "${YELLOW}Testing internal health check (container IP)...${NC}"
        curl -v http://172.18.0.5:8088/health
        
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
                echo -e "${YELLOW}Checking Nginx status...${NC}"
                sudo systemctl status nginx
                echo -e "${YELLOW}Checking API container logs...${NC}"
                docker logs --tail 20 latest-api
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
    echo -e "${YELLOW}4. Network connectivity test:${NC}"
    nc -zv 172.18.0.5 8088
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
    envsubst '${API_DOMAIN} ${FRONTEND_DOMAIN} ${API_IP}' < "${template}" > "${target}"
}

# Function to verify configuration
verify_config() {
    local conf_file="$1"
    local is_api=false
    
    # Check if this is the API configuration
    if [[ "$conf_file" == *"api.ishswami.in.conf" ]]; then
        is_api=true
    fi
    
    if [ "$is_api" = true ]; then
        # Verify API configuration
        if ! grep -q "server_name api.ishswami.in" "${conf_file}"; then
            echo -e "${RED}Error: API domain configuration not found in ${conf_file}${NC}"
            exit 1
        fi
        if ! grep -q "172.18.0.5:8088" "${conf_file}"; then
            echo -e "${RED}Error: Static IP configuration not found in ${conf_file}${NC}"
            exit 1
        fi
    else
        # Verify frontend configuration
        if ! grep -q "server_name ishswami.in" "${conf_file}"; then
            echo -e "${RED}Error: Frontend domain configuration not found in ${conf_file}${NC}"
            exit 1
        fi
    fi
}

# Function to set proper permissions
set_permissions() {
    echo -e "${YELLOW}Setting proper permissions for all files and directories...${NC}"
    
    # Set permissions for Nginx configuration files
    sudo chmod 644 ${NGINX_CONF_DIR}/*.conf
    sudo chown root:root ${NGINX_CONF_DIR}/*.conf
    
    # Set directory permissions
    sudo chmod 755 ${NGINX_CONF_DIR}
    sudo chown -R root:root ${NGINX_CONF_DIR}
    
    echo -e "${GREEN}Permissions set successfully${NC}"
}

# Main script execution
main() {
    # Create required directories
    sudo mkdir -p ${NGINX_CONF_DIR}
    
    # Set initial permissions
    set_permissions
    
    # Apply templates and verify configuration
    apply_template "${TEMPLATE_DIR}/${API_CONF}" "${NGINX_CONF_DIR}/${API_DOMAIN}.conf"
    apply_template "${TEMPLATE_DIR}/${FRONTEND_CONF}" "${NGINX_CONF_DIR}/${DOMAIN}.conf"
    
    verify_config "${NGINX_CONF_DIR}/${API_DOMAIN}.conf"
    verify_config "${NGINX_CONF_DIR}/${DOMAIN}.conf"
    
    # Set final permissions
    set_permissions
    
    # Test and reload Nginx
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
wait_for_container "${POSTGRES_CONTAINER}" || exit 1
wait_for_container "${REDIS_CONTAINER}" || exit 1

# Check API health
echo -e "${YELLOW}Checking API health...${NC}"
check_api_health "http://${API_DOMAIN}/${HEALTH_CHECK_ENDPOINT}"

# Print detailed container information
echo -e "${YELLOW}Container Details:${NC}"
echo "1. API Container:"
docker inspect "${API_CONTAINER}" --format "ID: {{.Id}}\nNetwork: {{range \$k, \$v := .NetworkSettings.Networks}}{{printf \"%s: %s\\n\" \$k \$v.IPAddress}}{{end}}Status: {{.State.Status}}\nHealth: {{.State.Health.Status}}"

echo "2. Network Information:"
docker network inspect "${NETWORK_NAME}"

echo "3. Container Logs:"
docker logs "${API_CONTAINER}" --tail 50

echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${YELLOW}Important: Please follow these steps to complete the setup:${NC}"
echo "1. Log in to your Cloudflare dashboard"
echo "2. Go to SSL/TLS > Overview"
echo "3. Set SSL/TLS encryption mode to 'Off'"
echo ""
echo "DNS Settings (already configured in Cloudflare):"
echo "- A record for $DOMAIN -> 84.32.84.16"
echo "- A record for $API_DOMAIN -> 84.32.84.16"

# Final API Status Summary
echo -e "\n${YELLOW}Final API Status Summary:${NC}"
echo "1. Container Status:"
docker inspect "${API_CONTAINER}" --format='{{.State.Status}} - {{.State.Health.Status}}'
echo "2. Internal Health Check:"
curl -s http://localhost:8088/health
echo "3. External Health Check:"
curl -s http://api.ishswami.in/health
echo "4. Container Logs (last 5 lines):"
docker logs "${API_CONTAINER}" --tail 5 