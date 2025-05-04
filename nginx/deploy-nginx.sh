#!/bin/bash
set -e

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
SSL_DIR="/etc/nginx/ssl"
NETWORK_NAME=${NETWORK_NAME:-app-network}

# Function to check API health
check_api_health() {
    local endpoint=$1
    local max_retries=${HEALTH_CHECK_RETRIES}
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

# Function to verify Nginx configuration before deployment
verify_nginx_conf() {
    local file=$1
    echo -e "${YELLOW}Pre-deployment verification of $file...${NC}"
    
    if [[ -f "$file" ]]; then
        # Check for any dynamic container names or SHA values
        if grep -q "f9f0e5d257" "$file" || grep -q "_app-network-api" "$file"; then
            echo -e "${RED}Error: Found dynamic container name or SHA in $file${NC}"
            return 1
        fi
        
        # For api.conf, verify the upstream block
        if [[ "$file" == *"api.conf" ]]; then
            if ! grep -q "172.18.0.5:8088" "$file"; then
                echo -e "${RED}Error: Static IP configuration not found in $file${NC}"
                return 1
            fi
            
            if grep -q "upstream.*{" "$file" | grep -v "172.18.0.5:8088"; then
                echo -e "${RED}Error: Found invalid upstream configuration in $file${NC}"
                return 1
            fi
        fi
    else
        echo -e "${RED}Error: File $file not found${NC}"
        return 1
    fi
    
    return 0
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
sudo mkdir -p ${DEPLOY_PATH}/{frontend,backend}/current
sudo mkdir -p ${SSL_DIR}
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
if [ -f "ssl/${API_CERT}" ] && [ -f "ssl/${API_KEY}" ]; then
    sudo cp -f ssl/${API_CERT} ${SSL_DIR}/
    sudo cp -f ssl/${API_KEY} ${SSL_DIR}/
    sudo chown root:root ${SSL_DIR}/${API_CERT} ${SSL_DIR}/${API_KEY}
    sudo chmod 600 ${SSL_DIR}/${API_KEY}
    sudo chmod 644 ${SSL_DIR}/${API_CERT}
else
    echo -e "${RED}Error: SSL certificates not found${NC}"
    exit 1
fi

# Set proper permissions
echo -e "${YELLOW}Setting permissions...${NC}"
sudo chown -R www-data:www-data ${DEPLOY_PATH}
sudo chmod -R 755 ${DEPLOY_PATH}
sudo chown -R root:root ${SSL_DIR}
sudo chmod 755 ${SSL_DIR}

# Function to safely update configuration files
update_nginx_conf() {
    local file=$1
    local backup_file="${file}.bak"
    local filename=$(basename "$file")
    
    echo -e "${YELLOW}Processing $filename...${NC}"
    
    # Create a backup
    cp "$file" "$backup_file"
    
    if [[ "$filename" == "api.conf" ]]; then
        # Split the file into parts
        csplit "$file" '/^upstream api_backend/+1' '/^}/-1' > /dev/null
        
        # Verify the upstream block is correct
        if ! grep -q "172.18.0.5:8088" xx01; then
            echo -e "${RED}Error: Static IP configuration not found or incorrect${NC}"
            cat > xx01 << 'EOL'
upstream api_backend {
    # Static IP configuration - Required for container communication
    server 172.18.0.5:8088 max_fails=3 fail_timeout=30s; # STATIC IP - DO NOT REPLACE
    keepalive 32;
}
EOL
        fi
        
        # Process the rest of the file with environment variables
        envsubst '${API_DOMAIN} ${FRONTEND_DOMAIN} ${SSL_DIR} ${API_CERT} ${API_KEY}' < xx02 > xx02.tmp
        
        # Combine the files
        cat xx00 xx01 xx02.tmp > "$file"
        
        # Clean up temporary files
        rm -f xx* 2>/dev/null
        
        # Double-check the result
        if grep -q "f9f0e5d257" "$file" || grep -q "_app-network-api" "$file"; then
            echo -e "${RED}Error: Found container name or SHA in $filename${NC}"
            cp "$backup_file" "$file"
            return 1
        fi
    else
        # For other files, process normally
        envsubst '${API_DOMAIN} ${FRONTEND_DOMAIN} ${SSL_DIR} ${API_CERT} ${API_KEY}' < "$file" > "$backup_file"
        mv "$backup_file" "$file"
    fi
    
    echo -e "${GREEN}Successfully processed $filename${NC}"
    return 0
}

# Add pre-deployment checks
echo -e "${YELLOW}Running pre-deployment checks...${NC}"
for conf_file in ${NGINX_CONF_DIR}/*.conf; do
    if ! verify_nginx_conf "$conf_file"; then
        echo -e "${RED}Pre-deployment checks failed${NC}"
        exit 1
    fi
done

# Make api.conf immutable during deployment
if [ -f "${NGINX_CONF_DIR}/api.conf" ]; then
    echo -e "${YELLOW}Making api.conf immutable...${NC}"
    sudo chattr +i "${NGINX_CONF_DIR}/api.conf"
fi

# Process configuration files
echo -e "${YELLOW}Processing configuration files...${NC}"
for conf_file in ${NGINX_CONF_DIR}/*.conf; do
    if [ -f "$conf_file" ]; then
        if ! update_nginx_conf "$conf_file"; then
            echo -e "${RED}Failed to process $conf_file${NC}"
            exit 1
        fi
    fi
done

# Make api.conf mutable again
if [ -f "${NGINX_CONF_DIR}/api.conf" ]; then
    echo -e "${YELLOW}Making api.conf mutable again...${NC}"
    sudo chattr -i "${NGINX_CONF_DIR}/api.conf"
fi

# Verify nginx configuration
echo -e "${YELLOW}Verifying nginx configuration...${NC}"
if ! sudo nginx -t; then
    echo -e "${RED}Nginx configuration test failed${NC}"
    # Show the current api.conf content
    echo -e "${YELLOW}Current api.conf content:${NC}"
    cat ${NGINX_CONF_DIR}/api.conf
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
wait_for_container "${POSTGRES_CONTAINER}" || exit 1
wait_for_container "${REDIS_CONTAINER}" || exit 1
wait_for_container "${API_CONTAINER}" || exit 1

# Check API health
echo -e "${YELLOW}Checking API health...${NC}"
check_api_health "https://${API_DOMAIN}/${HEALTH_CHECK_ENDPOINT}"

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
docker inspect "${API_CONTAINER}" --format='{{.State.Status}} - {{.State.Health.Status}}'
echo "2. Internal Health Check:"
curl -k -s http://localhost:8088/health
echo "3. External Health Check:"
curl -k -s https://api.ishswami.in/health
echo "4. Container Logs (last 5 lines):"
docker logs "${API_CONTAINER}" --tail 5 