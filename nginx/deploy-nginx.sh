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

echo -e "${YELLOW}Starting Nginx deployment...${NC}"

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
sudo apt-get install -y nginx openssl

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
sudo chmod -R 600 $SSL_DIR
sudo chmod 755 $SSL_DIR

# Copy Nginx configurations
echo -e "${YELLOW}Copying Nginx configurations...${NC}"
sudo cp -f conf.d/*.conf $NGINX_CONF_DIR/

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