#!/bin/bash

# Create necessary directories
sudo mkdir -p /var/www/healthcare/frontend/current
sudo mkdir -p /var/www/healthcare/backend/current
sudo mkdir -p /etc/nginx/conf.d

# Install certbot if not already installed
if ! command -v certbot &> /dev/null; then
    sudo apt update
    sudo apt install -y certbot python3-certbot-nginx
fi

# Backup existing Nginx configurations
timestamp=$(date +%Y%m%d_%H%M%S)
sudo mkdir -p /etc/nginx/conf.d/backup_$timestamp
sudo cp /etc/nginx/conf.d/*.conf /etc/nginx/conf.d/backup_$timestamp/ 2>/dev/null || true

# Copy new Nginx configurations
sudo cp ./conf.d/*.conf /etc/nginx/conf.d/

# Set proper permissions
sudo chown -R www-data:www-data /var/www/healthcare
sudo chmod -R 755 /var/www/healthcare

# Obtain SSL certificates
echo "Obtaining SSL certificates..."
sudo certbot certonly --nginx --non-interactive --agree-tos --email admin@ishswami.in -d ishswami.in
sudo certbot certonly --nginx --non-interactive --agree-tos --email admin@ishswami.in -d api.ishswami.in

# Test Nginx configuration
echo "Testing Nginx configuration..."
sudo nginx -t

if [ $? -eq 0 ]; then
    echo "Nginx configuration test successful. Reloading Nginx..."
    sudo systemctl reload nginx
    echo "Nginx has been reloaded successfully!"
else
    echo "Nginx configuration test failed. Please check the configurations."
    # Restore backup
    sudo cp /etc/nginx/conf.d/backup_$timestamp/*.conf /etc/nginx/conf.d/
    sudo systemctl reload nginx
    exit 1
fi

# Create cron job for SSL renewal
(crontab -l 2>/dev/null; echo "0 0 * * * certbot renew --quiet") | crontab -

echo "Setup completed successfully!"
echo "Please ensure your DNS records are set correctly:"
echo "- A record for ishswami.in -> 82.208.20.16"
echo "- A record for api.ishswami.in -> 82.208.20.16" 