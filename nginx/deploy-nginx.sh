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
        echo -e "${YELLOW}Attempt $((retry_count + 1)): Checking with curl verbose output...${NC}"
        
        # Try internal health check first
        echo -e "${YELLOW}Testing internal health check (localhost)...${NC}"
        curl -v -k https://localhost:8088/health
        
        echo -e "${YELLOW}Testing internal health check (container IP)...${NC}"
        curl -v -k https://172.18.0.5:8088/health
        
        echo -e "${YELLOW}Testing external health check...${NC}"
        local response=$(curl -v -k -m 10 "$endpoint" 2>&1)
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

# Function to verify certificate expiry
verify_cert_expiry() {
    local cert_file=$1
    local domain=$2
    local expiry_date
    local current_date
    local days_remaining
    
    echo -e "${YELLOW}Checking certificate expiry for ${domain}...${NC}"
    
    expiry_date=$(openssl x509 -in "$cert_file" -noout -enddate | cut -d= -f2)
    current_date=$(date +%s)
    expiry_timestamp=$(date -d "$expiry_date" +%s)
    days_remaining=$(( ($expiry_timestamp - $current_date) / 86400 ))
    
    if [ $days_remaining -lt 30 ]; then
        echo -e "${RED}Warning: Certificate for ${domain} will expire in ${days_remaining} days${NC}"
        echo -e "${YELLOW}Please renew your certificate at Cloudflare Dashboard > SSL/TLS > Origin Server${NC}"
        return 1
    else
        echo -e "${GREEN}Certificate for ${domain} is valid for ${days_remaining} days${NC}"
        return 0
    fi
}

# Function to check if SSL certificate exists
check_ssl_cert() {
    local domain=$1
    local cert_file="ssl/${domain}.crt"
    local key_file="ssl/${domain}.key"
    local chain_file="ssl/${domain}.chain.crt"
    
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
    
    # Verify certificate format and expiry
    if ! openssl x509 -in "$cert_file" -text -noout > /dev/null 2>&1; then
        echo -e "${RED}Error: Invalid certificate format for ${domain}${NC}"
        return 1
    fi
    
    verify_cert_expiry "$cert_file" "$domain"
    return $?
}

# Function to download and create certificate chain
create_certificate_chain() {
    local domain=$1
    local cert_file="${SSL_DIR}/${domain}.crt"
    local chain_file="${SSL_DIR}/${domain}.chain.crt"
    local root_cert="${SSL_DIR}/origin_ca_root.pem"
    local root_cert_url="https://developers.cloudflare.com/ssl/static/origin_ca_rsa_root.pem"
    local backup_root_cert_url="https://cacerts.digicert.com/CloudFlareIncRSACA.crt"
    
    echo -e "${YELLOW}Creating certificate chain for ${domain}...${NC}"
    
    # Download CloudFlare root certificate if not exists
    if [ ! -f "$root_cert" ]; then
        echo -e "${YELLOW}Downloading CloudFlare root certificate...${NC}"
        if ! curl -s -o "$root_cert" "$root_cert_url"; then
            echo -e "${YELLOW}Primary download failed, trying backup URL...${NC}"
            if ! curl -s -o "$root_cert" "$backup_root_cert_url"; then
                echo -e "${RED}Error: Failed to download CloudFlare root certificate${NC}"
                return 1
            fi
        fi
        sudo chmod 644 "$root_cert"
    fi
    
    # Verify root certificate
    if ! openssl x509 -in "$root_cert" -text -noout > /dev/null 2>&1; then
        echo -e "${RED}Error: Invalid root certificate${NC}"
        echo -e "${YELLOW}Attempting to re-download root certificate...${NC}"
        rm -f "$root_cert"
        if ! curl -s -o "$root_cert" "$root_cert_url"; then
            curl -s -o "$root_cert" "$backup_root_cert_url"
        fi
        sudo chmod 644 "$root_cert"
        
        if ! openssl x509 -in "$root_cert" -text -noout > /dev/null 2>&1; then
            echo -e "${RED}Error: Root certificate verification failed${NC}"
            return 1
        fi
    fi
    
    # Create certificate chain
    if [ -f "$cert_file" ] && [ -f "$root_cert" ]; then
        echo -e "${YELLOW}Creating certificate chain for ${domain}...${NC}"
        # Create chain with proper order
        cat "$cert_file" "$root_cert" > "$chain_file"
        sudo chmod 644 "$chain_file"
        
        # Verify the chain
        if openssl verify -CAfile "$root_cert" "$chain_file"; then
            echo -e "${GREEN}Certificate chain verified successfully for ${domain}${NC}"
            # Verify OCSP stapling will work
            if openssl x509 -in "$chain_file" -text -noout | grep -q "OCSP"; then
                echo -e "${GREEN}OCSP stapling is supported${NC}"
            else
                echo -e "${YELLOW}Warning: OCSP stapling may not be supported${NC}"
            fi
        else
            echo -e "${RED}Error: Certificate chain verification failed for ${domain}${NC}"
            return 1
        fi
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

# Function to set proper permissions
set_permissions() {
    echo -e "${YELLOW}Setting proper permissions for all files and directories...${NC}"
    
    # Set permissions for Nginx configuration files
    sudo chmod 644 ${NGINX_CONF_DIR}/*.conf
    sudo chown root:root ${NGINX_CONF_DIR}/*.conf
    
    # Set permissions for SSL files
    sudo chmod 600 ${SSL_DIR}/*.key
    sudo chmod 644 ${SSL_DIR}/*.crt
    sudo chmod 644 ${SSL_DIR}/*.pem
    sudo chmod 644 ${SSL_DIR}/*.chain.crt
    
    # Set directory permissions
    sudo chmod 755 ${NGINX_CONF_DIR}
    sudo chmod 700 ${SSL_DIR}
    sudo chown -R root:root ${SSL_DIR}
    
    echo -e "${GREEN}Permissions set successfully${NC}"
}

# Main script execution
main() {
    # Create required directories
    sudo mkdir -p ${NGINX_CONF_DIR}
    sudo mkdir -p ${SSL_DIR}
    
    # Set initial permissions
    set_permissions
    
    # Continue with existing deployment steps...
    for domain in "${DOMAIN}" "${API_DOMAIN}"; do
        check_ssl_cert "$domain" || exit 1
        create_certificate_chain "$domain" || exit 1
    done
    
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