#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Variables
DOMAIN="ishswami.in"
API_DOMAIN="api.ishswami.in"
NGINX_CONF_DIR="/etc/nginx/conf.d"
DEPLOY_PATH="/var/www/healthcare"
SSL_DIR="/etc/nginx/ssl"
NETWORK_NAME=${NETWORK_NAME:-app-network}

# Function to check API health
check_api_health() {
    local endpoint=$1
    local max_retries=5
    local retry_count=0
    local wait_time=10

    echo -e "${YELLOW}Checking API health at: $endpoint${NC}"
    
    while [ $retry_count -lt $max_retries ]; do
        if curl -k -s -o /dev/null -w "%{http_code}" "$endpoint" | grep -q "200"; then
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

echo -e "${YELLOW}Starting Nginx deployment...${NC}"

# Verify Docker network exists
echo -e "${YELLOW}Verifying Docker network...${NC}"
if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
    echo -e "${YELLOW}Creating Docker network ${NETWORK_NAME}...${NC}"
    docker network create "${NETWORK_NAME}" || {
        echo -e "${RED}Failed to create Docker network${NC}"
        exit 1
    }
fi

# Create deployment directories if they don't exist
echo -e "${YELLOW}Creating deployment directories...${NC}"
sudo mkdir -p $DEPLOY_PATH/{frontend,backend}/current
sudo mkdir -p $SSL_DIR
sudo mkdir -p /var/log/nginx

# Backup existing Nginx configurations
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
echo -e "${YELLOW}Backing up existing Nginx configurations...${NC}"
BACKUP_DIR="/etc/nginx/conf.d/backup_$TIMESTAMP"
sudo mkdir -p "$BACKUP_DIR"
sudo cp -r $NGINX_CONF_DIR/*.conf "$BACKUP_DIR/" 2>/dev/null || true

# Install required packages
echo -e "${YELLOW}Installing required packages...${NC}"
sudo apt-get update
sudo apt-get install -y nginx openssl curl

# Copy SSL certificates
echo -e "${YELLOW}Copying SSL certificates...${NC}"
if [ -f "ssl/api.ishswami.in.crt" ] && [ -f "ssl/api.ishswami.in.key" ]; then
    sudo cp -f ssl/api.ishswami.in.crt $SSL_DIR/
    sudo cp -f ssl/api.ishswami.in.key $SSL_DIR/
    sudo chown root:root $SSL_DIR/api.ishswami.in.*
    sudo chmod 600 $SSL_DIR/api.ishswami.in.key
    sudo chmod 644 $SSL_DIR/api.ishswami.in.crt
else
    echo -e "${RED}Error: SSL certificates not found${NC}"
    exit 1
fi

# Set proper permissions
echo -e "${YELLOW}Setting permissions...${NC}"
sudo chown -R www-data:www-data $DEPLOY_PATH
sudo chmod -R 755 $DEPLOY_PATH
sudo chown -R root:root $SSL_DIR
sudo chmod 755 $SSL_DIR

# Function to safely update network name in a file
update_network_name() {
    local file=$1
    local backup_file="${file}.bak"
    local filename=$(basename "$file")
    
    # Skip nginx.conf and files that don't need network updates
    if [[ "$filename" == "nginx.conf" || "$filename" == "cloudflare.conf" || "$filename" == "common.conf" ]]; then
        echo "Skipping $filename as it doesn't need network updates"
        return 0
    }
    
    echo "Processing file: $file"
    
    # Create a backup
    cp "$file" "$backup_file"
    
    # Only update files that actually contain the network variable
    if grep -q "\${NETWORK_NAME}" "$file" || grep -q "\${network_name}" "$file"; then
        echo "Updating network name in $file"
        sed -i.bak "s/\${NETWORK_NAME}/${NETWORK_NAME}/g" "$file"
        sed -i.bak "s/\${network_name}/${NETWORK_NAME}/g" "$file"
        
        # Verify the update
        if grep -q "\${NETWORK_NAME}" "$file" || grep -q "\${network_name}" "$file"; then
            echo -e "${RED}Failed to update network name in $file${NC}"
            cp "$backup_file" "$file"
            rm -f "$backup_file"
            return 1
        fi
    else
        echo "No network name variables found in $file, skipping..."
    fi
    
    # Clean up backup
    rm -f "$backup_file"
    return 0
}

# Update specific configuration files
echo -e "${YELLOW}Updating network name in configuration files...${NC}"
declare -a config_files=("api.conf" "frontend.conf" "default.conf")

for config_file in "${config_files[@]}"; do
    config_path="conf.d/$config_file"
    if [ -f "$config_path" ]; then
        echo "Processing $config_file..."
        update_network_name "$config_path" || {
            echo -e "${RED}Failed to update $config_file${NC}"
            exit 1
        }
    else
        echo -e "${YELLOW}Warning: $config_file not found${NC}"
    fi
done

# Copy Nginx configurations
echo -e "${YELLOW}Copying Nginx configurations...${NC}"
sudo cp -f conf.d/*.conf $NGINX_CONF_DIR/

# Verify configurations after copy
echo -e "${YELLOW}Verifying configuration files...${NC}"
for config_file in "${config_files[@]}"; do
    target_file="$NGINX_CONF_DIR/$config_file"
    if [ -f "$target_file" ]; then
        if grep -q "\${NETWORK_NAME}" "$target_file" || grep -q "\${network_name}" "$target_file"; then
            echo -e "${RED}Error: Network name variables still present in $target_file${NC}"
            cat "$target_file"
            exit 1
        fi
    fi
done

# Verify API configuration
echo -e "${YELLOW}Verifying API configuration...${NC}"
if ! grep -q "server latest-api:8088" "$NGINX_CONF_DIR/api.conf"; then
    echo -e "${RED}Error: API configuration is not properly set up${NC}"
    exit 1
fi

# Test Nginx configuration
echo -e "${YELLOW}Testing Nginx configuration...${NC}"
if ! sudo nginx -t; then
    echo -e "${RED}Nginx configuration test failed. Rolling back...${NC}"
    sudo cp "$BACKUP_DIR"/*.conf $NGINX_CONF_DIR/ 2>/dev/null || true
    exit 1
fi

# Restart Nginx
echo -e "${YELLOW}Restarting Nginx...${NC}"
sudo systemctl restart nginx

# Verify Nginx is running
if sudo systemctl is-active --quiet nginx; then
    echo -e "${GREEN}Nginx is running successfully!${NC}"
else
    echo -e "${RED}Failed to start Nginx${NC}"
    exit 1
fi

# Wait for containers to be ready
echo -e "${YELLOW}Waiting for containers to be ready...${NC}"
wait_for_container "latest-postgres" || exit 1
wait_for_container "latest-redis" || exit 1
wait_for_container "latest-api" || exit 1

# Check API health from different perspectives
echo -e "${YELLOW}Performing comprehensive API health checks...${NC}"

# 1. Check direct container access
echo -e "${YELLOW}Checking direct container access...${NC}"
if ! docker exec latest-api wget -q --spider --no-check-certificate https://localhost:8088/health; then
    echo -e "${RED}Failed to access API inside container${NC}"
    docker logs latest-api
    exit 1
fi

# 2. Check internal network access
echo -e "${YELLOW}Checking internal network access...${NC}"
if ! curl -k -s -o /dev/null -w "%{http_code}" http://localhost:8088/health | grep -q "200"; then
    echo -e "${RED}Failed to access API through localhost${NC}"
    exit 1
fi

# 3. Check external HTTPS access
echo -e "${YELLOW}Checking external HTTPS access...${NC}"
check_api_health "https://api.ishswami.in/health"

# 4. Check WebSocket availability
echo -e "${YELLOW}Checking WebSocket endpoint...${NC}"
if ! curl -k -s -o /dev/null -w "%{http_code}" https://api.ishswami.in/socket.io/ | grep -q "200"; then
    echo -e "${YELLOW}Warning: WebSocket endpoint might not be accessible${NC}"
fi

# Print detailed container information
echo -e "${YELLOW}Container Details:${NC}"
echo "1. API Container:"
docker inspect latest-api --format "ID: {{.Id}}\nNetwork: {{range \$k, \$v := .NetworkSettings.Networks}}{{printf \"%s: %s\\n\" \$k \$v.IPAddress}}{{end}}Status: {{.State.Status}}\nHealth: {{.State.Health.Status}}"

echo "2. Network Information:"
docker network inspect "${NETWORK_NAME}"

echo "3. Container Logs:"
docker logs latest-api --tail 50

echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${YELLOW}Important: Please follow these steps to complete the setup:${NC}"
echo "1. Log in to your Cloudflare dashboard"
echo "2. Go to SSL/TLS > Origin Server"
echo "3. Create new Origin Certificate for domains: $DOMAIN, $API_DOMAIN"
echo "4. Replace the self-signed certificates with Cloudflare Origin Certificates:"
echo "   - Save the certificate to: $SSL_DIR/$DOMAIN.crt"
echo "   - Save the private key to: $SSL_DIR/$DOMAIN.key"
echo "   - Save the certificate to: $SSL_DIR/$API_DOMAIN.crt"
echo "   - Save the private key to: $SSL_DIR/$API_DOMAIN.key"
echo "5. Reload Nginx after installing the certificates: sudo systemctl reload nginx"
echo ""
echo "DNS Settings (already configured in Cloudflare):"
echo "- A record for $DOMAIN -> 84.32.84.16"
echo "- A record for $API_DOMAIN -> 84.32.84.16"
echo ""
echo "Cloudflare SSL/TLS Settings:"
echo "1. Set SSL/TLS encryption mode to 'Full (strict)'"
echo "2. Enable 'Always Use HTTPS'"
echo "3. Set minimum TLS version to 1.2"

# Final API Status Summary
echo -e "\n${YELLOW}Final API Status Summary:${NC}"
echo "1. Container Status:"
docker inspect latest-api --format='{{.State.Status}} - {{.State.Health.Status}}'
echo "2. Internal Health Check:"
curl -k -s http://localhost:8088/health
echo "3. External Health Check:"
curl -k -s https://api.ishswami.in/health
echo "4. Container Logs (last 5 lines):"
docker logs latest-api --tail 5 