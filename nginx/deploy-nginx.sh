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
SSL_EMAIL="aadeshbhujbal99@gmail.com"

echo -e "${YELLOW}Starting Nginx deployment...${NC}"

# Create deployment directories if they don't exist
echo -e "${YELLOW}Creating deployment directories...${NC}"
sudo mkdir -p $DEPLOY_PATH/{frontend,backend}/current
sudo mkdir -p /etc/nginx/ssl

# Backup existing Nginx configurations
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
echo -e "${YELLOW}Backing up existing Nginx configurations...${NC}"
sudo mkdir -p $NGINX_CONF_DIR/backup_$TIMESTAMP
sudo cp $NGINX_CONF_DIR/*.conf $NGINX_CONF_DIR/backup_$TIMESTAMP/ 2>/dev/null || true

# Install required packages
echo -e "${YELLOW}Installing required packages...${NC}"
if ! command -v certbot &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y certbot python3-certbot-nginx
fi

# Stop Nginx before SSL operations
echo -e "${YELLOW}Stopping Nginx...${NC}"
sudo systemctl stop nginx || true

# Obtain SSL certificates
echo -e "${YELLOW}Obtaining SSL certificates...${NC}"
sudo certbot certonly --standalone \
    --non-interactive \
    --agree-tos \
    --email $SSL_EMAIL \
    -d $DOMAIN \
    -d $API_DOMAIN \
    --keep-until-expiring

# Copy SSL certificates
echo -e "${YELLOW}Setting up SSL certificates...${NC}"
sudo cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/nginx/ssl/$DOMAIN.crt
sudo cp /etc/letsencrypt/live/$DOMAIN/privkey.pem /etc/nginx/ssl/$DOMAIN.key
sudo cp /etc/letsencrypt/live/$API_DOMAIN/fullchain.pem /etc/nginx/ssl/$API_DOMAIN.crt
sudo cp /etc/letsencrypt/live/$API_DOMAIN/privkey.pem /etc/nginx/ssl/$API_DOMAIN.key

# Set proper permissions
echo -e "${YELLOW}Setting permissions...${NC}"
sudo chown -R www-data:www-data $DEPLOY_PATH
sudo chmod -R 755 $DEPLOY_PATH
sudo chown -R root:root /etc/nginx/ssl
sudo chmod -R 600 /etc/nginx/ssl

# Copy Nginx configurations
echo -e "${YELLOW}Copying Nginx configurations...${NC}"
sudo cp -f conf.d/*.conf $NGINX_CONF_DIR/

# Test Nginx configuration
echo -e "${YELLOW}Testing Nginx configuration...${NC}"
if sudo nginx -t; then
    echo -e "${GREEN}Nginx configuration is valid. Starting Nginx...${NC}"
    sudo systemctl start nginx
    sudo systemctl enable nginx
else
    echo -e "${RED}Nginx configuration test failed. Rolling back...${NC}"
    sudo cp $NGINX_CONF_DIR/backup_$TIMESTAMP/*.conf $NGINX_CONF_DIR/
    sudo systemctl start nginx
    exit 1
fi

# Setup SSL auto-renewal
echo -e "${YELLOW}Setting up SSL auto-renewal...${NC}"
if ! (crontab -l 2>/dev/null | grep -q "certbot renew"); then
    (crontab -l 2>/dev/null; echo "0 0 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -
fi

# Verify Nginx is running
if sudo systemctl is-active --quiet nginx; then
    echo -e "${GREEN}Nginx is running successfully!${NC}"
else
    echo -e "${RED}Failed to start Nginx${NC}"
    exit 1
fi

echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${YELLOW}Please ensure DNS records are set correctly:${NC}"
echo "- A record for $DOMAIN -> 82.208.20.16"
echo "- A record for $API_DOMAIN -> 82.208.20.16"

# Verify SSL certificates
echo -e "${YELLOW}Verifying SSL certificates...${NC}"
for domain in $DOMAIN $API_DOMAIN; do
    expiry=$(openssl x509 -enddate -noout -in "/etc/nginx/ssl/$domain.crt" | cut -d= -f2)
    echo "SSL certificate for $domain expires on: $expiry"
done 