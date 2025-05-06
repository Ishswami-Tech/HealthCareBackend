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
TEMPLATE_DIR="./conf.d"
API_CONF="api.conf"

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

# Function to configure and deploy Nginx
deploy_nginx() {
    echo -e "${YELLOW}Starting API HTTP-only deployment...${NC}"
    
    # Create required directories
    sudo mkdir -p ${NGINX_CONF_DIR}
    
    # Clean up existing configurations
    cleanup_configs
    
    # Copy and configure API conf file
    echo -e "${YELLOW}Configuring API...${NC}"
    
    # Create a customized configuration file
    cat > /tmp/api.conf << EOF
# HTTP server for API
server {
    listen 80;
    server_name ${API_DOMAIN};

    # Buffer size settings
    client_max_body_size 50M;
    client_body_buffer_size 128k;
    proxy_buffer_size 4k;
    proxy_buffers 4 32k;
    proxy_busy_buffers_size 64k;

    # Rate limiting configuration - Global settings
    limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req_log_level warn;

    # WebSocket configuration
    map \$http_upgrade \$connection_upgrade {
        default upgrade;
        '' close;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self' http:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' http: ws:;" always;

    # Main API proxy
    location / {
        proxy_pass http://${API_IP}:8088;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port \$server_port;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
    }

    # WebSocket endpoint
    location /socket.io/ {
        proxy_pass http://${API_IP}:8088;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
        
        add_header 'Access-Control-Allow-Origin' 'http://ishswami.in' always;
        add_header 'Access-Control-Allow-Credentials' 'true' always;
    }

    # Swagger documentation
    location /docs {
        proxy_pass http://${API_IP}:8088;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_buffering off;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://${API_IP}:8088/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        access_log off;
    }

    # Deny access to . files
    location ~ /\\. {
        deny all;
        access_log off;
        log_not_found off;
    }

    # Error pages
    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}
EOF

    # Copy config to Nginx
    sudo cp /tmp/api.conf ${NGINX_CONF_DIR}/${API_DOMAIN}.conf
    echo -e "${GREEN}API configuration created at ${NGINX_CONF_DIR}/${API_DOMAIN}.conf${NC}"
    
    # Set permissions
    echo -e "${YELLOW}Setting permissions...${NC}"
    sudo chmod 644 ${NGINX_CONF_DIR}/${API_DOMAIN}.conf
    sudo chown root:root ${NGINX_CONF_DIR}/${API_DOMAIN}.conf
    
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

# Main execution
echo -e "${YELLOW}Starting deployment...${NC}"

# Wait for containers to be ready
echo -e "${YELLOW}Waiting for containers to be ready...${NC}"
wait_for_container "latest-redis" || exit 1
wait_for_container "latest-api" || exit 1

# Deploy Nginx
deploy_nginx

# Check API health
echo -e "${YELLOW}Checking API health...${NC}"
check_api_health "http://${API_DOMAIN}/health"

echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${YELLOW}Important: Please follow these steps to complete the setup:${NC}"
echo "1. Log in to your Cloudflare dashboard"
echo "2. Go to SSL/TLS > Overview"
echo "3. Set SSL/TLS encryption mode to 'Off'"
echo "4. Disable 'Always Use HTTPS' option"
echo ""
echo "API is now accessible at: http://${API_DOMAIN}" 