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
SSL_DIR="/etc/nginx/ssl"
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
    envsubst '${API_DOMAIN} ${FRONTEND_DOMAIN} ${SSL_DIR} ${API_CERT} ${API_KEY} ${API_IP}' < "${template}" > "${target}"
}

# Function to verify configuration
verify_config() {
    local conf_file="$1"
    local is_api=false
    
    # Check if this is the API configuration
    if [[ "$conf_file" == *"api.conf" ]]; then
        is_api=true
    fi
    
    if [ "$is_api" = true ]; then
        # Verify API configuration
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

# Function to check if SSL certificate exists
check_ssl_cert() {
    local domain=$1
    local cert_file="ssl/${domain}.crt"
    local key_file="ssl/${domain}.key"
    
    if [ ! -f "$cert_file" ] || [ ! -f "$key_file" ]; then
        echo -e "${YELLOW}Warning: SSL certificates for ${domain} not found in ssl directory${NC}"
        echo -e "${YELLOW}Please ensure the following files exist:${NC}"
        echo -e "  - ${cert_file}"
        echo -e "  - ${key_file}"
        echo -e "${YELLOW}You can obtain these certificates from:${NC}"
        echo -e "  1. Cloudflare Dashboard > SSL/TLS > Origin Server"
        echo -e "  2. Generate a new Origin Certificate for ${domain}"
        echo -e "  3. Save the certificate and private key in the ssl directory"
        return 1
    fi
    return 0
}

# Function to download and create certificate chain
create_certificate_chain() {
    local domain=$1
    local cert_file="${SSL_DIR}/${domain}.crt"
    local chain_file="${SSL_DIR}/${domain}.chain.crt"
    local root_cert="${SSL_DIR}/origin_ca_root.pem"
    
    echo -e "${YELLOW}Creating certificate chain for ${domain}...${NC}"
    
    # Download CloudFlare root certificate if not exists
    if [ ! -f "$root_cert" ]; then
        echo -e "${YELLOW}Downloading CloudFlare root certificate...${NC}"
        curl -s -o "$root_cert" https://developers.cloudflare.com/ssl/static/origin_ca_rsa_root.pem
        sudo chmod 644 "$root_cert"
    fi
    
    # Create certificate chain
    if [ -f "$cert_file" ] && [ -f "$root_cert" ]; then
        echo -e "${YELLOW}Creating certificate chain for ${domain}...${NC}"
        cat "$cert_file" "$root_cert" > "$chain_file"
        sudo chmod 644 "$chain_file"
    else
        echo -e "${RED}Error: Required certificates not found for ${domain}${NC}"
        return 1
    fi
}

# Function to copy SSL certificates
copy_ssl_certs() {
    local domain=$1
    local cert_file="ssl/${domain}.crt"
    local key_file="ssl/${domain}.key"
    
    if [ -f "$cert_file" ] && [ -f "$key_file" ]; then
        echo -e "${YELLOW}Copying SSL certificates for ${domain}...${NC}"
        sudo cp -f "$cert_file" "${SSL_DIR}/"
        sudo cp -f "$key_file" "${SSL_DIR}/"
        sudo chown root:root "${SSL_DIR}/${domain}.crt" "${SSL_DIR}/${domain}.key"
        sudo chmod 644 "${SSL_DIR}/${domain}.crt"
        sudo chmod 600 "${SSL_DIR}/${domain}.key"
        
        # Create certificate chain
        create_certificate_chain "$domain"
    fi
}

# Function to create and protect upstream configuration
create_upstream_config() {
    echo -e "${YELLOW}Setting up upstream configuration...${NC}"
    
    # Create a temporary file
    local temp_file=$(mktemp)
    
    # Create new upstream configuration
    cat > "$temp_file" << EOL
# Backend configuration with static IP
upstream api_backend {
    server ${API_IP}:8088;  # Static IP for API container
    keepalive 32;
}
EOL

    # Remove immutable flag if exists
    sudo chattr -i "${NGINX_CONF_DIR}/upstream.conf" 2>/dev/null || true

    # Remove existing upstream.conf if it exists
    if [ -f "${NGINX_CONF_DIR}/upstream.conf" ]; then
        echo -e "${YELLOW}Removing existing upstream configuration...${NC}"
        sudo rm -f "${NGINX_CONF_DIR}/upstream.conf"
    fi

    # Create new upstream.conf
    echo -e "${YELLOW}Creating new upstream configuration...${NC}"
    sudo cp "$temp_file" "${NGINX_CONF_DIR}/upstream.conf"
    sudo chown root:root "${NGINX_CONF_DIR}/upstream.conf"
    sudo chmod 644 "${NGINX_CONF_DIR}/upstream.conf"
    
    # Clean up the temporary file
    rm -f "$temp_file"
    
    # Verify the configuration
    if ! sudo grep -q "${API_IP}:8088" "${NGINX_CONF_DIR}/upstream.conf"; then
        echo -e "${RED}Error: Static IP configuration not found in upstream.conf${NC}"
        exit 1
    fi
}

# Function to install required packages with retry logic
install_required_packages() {
    echo "Installing required packages..."
    
    # Function to wait for apt lock
    wait_for_apt_lock() {
        while fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || fuser /var/lib/dpkg/lock >/dev/null 2>&1; do
            echo "Waiting for other package manager to finish..."
            sleep 1
        done
    }

    # Function to try installing packages
    try_install_packages() {
        wait_for_apt_lock
        sudo apt-get update
        sudo apt-get install -y curl nginx openssl
    }

    # Try installation with retries
    local max_attempts=3
    local attempt=1
    local success=false

    while [ $attempt -le $max_attempts ] && [ "$success" = false ]; do
        echo "Attempt $attempt of $max_attempts to install packages..."
        if try_install_packages; then
            success=true
            echo "Successfully installed required packages"
        else
            echo "Failed to install packages on attempt $attempt"
            if [ $attempt -lt $max_attempts ]; then
                echo "Waiting before retrying..."
                sleep 5
            fi
            attempt=$((attempt + 1))
        fi
    done

    if [ "$success" = false ]; then
        echo "Failed to install required packages after $max_attempts attempts"
        return 1
    fi
}

# Function to deploy Nginx configuration
deploy_nginx_config() {
    echo -e "${YELLOW}Deploying Nginx configuration...${NC}"
    
    # Create backup of existing configurations
    local backup_dir="/etc/nginx/conf.d/backup_$(date +%Y%m%d_%H%M%S)"
    sudo mkdir -p "$backup_dir"
    sudo cp -f /etc/nginx/conf.d/*.conf "$backup_dir/" 2>/dev/null || true
    
    # Remove all existing configuration files
    echo -e "${YELLOW}Removing existing configuration files...${NC}"
    sudo rm -f "${NGINX_CONF_DIR}"/*.conf
    
    # Deploy common configuration first
    echo -e "${YELLOW}Deploying common configuration...${NC}"
    sudo cp -f "${TEMPLATE_DIR}/common.conf" "${NGINX_CONF_DIR}/common.conf"
    sudo chown root:root "${NGINX_CONF_DIR}/common.conf"
    sudo chmod 644 "${NGINX_CONF_DIR}/common.conf"
    
    # Deploy API configuration
    echo -e "${YELLOW}Deploying API configuration...${NC}"
    apply_template "${TEMPLATE_DIR}/${API_CONF}" "${NGINX_CONF_DIR}/${API_CONF}"
    verify_config "${NGINX_CONF_DIR}/${API_CONF}"
    
    # Deploy frontend configuration
    echo -e "${YELLOW}Deploying frontend configuration...${NC}"
    apply_template "${TEMPLATE_DIR}/${FRONTEND_CONF}" "${NGINX_CONF_DIR}/${FRONTEND_CONF}"
    verify_config "${NGINX_CONF_DIR}/${FRONTEND_CONF}"
    
    # Test Nginx configuration
    if ! sudo nginx -t; then
        echo -e "${RED}Nginx configuration test failed${NC}"
        # Restore from backup
        sudo cp -f "$backup_dir"/*.conf "${NGINX_CONF_DIR}/" 2>/dev/null || true
        exit 1
    fi
    
    # Check if Nginx is running
    if ! sudo systemctl is-active --quiet nginx; then
        echo -e "${YELLOW}Nginx is not running. Starting Nginx...${NC}"
        sudo systemctl start nginx
    else
        echo -e "${YELLOW}Reloading Nginx...${NC}"
        sudo systemctl reload nginx
    fi
    
    # Verify Nginx is running
    if sudo systemctl is-active --quiet nginx; then
        echo -e "${GREEN}Nginx is running successfully${NC}"
    else
        echo -e "${RED}Failed to start Nginx${NC}"
        exit 1
    fi
}

echo -e "${YELLOW}Starting Nginx deployment...${NC}"

# Verify Docker network exists
echo -e "${YELLOW}Verifying Docker network...${NC}"
if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    echo -e "${RED}Error: Docker network $NETWORK_NAME not found${NC}"
    exit 1
fi

# Create deployment directories
echo -e "${YELLOW}Creating deployment directories...${NC}"
sudo mkdir -p "$NGINX_CONF_DIR" "$SSL_DIR"

# Install required packages
install_required_packages

# Check and copy SSL certificates
check_ssl_cert "$DOMAIN" || echo -e "${YELLOW}Warning: Frontend SSL certificates are missing, but continuing with API deployment${NC}"
check_ssl_cert "$API_DOMAIN" && copy_ssl_certs "$API_DOMAIN"

# Set up upstream configuration
create_upstream_config

# Deploy Nginx configuration
deploy_nginx_config

echo -e "${GREEN}Nginx deployment completed successfully${NC}"

# Wait for containers to be ready
echo -e "${YELLOW}Waiting for containers to be ready...${NC}"
wait_for_container "${POSTGRES_CONTAINER}" || exit 1
wait_for_container "${REDIS_CONTAINER}" || exit 1

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