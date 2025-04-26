#!/bin/bash
set -e

# This script deploys the Nginx configurations to the host system
# and manages SSL certificates for the domains.

# Variables
DOMAIN="ishswami.in"
API_DOMAIN="api.ishswami.in"
NGINX_CONF_DIR="/etc/nginx/conf.d"
DEPLOY_PATH="/var/www/healthcare"

# Create deployment directories if they don't exist
echo "Creating deployment directories..."
sudo mkdir -p $DEPLOY_PATH/frontend/current
sudo mkdir -p $DEPLOY_PATH/backend/current

# Backup existing Nginx configurations
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
sudo mkdir -p $NGINX_CONF_DIR/backup_$TIMESTAMP
sudo cp $NGINX_CONF_DIR/*.conf $NGINX_CONF_DIR/backup_$TIMESTAMP/ 2>/dev/null || true

# Copy Nginx configurations
echo "Copying Nginx configurations..."
sudo cp -f conf.d/*.conf $NGINX_CONF_DIR/

# Ensure proper permissions
sudo chown -R www-data:www-data $DEPLOY_PATH
sudo chmod -R 755 $DEPLOY_PATH

# Install certbot if not already installed
if ! command -v certbot &> /dev/null; then
    echo "Installing certbot..."
    sudo apt update
    sudo apt install -y certbot python3-certbot-nginx
fi

# Obtain SSL certificates
echo "Obtaining SSL certificates..."
sudo certbot certonly --nginx --non-interactive --agree-tos --email admin@ishswami.in -d $DOMAIN -d $API_DOMAIN || true

# Test Nginx configuration
echo "Testing Nginx configuration..."
if sudo nginx -t; then
    echo "Nginx configuration is valid. Reloading Nginx..."
    sudo systemctl reload nginx
    echo "Nginx has been reloaded successfully!"
else
    echo "Nginx configuration test failed. Restoring previous configuration..."
    sudo cp $NGINX_CONF_DIR/backup_$TIMESTAMP/*.conf $NGINX_CONF_DIR/
    sudo systemctl reload nginx
    exit 1
fi

# Create cron job for SSL renewal
if ! (crontab -l 2>/dev/null | grep -q "certbot renew"); then
    echo "Setting up SSL renewal cron job..."
    (crontab -l 2>/dev/null; echo "0 0 * * * certbot renew --quiet") | crontab -
fi

echo "Deployment completed successfully!"
echo "Please ensure DNS records are set correctly:"
echo "- A record for $DOMAIN -> 82.208.20.16"
echo "- A record for $API_DOMAIN -> 82.208.20.16" 